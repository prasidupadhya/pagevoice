import React, {useEffect, useRef, useState} from 'react'
import {BookOpen, Headphones, Plus, Upload, Sun, Moon, Globe, Play, Download, Settings2, Mic, X, Check, RefreshCw, Pencil, Volume2, AlertCircle, ChevronRight, AudioLines, ShieldCheck, LoaderCircle} from 'lucide-react'
import {api} from './api'
import {Casting} from './Casting'
import {Listener,forwardRows,bufferStatus} from './listener'
import {ListeningPlayer} from './ListeningPlayer'
import {registerProjectTools} from './webmcp'
import {messages, preference, persist} from './i18n'

export function Modal({title,onClose,children,t}) {
  const ref=useRef(null)
  useEffect(()=>{ref.current?.showModal();return()=>ref.current?.close()},[])
  return <dialog ref={ref} aria-label={title} onCancel={e=>{e.preventDefault();onClose()}}>
    <header className="modal-heading"><h2>{title}</h2><button className="icon-button" onClick={onClose} aria-label={t.close}><X size={20}/></button></header>{children}
  </dialog>
}

function ErrorNotice({error,t}) {
  if (!error) return null
  return <div className="notice error" role="alert"><AlertCircle size={18}/><div>{t[error] || t.unexpected}{!t[error]&&<details><summary>{t.showDetails}</summary><p>{error}</p></details>}</div></div>
}

export function UploadDialog({initialFile,onClose,onCreated,t,locale}) {
  const [file,setFile]=useState(initialFile),[language,setLanguage]=useState(locale),[ocr,setOcr]=useState('auto'),[pending,setPending]=useState(false),[error,setError]=useState('')
  async function submit(e) {
    e.preventDefault();if(!file){setError('fileRequired');return}
    if(!/\.(pdf|epub)$/i.test(file.name)||file.size>100*1024*1024){setError('uploadError');return}
    setPending(true);setError('');const body=new FormData();body.append('file',file);body.append('language',language);body.append('ocr',ocr)
    try{onCreated(await api('/api/projects',{method:'POST',body}))}catch(e){setError(e.message)}finally{setPending(false)}
  }
  return <Modal title={t.upload} onClose={onClose} t={t}><form onSubmit={submit} className="form-stack">
    <label className="file-field">{t.file}<input required={!file} type="file" accept=".pdf,.epub" onChange={e=>setFile(e.target.files[0])}/></label>
    {file&&<p className="selected-file"><BookOpen size={18}/>{file.name}</p>}
    <label>{t.bookLanguage}<select value={language} onChange={e=>setLanguage(e.target.value)}><option value="en">English</option><option value="es">Español</option></select></label>
    <label>{t.ocr}<select value={ocr} onChange={e=>setOcr(e.target.value)}><option value="auto">{t.auto}</option><option value="always">{t.always}</option><option value="never">{t.never}</option></select></label>
    <ErrorNotice error={error} t={t}/><div className="actions"><button type="button" className="secondary" onClick={onClose}>{t.cancel}</button><button className="primary" disabled={pending}>{pending?<LoaderCircle className="spin" size={18}/>:<Upload size={18}/>} {pending?t.pending:t.import}</button></div>
  </form></Modal>
}

export function CloneDialog({onClose,onCreated,t,locale}) {
  const [consent,setConsent]=useState(false),[pending,setPending]=useState(false),[error,setError]=useState('')
  async function submit(e) {
    e.preventDefault();if(!consent)return;setPending(true);setError('');const body=new FormData(e.currentTarget);body.set('consent','true')
    try{onCreated(await api('/api/voices',{method:'POST',body}))}catch(e){setError(e.message)}finally{setPending(false)}
  }
  return <Modal title={t.cloneTitle} onClose={onClose} t={t}><form onSubmit={submit} className="form-stack">
    <p className="muted">{t.cloneHint}</p><label>{t.name}<input name="name" required maxLength={80}/></label>
    <label>{t.bookLanguage}<select name="language" defaultValue={locale}><option value="en">English</option><option value="es">Español</option></select></label>
    <label className="file-field">{t.recording}<input name="file" type="file" required accept=".wav,.mp3,.m4a,.flac,audio/*"/></label>
    <label className="check-field"><input type="checkbox" checked={consent} onChange={e=>setConsent(e.target.checked)}/><span>{t.consent}</span></label><p className="small muted">{t.consentNote}</p>
    <ErrorNotice error={error} t={t}/><div className="actions"><button className="secondary" type="button" onClick={onClose}>{t.cancel}</button><button className="primary" disabled={!consent||pending}>{pending?<LoaderCircle size={18} className="spin"/>:<Mic size={18}/>} {t.createVoice}</button></div>
  </form></Modal>
}

export function SentenceEditor({row,onClose,onSave,t,busy,speakers=[]}) {
  const [text,setText]=useState(row.text),[speaker,setSpeaker]=useState(row.speaker||'Narrator')
  return <Modal title={t.edit} onClose={onClose} t={t}><form className="form-stack" onSubmit={e=>{e.preventDefault();onSave(text,speaker)}}>
    <p className="muted">{t.editHint}</p><label>{t.text}<textarea autoFocus rows={6} value={text} onChange={e=>setText(e.target.value)} maxLength={220}/></label>
    <label>{t.speaker}<input list="speaker-options" value={speaker} onChange={e=>setSpeaker(e.target.value)} maxLength={80} required/><datalist id="speaker-options">{speakers.map(name=><option key={name} value={name}/>)}</datalist></label><p className="small muted">{t.pauseHint}</p><p className="small muted character-count">{text.length}/220 {t.characters}</p><div className="actions"><button className="secondary" type="button" onClick={onClose}>{t.cancel}</button><button className="primary" disabled={busy||!text.trim()}>{t.regenerate}</button></div>
  </form></Modal>
}

function statusText(p,t) {
  if(p.status==='assembling')return t.finishingExport
  if(p.job?.status==='queued')return t.queued
  if(p.job?.status==='running')return p.job.kind==='prepare'?t.preparing:t.working
  if(p.status==='paused')return t.preparationPaused
  if(p.status==='failed'||p.job?.status==='failed')return t.failed
  return p.output?t.ready:t.reviewing
}

export default function App() {
  const [locale,setLocale]=useState(()=>preference('pagevoice-locale','en')==='es'?'es':'en')
  const [theme,setTheme]=useState(()=>preference('pagevoice-theme',window.matchMedia?.('(prefers-color-scheme: dark)').matches?'dark':'light'))
  const t=messages[locale]
  useEffect(()=>registerProjectTools(),[])
  const [projects,setProjects]=useState([]),[activeId,setActiveId]=useState(''),[project,setProject]=useState(null),[engines,setEngines]=useState([]),[voices,setVoices]=useState([]),[hardware,setHardware]=useState(null)
  const [loading,setLoading]=useState(true),[error,setError]=useState(''),[notice,setNotice]=useState(''),[disconnected,setDisconnected]=useState(false),[pending,setPending]=useState(false)
  const [upload,setUpload]=useState(false),[uploadFile,setUploadFile]=useState(null),[clone,setClone]=useState(false),[editor,setEditor]=useState(null),[chapter,setChapter]=useState(0),[playing,setPlaying]=useState(null)
  const [settings,setSettings]=useState(null),[dirty,setDirty]=useState(false),[allowNetwork,setAllowNetwork]=useState(false),[showProfiles,setShowProfiles]=useState(false)
  const audio=useRef(null),intent=useRef(null),listener=useRef(null),listenRequest=useRef(0)
  const [listenStart,setListenStart]=useState(0),[listenState,setListenState]=useState({status:'idle',cursor:0,ready:0,target:20,total:0})
  useEffect(()=>{const engine=new Listener(setListenState);listener.current=engine;return()=>{engine.onChange=()=>{};engine.dispose()}},[activeId])
  useEffect(()=>{listener.current?.update(forwardRows(project,listenStart))},[project,listenStart])
  useEffect(()=>{if(listenState.status==='playing'&&listenState.row)setChapter(listenState.row.chapter)},[listenState.row?.chapter,listenState.status])
  useEffect(()=>{document.documentElement.lang=locale;persist('pagevoice-locale',locale);document.title=locale==='es'?'PageVoice · Tu biblioteca':'PageVoice · Your listening library'},[locale])
  useEffect(()=>{document.documentElement.dataset.theme=theme;persist('pagevoice-theme',theme)},[theme])
  async function refresh() {
    setLoading(true);setError('')
    try{const [books,available,profiles]=await Promise.all([api('/api/projects'),api('/api/engines'),api('/api/voices')]);setProjects(books);setEngines(available);setVoices(profiles)
      const stored=preference('pagevoice-project','');setActiveId(id=>books.some(p=>p.id===id)?id:books.some(p=>p.id===stored)?stored:books[0]?.id||'')
    }catch(e){setError(e.message)}finally{setLoading(false)}
  }
  useEffect(()=>{refresh();api('/api/hardware').then(setHardware).catch(()=>{})},[])
  useEffect(()=>{
    if(!activeId){setProject(null);return}persist('pagevoice-project',activeId);setChapter(0);setPlaying(null);setProject(null);setDirty(false);setDisconnected(false)
    let closed=false,initial=true
    function update(p){if(closed)return;if(initial){initial=false;setChapter(p.listening?.chapter||0);setListenStart(p.listening?.chapter||0)}setProject(p);setProjects(all=>all.some(x=>x.id===p.id)?all.map(x=>x.id===p.id?p:x):[p,...all])
      if(intent.current?.project===p.id && p.job?.status==='complete') {
        const action=intent.current;intent.current=null
        if(action.kind==='preview'&&p.chapters[action.chapter]?.preview)setPlaying({src:p.chapters[action.chapter].preview+'?v='+p.job.id,label:p.chapters[action.chapter].title})

      }
    }
    api('/api/projects/'+activeId).then(update).catch(e=>setError(e.message))
    const events=new EventSource(`/api/projects/${activeId}/events`)
    events.addEventListener('progress',e=>{setDisconnected(false);update(JSON.parse(e.data))})
    events.onopen=()=>setDisconnected(false);events.onerror=()=>setDisconnected(true)
    return()=>{closed=true;events.close()}
  },[activeId])
  useEffect(()=>{if(project&&!dirty)setSettings({engine:project.engine,voice:project.voice||'',format:project.format,device:project.device})},[project?.engine,project?.voice,project?.format,project?.device,dirty])
  useEffect(()=>{if(playing&&audio.current)audio.current.load()},[playing])
  const busy=pending||['queued','running'].includes(project?.job?.status)
  const selectedEngine=engines.find(e=>e.id===settings?.engine)
  const voiceOptions=(selectedEngine?.voices||[]).filter(v=>v.language===project?.language).map(v=>({id:v.id,name:v.id}))
  if(settings?.engine==='xtts')voiceOptions.push(...voices.filter(v=>v.language===project?.language))
  const readyEngine=selectedEngine?.installed && (selectedEngine.id!=='xtts'||selectedEngine.model_ready)
  const selectedChapter=project?.chapters[chapter]
  const canListenDuringJob=['render','listen','regen'].includes(project?.job?.kind)
  const cachedListening=bufferStatus(forwardRows(project,chapter)).canStart
  const listenDisabled=pending||dirty||(!readyEngine&&!cachedListening)||(settings?.engine==='edge'&&!allowNetwork&&!cachedListening&&!canListenDuringJob)||(busy&&!canListenDuringJob)
  function chooseProject(id){listenRequest.current++;setActiveId(id);setError('');setNotice('')}
  function openUpload(file=null){setUploadFile(file);setUpload(true)}
  function updateSettings(key,value){setSettings(s=>{const next={...s,[key]:value};if(key==='engine')next.voice=engines.find(e=>e.id===value)?.voices.find(v=>v.language===project.language)?.id||'';return next});setDirty(true)}
  async function saveSettings(){listener.current?.reset();setPending(true);setError('');try{const p=await api(`/api/projects/${activeId}/settings`,{method:'PATCH',body:JSON.stringify(settings)});setProject(p);setDirty(false);setNotice(t.saved)}catch(e){setError(e.message)}finally{setPending(false)}}
  async function runJob(kind,extra={}) {
    setPending(true);setError('');setNotice('');intent.current={project:activeId,kind,chapter}
    try{await api(`/api/projects/${activeId}/${kind}`,{method:'POST',body:JSON.stringify({allow_network:allowNetwork,...extra})});setEditor(null);const p=await api('/api/projects/'+activeId);setProject(p)}catch(e){setError(e.message);intent.current=null}finally{setPending(false)}
  }
  async function changeCasting(path,body,method) {
    listener.current?.reset();setPending(true);setError('')
    try{const p=await api(`/api/projects/${activeId}/${path}`,{method,body:JSON.stringify(body)});setProject(p);setNotice(t.castSaved);return true}
    catch(e){setError(e.message);return false}finally{setPending(false)}
  }
  async function saveSentence(text,speaker) {
    listener.current?.reset()
    if(speaker!==(editor.speaker||'Narrator')) {
      const saved=await changeCasting('casting',{tags:{[editor.id]:speaker}},'PATCH');if(!saved)return
    }
    await runJob('regen',{sentence_id:editor.id,text})
  }
  async function beginListening(next=chapter) {
    if(dirty||pending)return
    const request=++listenRequest.current
    setPlaying(null);audio.current?.pause();setListenStart(next);setError('')
    const rows=forwardRows(project,next)
    // Unlock the browser audio context immediately in the user gesture.
    listener.current?.start(rows)
    if(!readyEngine&&bufferStatus(rows).canStart)return
    if(settings?.engine==='edge'&&!allowNetwork&&!canListenDuringJob&&bufferStatus(rows).canStart)return
    try{const p=await api(`/api/projects/${activeId}/listen`,{method:'POST',body:JSON.stringify({chapter:next,allow_network:allowNetwork})});if(request===listenRequest.current)setProject(p)}
    catch(e){if(request!==listenRequest.current)return;setError(e.message);if(!bufferStatus(rows).canStart)listener.current?.reset()}
  }
  function selectChapter(next) {
    setChapter(next);setPlaying(null)
    if((canListenDuringJob&&busy)||['playing','buffering','paused'].includes(listenState.status))beginListening(next)
  }
  function play(src,label){listener.current?.reset();setPlaying({src,label})}
  return <>
    <a className="skip-link" href="#reading-area">{t.skip}</a>
    <header className="topbar"><a className="brand" href="#" onClick={e=>e.preventDefault()}><span className="brand-mark"><BookOpen size={23}/></span>PageVoice</a><span className="local-badge"><ShieldCheck size={16}/>{t.local}</span>
      <div className="top-controls"><label className="language-control"><Globe size={17}/><span className="sr-only">{t.language}</span><select aria-label={t.language} value={locale} onChange={e=>setLocale(e.target.value)}><option value="en">English</option><option value="es">Español</option></select></label>
      <button className="theme-button" onClick={()=>setTheme(theme==='dark'?'light':'dark')} aria-label={`${t.theme}: ${theme==='dark'?t.light:t.dark}`} title={theme==='dark'?t.light:t.dark}>{theme==='dark'?<Sun size={19}/>:<Moon size={19}/>}<span>{theme==='dark'?t.light:t.dark}</span></button></div>
    </header>
    <div className="app-layout">
      <aside className="library-rail"><div className="rail-heading"><h2>{t.books}</h2><button className="icon-button" aria-label={t.newBook} onClick={()=>openUpload()}><Plus size={19}/></button></div>
        <nav aria-label={t.library} className="project-list">{projects.map(p=><button key={p.id} className={`project-link ${p.id===activeId?'selected':''}`} onClick={()=>chooseProject(p.id)} aria-current={p.id===activeId?'page':undefined}><BookOpen size={19}/><span><strong>{p.title}</strong><small>{p.language==='es'?'Español':'English'}</small></span>{p.id===activeId&&<ChevronRight size={15}/>}</button>)}</nav>
        {!projects.length&&<p className="small muted rail-empty">{t.noBooks}</p>}
        <div className="rail-bottom"><button className="text-button" onClick={()=>setShowProfiles(!showProfiles)} aria-expanded={showProfiles}><Mic size={17}/>{t.profiles}</button>{showProfiles&&<div className="voice-list">{voices.length?voices.map(v=><p key={v.id}>{v.name}<small>{v.language==='es'?'Español':'English'}</small></p>):<p className="small muted">{t.noProfiles}</p>}<button className="text-button" onClick={()=>setClone(true)}><Plus size={16}/>{t.clone}</button></div>}<p className="small muted privacy-note"><ShieldCheck size={16}/>{t.localHint}</p></div>
      </aside>
      <main id="reading-area" className="main-area" tabIndex={-1}>
        <ErrorNotice error={error} t={t}/>{notice&&<div className="notice success" role="status"><Check size={18}/>{notice}</div>}{disconnected&&<div className="notice" role="status"><RefreshCw size={17}/>{t.reconnecting}</div>}
        {loading?<div className="loading-state"><LoaderCircle className="spin"/>{t.loading}</div>:!project?<section className="empty-library"><span className="empty-symbol"><Headphones size={40}/></span><h1>{t.empty}</h1><p>{t.emptyHint}</p><button className="dropzone" onClick={()=>openUpload()} onDragOver={e=>e.preventDefault()} onDrop={e=>{e.preventDefault();openUpload(e.dataTransfer.files[0])}}><Upload size={28}/><strong>{t.choose}</strong><span>PDF / EPUB</span></button>{error&&<button className="secondary" onClick={refresh}>{t.retry}</button>}</section>:<>
          <section className="book-heading"><div><p className="book-author">{project.author||t.library}</p><h1>{project.title}</h1><p className="book-meta"><span>{project.language==='es'?'Español':'English'}</span><span>{project.chapters.length} {t.chapters.toLowerCase()}</span><span className={`status-label ${busy?'active':''}`}>{busy?<LoaderCircle className="spin" size={14}/>:project.output?<Check size={14}/>:<BookOpen size={14}/>} {statusText(project,t)}</span></p></div><button className="secondary compact" onClick={()=>openUpload()}><Plus size={18}/>{t.newBook}</button></section>
          {(project.error||project.job?.error)&&<ErrorNotice error={project.job?.error||project.error} t={t}/>}
          {project.source_pages?.some(p=>p.warning)&&<details className="notice"><summary>{t.pageWarning}</summary>{project.source_pages.filter(p=>p.warning).map(p=><p key={p.page}>{p.page}: {p.warning}</p>)}</details>}
          {!project.chapters.length?<section className="preparing-panel"><BookOpen size={35}/><h2>{busy?t.preparing:t.prepareError}</h2><p>{t.preparingHint}</p>{!busy&&<button className="primary" onClick={()=>runJob('resume')}>{t.resume}</button>}</section>:<div className="workspace">
            <section className="manuscript"><div className="chapter-tabs" role="tablist" aria-label={t.chapters}>{project.chapters.map((c,i)=><button key={i} role="tab" aria-selected={chapter===i} tabIndex={chapter===i?0:-1} onKeyDown={e=>{let next=i;if(e.key==='ArrowRight')next=(i+1)%project.chapters.length;else if(e.key==='ArrowLeft')next=(i+project.chapters.length-1)%project.chapters.length;else if(e.key==='Home')next=0;else if(e.key==='End')next=project.chapters.length-1;else return;e.preventDefault();selectChapter(next);document.getElementById('chapter-tab-'+next)?.focus()}} id={`chapter-tab-${i}`} aria-controls="chapter-panel" onClick={()=>selectChapter(i)}><span>{String(i+1).padStart(2,'0')}</span><span className="tab-title">{c.title}<small>{c.ready??c.sentences.filter(s=>s.ready).length}/{c.total??c.sentences.length} {t.chapterReady}</small></span></button>)}</div>
              <ListeningPlayer state={listenState} t={t} title={selectedChapter?.title} disabled={listenDisabled}
                onStart={()=>beginListening()} onPause={()=>listener.current?.pause()} onResume={()=>listener.current?.resume()}
                onStop={()=>listener.current?.reset()}/>
              <div className="reading-sheet" id="chapter-panel" role="tabpanel" aria-labelledby={`chapter-tab-${chapter}`}><div className="chapter-heading"><span className="chapter-number">{String(chapter+1).padStart(2,'0')}</span><div><h2>{selectedChapter?.title}</h2><p className="small muted">{selectedChapter?.sentences.length} {t.sentences}</p></div><button className="icon-button" disabled={listenDisabled} onClick={()=>beginListening()} aria-label={t.listenNow} title={t.listenNow}><Play size={20}/></button></div>
                <ol className="sentence-list">{selectedChapter?.sentences.map((row,i)=><li key={row.id} className={listenState.status==='playing'&&listenState.row?.id===row.id?'speaking':''} aria-current={listenState.status==='playing'&&listenState.row?.id===row.id?'true':undefined}><span className="sentence-number" aria-hidden="true">{i+1}</span><p>{row.speaker&&row.speaker!=='Narrator'&&<span className="speaker-label">{row.speaker==='Dialogue'?t.dialogue:row.speaker}</span>}{row.text}</p><div className="sentence-actions"><button className="icon-button" onClick={()=>setEditor(row)} disabled={busy} aria-label={`${t.edit} ${i+1}`} title={t.edit}><Pencil size={16}/></button><button className="icon-button" disabled={!row.ready} onClick={()=>play(row.audio,`${t.chapter} ${chapter+1} / ${i+1}`)} aria-label={`${t.listen} ${i+1}`} title={t.listen}><Volume2 size={16}/></button><span className={`sentence-state ${row.ready?'ready':''}`} aria-label={row.ready?t.complete:t.reviewing}>{row.ready?<Check size={12}/>:null}</span></div></li>)}</ol>
              </div>

              {playing&&<section className="player-panel"><div className="player-label"><Headphones size={18}/><strong>{playing.label}</strong></div><audio key={playing.src} ref={audio} controls autoPlay src={playing.src} onError={()=>setError('audioError')} aria-label={t.playback}/></section>}
              {project.output&&listenState.status==='idle'&&!playing&&<details className="completed-player"><summary>{t.finalAudio}</summary><audio controls src={project.output+'?v='+project.job?.id} preload="none" aria-label={t.finalAudio} onPlay={()=>listener.current?.reset()}/></details>}

            </section>
            <aside className="settings-panel"><div className="section-title"><Settings2 size={19}/><h2>{t.settings}</h2></div>
              <fieldset disabled={busy} className="form-stack"><label>{t.engine}<select value={settings?.engine||'xtts'} onChange={e=>updateSettings('engine',e.target.value)}>{engines.map(e=><option key={e.id} value={e.id} disabled={!e.installed}>{e.id==='say'?t.localVoice:e.id==='xtts'?t.neural:t.edge}{!e.installed?' — '+t.unavailable:''}</option>)}</select></label>
                <label>{t.voice}<select value={settings?.voice||''} onChange={e=>updateSettings('voice',e.target.value)}>{voiceOptions.map(v=><option key={v.id} value={v.id}>{v.name}</option>)}</select></label>
                <button className="text-button" onClick={()=>setClone(true)}><Plus size={16}/>{t.clone}</button>
                <div className="field-row"><label>{t.output}<select value={settings?.format||'m4b'} onChange={e=>updateSettings('format',e.target.value)}><option value="m4b">M4B</option><option value="mp3">MP3</option></select></label><label>{t.device}<select value={settings?.device||'auto'} onChange={e=>updateSettings('device',e.target.value)}><option value="auto">{t.automatic}</option><option value="cpu">CPU</option>{hardware?.device==='mps'&&<option value="mps">MPS</option>}{['cuda','rocm'].includes(hardware?.device)&&<option value={hardware.device}>{hardware.device.toUpperCase()}</option>}</select></label></div>
                {dirty&&<button className="secondary full" onClick={saveSettings}><Check size={17}/>{t.save}</button>}
              </fieldset>
              {dirty&&<p className="small muted" role="status">{t.unsaved}</p>}
              {settings?.engine==='xtts'&&!selectedEngine?.model_ready&&<div className="setup-note"><p><AlertCircle size={17}/><strong>{t.modelMissing}</strong></p><details><summary>{t.models}</summary><p>{t.modelHelp}</p><code>.venv/bin/pip install -e '.[xtts]'</code><code>.venv/bin/pagevoice setup-xtts</code><button className="text-button" onClick={()=>api('/api/engines').then(setEngines).catch(e=>setError(e.message))}><RefreshCw size={15}/>{t.retry}</button></details></div>}
              {settings?.engine==='edge'&&<div className="online-note"><p className="small">{t.onlineNotice}</p><label className="check-field"><input type="checkbox" checked={allowNetwork} onChange={e=>setAllowNetwork(e.target.checked)}/><span>{t.onlineConsent}</span></label></div>}
              <Casting project={project} voices={voiceOptions} busy={busy||dirty} t={t} onChange={changeCasting}/><div className="render-section"><div className="progress-caption"><span>{t.wholeBook}</span><strong>{project.progress.complete}/{project.progress.total}</strong></div><p className="small muted">{t.progress}</p><progress value={project.progress.complete} max={project.progress.total||1} aria-label={t.progress}/>
                <button className="primary full" disabled={busy||dirty||!readyEngine||(settings?.engine==='edge'&&!allowNetwork)} onClick={()=>runJob('listen',{chapter})}>{busy?<LoaderCircle className="spin" size={19}/>:<AudioLines size={19}/>} {busy?t.working:project.status==='paused'?t.resumePreparation:t.render}</button>
                {busy&&canListenDuringJob&&project.status!=='assembling'&&<button className="secondary full" disabled={project.listening?.pausing||pending} onClick={()=>runJob('pause')}>{project.listening?.pausing?t.pausingPreparation:t.pausePreparation}</button>}
                {project.output&&!busy&&<a className="secondary full" href={project.output} download><Download size={18}/>{t.download}</a>}
                {!busy&&project.status==='failed'&&<button className="secondary full" onClick={()=>runJob('resume')}>{t.resume}</button>}
                <p className="small muted">{busy?t.backgroundHint:t.engineHint}</p>{busy&&project.status==='synthesizing'&&project.progress.current_chapter!=null&&<p className="preparing-chapter">{t.preparingChapter} {project.progress.current_chapter+1}</p>}<p className="small muted">{t.forwardHint}</p>
              </div>
              {hardware&&<p className="hardware-note small muted">{t.detected}: <strong>{hardware.device.includes('unverified')?'CPU / ?':hardware.device.toUpperCase()}</strong><br/>{t.deviceHint}</p>}
            </aside>
          </div>}
        </>}
      </main>
    </div>
    {upload&&<UploadDialog initialFile={uploadFile} locale={locale} t={t} onClose={()=>setUpload(false)} onCreated={p=>{setProjects(all=>[p,...all]);setActiveId(p.id);setUpload(false)}}/>}
    {clone&&<CloneDialog locale={project?.language||locale} t={t} onClose={()=>setClone(false)} onCreated={v=>{setVoices(all=>[...all,v]);setClone(false);setNotice(t.cloneSaved)}}/>}
    {editor&&<SentenceEditor row={editor} t={t} busy={busy} onClose={()=>setEditor(null)} speakers={project?.speakers} onSave={saveSentence}/>}
  </>
}
