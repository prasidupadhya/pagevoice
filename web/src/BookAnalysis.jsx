import {request as fetch} from './api'
import React,{useState,useEffect,useRef} from 'react'
export function BookAnalysis({project,t,onChapter,onReanalyze,onReviewed,onListen,disabled}) {
 const [data,setData]=useState(null),[query,setQuery]=useState(''),[filter,setFilter]=useState(''),[submitted,setSubmitted]=useState(false)
 const [kind,setKind]=useState(''),[matchType,setMatchType]=useState(''),[copied,setCopied]=useState(''),[extras,setExtras]=useState(null)
 const [error,setError]=useState(''),[loading,setLoading]=useState(false),[edit,setEdit]=useState(null),[saving,setSaving]=useState(false)
 const request=useRef(null)
 useEffect(()=>{load();return()=>request.current?.abort()},[project.id])
 async function load(q='',chapter='',sectionKind=kind,match=matchType) {
  request.current?.abort();const controller=new AbortController();request.current=controller
  setLoading(true);setError('')
  try {
   const params=new URLSearchParams({q});if(chapter!=='')params.set('chapter',chapter);if(sectionKind)params.set('kind',sectionKind);if(match)params.set('match_type',match)
   const r=await fetch(`/api/projects/${project.id}/analysis?${params}`,{signal:controller.signal})
   const body=await r.json();if(!r.ok)throw Error(body.detail||`Analysis: ${r.status}`)
   if(!controller.signal.aborted)setData(body)
  } catch(e){if(e.name!=='AbortError')setError(e.message)}finally{if(!controller.signal.aborted)setLoading(false)}
 }
 useEffect(()=>{if(!query&&!submitted)return;const timer=setTimeout(()=>{setSubmitted(true);load(query,filter,kind,matchType)},250);return()=>clearTimeout(timer)},[query,filter,kind,matchType])
 async function feature(name){setError('');try{const response=await fetch(`/api/projects/${project.id}/analysis/${name}`);if(!response.ok)throw Error(t.unexpected);setExtras({name,data:await response.json()})}catch(e){setError(e.message)}}
 async function copy(hit){try{await navigator.clipboard.writeText(`${project.title} — ${hit.title}, ${t.sentencePosition} ${hit.sentence+1} [${hit.citation}] ${hit.source}`);setCopied(hit.citation)}catch{setError(t.unexpected)}}
 async function save(e) {
  e.preventDefault();setSaving(true);setError('')
  try {
   const r=await fetch(`/api/projects/${project.id}/analysis`,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify(edit)})
   const body=await r.json();if(!r.ok)throw Error(body.detail||`Analysis: ${r.status}`)
   onReviewed?.(body);if(edit.start_here)onChapter(edit.chapter);setEdit(null);await load(query,filter)
  } catch(e){setError(e.message)}finally{setSaving(false)}
 }
 return <details className="book-analysis">
  <summary>{t.analysis}<span>{t.analysisHint}{data?.review_count>0?` · ${data.review_count} ${t.reviewCount}`:''}</span></summary>
  {(project.narration_version||1)<2&&<p className="analysis-upgrade">{t.oldAnalysis}</p>}
  {error&&<p role="alert">{error}</p>}
  {loading&&!data&&<p role="status">{t.analysisLoading}</p>}
  <div className="structure-ribbon" aria-label={t.analysis}>{data?.sections?.map(section=><button key={section.index} className={section.kind} style={{flex:Math.max(1,Math.sqrt(section.sentences||1))}} aria-label={`${section.title}: ${t[section.kind]}, ${t[section.confidence_level]||t[section.confidence]}`} title={`${section.title}: ${t[section.kind]}`} onClick={()=>onChapter(section.index)}><span>{section.index+1}</span></button>)}</div>
  <form className="book-search" onSubmit={e=>{e.preventDefault();setSubmitted(true);load(query,filter)}}>
   <label className="sr-only" htmlFor="book-query">{t.searchBook}</label><input id="book-query" placeholder={t.searchBook} value={query} maxLength={500} onChange={e=>setQuery(e.target.value)}/>
   <label className="sr-only" htmlFor="search-section">{t.allSections}</label><select id="search-section" value={filter} onChange={e=>setFilter(e.target.value)}><option value="">{t.allSections}</option>{project.chapters.map(c=><option key={c.index} value={c.index}>{c.title}</option>)}</select>
   <select aria-label={t.filterKind} value={kind} onChange={e=>setKind(e.target.value)}><option value="">{t.allSections}</option>{['chapter','front_matter','back_matter','unclassified'].map(k=><option key={k} value={k}>{t[k]}</option>)}</select>
   <select aria-label={t.matchType} value={matchType} onChange={e=>setMatchType(e.target.value)}><option value="">{t.anyMatch}</option>{['exact','phrase','stem','partial','fuzzy'].map(k=><option key={k} value={k}>{t[k]}</option>)}</select>
   <button className="secondary" disabled={loading}>{t.search}</button>
  </form>
  <div className="analysis-results" aria-live="polite" onKeyDown={e=>{if(!['ArrowDown','ArrowUp'].includes(e.key))return;const buttons=[...e.currentTarget.querySelectorAll('button')],index=buttons.indexOf(document.activeElement);if(index<0)return;e.preventDefault();buttons[(index+(e.key==='ArrowDown'?1:-1)+buttons.length)%buttons.length]?.focus()}}>{submitted&&!loading&&data?.results?.length===0&&<p>{t.noResults}</p>}{data?.results?.map(r=><article className="passage" key={r.citation}><button className="passage-source" onClick={()=>onChapter(r.chapter,r.sentence)}><strong>{r.title} · {r.sentence+1}{r.match==='partial'?` · ${t.partialMatch}`:''}</strong><span><Highlight text={r.context||r.text} terms={r.matched_terms||[]}/></span></button><span className="match-badge">{t[r.match_type||r.match]||r.match_type}</span><small>{r.source} · {r.citation}</small><div className="passage-actions"><button className="text-button" onClick={()=>onChapter(r.chapter,r.sentence)}>{t.showSource}</button>{onListen&&<button className="text-button" onClick={()=>onListen(r.chapter,r.sentence)}>{t.listenNow}</button>}<button className="text-button" onClick={()=>copy(r)}>{copied===r.citation?t.copied:t.copyCitation}</button></div></article>)}</div>
  <div className="feature-actions"><button className="text-button" onClick={()=>feature('summaries')}>{t.extractiveSummary}</button><button className="text-button" onClick={()=>feature('entities')}>{t.keywords}</button></div>
  {extras?.name==='summaries'&&<div className="extractive-results">{extras.data.summaries?.map(c=><section key={c.chapter}><h3>{project.chapters[c.chapter]?.title}</h3><p className="small muted">{t.extractiveSummary} · {c.reading_minutes} {t.minutes}</p>{c.sentences?.map(s=><button className="passage" key={s.citation} onClick={()=>onChapter(s.chapter,s.sentence)}>{s.text}<small>{s.citation}</small></button>)}</section>)}</div>}
  {extras?.name==='entities'&&<div className="keyword-index">{[...(extras.data.entities||[]),...(extras.data.keywords||[])].slice(0,40).map((e,i)=><button className="secondary" key={i} onClick={()=>{setQuery(e.term||e.name);setSubmitted(true)}}>{e.term||e.name} <small>{e.count}</small></button>)}</div>}

  <ol className="analysis-map">{data?.sections?.map(s=><li key={s.index}>
   <div className="analysis-section-heading"><button className="text-button" onClick={()=>onChapter(s.index)}>{s.title}</button><button className="text-button" disabled={disabled||saving} onClick={()=>setEdit({chapter:s.index,title:s.title,kind:s.kind,start_here:false})}>{t.correctSection}</button></div>
   <small>{t[s.kind]} · {t[s.confidence_level]||t[s.confidence]||s.confidence}</small>{s.flags?.length>0&&<details className="structure-flags"><summary>{t.structureFlags} ({s.flags.length})</summary>{s.flags.map((f,i)=><p key={i}>{t[f.code]||f.code}: {typeof f.evidence==='string'?f.evidence:JSON.stringify(f.evidence)}</p>)}</details>}
   <details className="source-evidence"><summary>{t.sourceEvidence}</summary><p>{s.excerpt}</p><small>{s.source||t.reviewBoundary}</small><ul>{s.reasons?.map(reason=><li key={reason}>{t[reason]||reason}</li>)}</ul></details>
   {edit?.chapter===s.index&&<form className="section-review" onSubmit={save}><label>{t.sectionTitle}<input value={edit.title} maxLength={200} required onChange={e=>setEdit({...edit,title:e.target.value})}/></label><label>{t.sectionKind}<select value={edit.kind} onChange={e=>setEdit({...edit,kind:e.target.value})}>{['chapter','front_matter','back_matter','unclassified'].map(kind=><option key={kind} value={kind}>{t[kind]}</option>)}</select></label><label className="check-field"><input type="checkbox" checked={edit.start_here} onChange={e=>setEdit({...edit,start_here:e.target.checked})}/>{t.startHere}</label><div className="actions"><button type="button" className="secondary" onClick={()=>setEdit(null)}>{t.cancel}</button><button className="primary" disabled={saving||disabled}>{t.saveSection}</button></div></form>}
  </li>)}</ol>
  <p className="small muted">{t.reanalyzeHint}</p><button type="button" className="secondary" disabled={disabled||saving} onClick={onReanalyze}>{t.reanalyze}</button>
 </details>
}

function Highlight({text,terms}) {
 const fold=s=>s.toLocaleLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'')
 const matches=new Set(terms.map(fold))
 return text.split(/([\p{L}\p{N}]+)/u).map((part,i)=>matches.has(fold(part))?<mark key={i}>{part}</mark>:part)
}
