import React,{useState,useEffect,useRef} from 'react'
export function BookAnalysis({project,t,onChapter,onReanalyze,onReviewed,disabled}) {
 const [data,setData]=useState(null),[query,setQuery]=useState(''),[filter,setFilter]=useState(''),[submitted,setSubmitted]=useState(false)
 const [error,setError]=useState(''),[loading,setLoading]=useState(false),[edit,setEdit]=useState(null),[saving,setSaving]=useState(false)
 const request=useRef(null)
 useEffect(()=>{load();return()=>request.current?.abort()},[project.id])
 async function load(q='',chapter='') {
  request.current?.abort();const controller=new AbortController();request.current=controller
  setLoading(true);setError('')
  try {
   const params=new URLSearchParams({q});if(chapter!=='')params.set('chapter',chapter)
   const r=await fetch(`/api/projects/${project.id}/analysis?${params}`,{signal:controller.signal})
   const body=await r.json();if(!r.ok)throw Error(body.detail||`Analysis: ${r.status}`)
   if(!controller.signal.aborted)setData(body)
  } catch(e){if(e.name!=='AbortError')setError(e.message)}finally{if(!controller.signal.aborted)setLoading(false)}
 }
 async function save(e) {
  e.preventDefault();setSaving(true);setError('')
  try {
   const r=await fetch(`/api/projects/${project.id}/analysis`,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify(edit)})
   const body=await r.json();if(!r.ok)throw Error(body.detail||`Analysis: ${r.status}`)
   onReviewed?.(body);if(edit.start_here)onChapter(edit.chapter);setEdit(null);await load(query,filter)
  } catch(e){setError(e.message)}finally{setSaving(false)}
 }
 return <details className="book-analysis" open>
  <summary>{t.analysis}<span>{t.analysisHint}{data?.review_count>0?` · ${data.review_count} ${t.reviewCount}`:''}</span></summary>
  {(project.narration_version||1)<2&&<p className="analysis-upgrade">{t.oldAnalysis}</p>}
  {error&&<p role="alert">{error}</p>}
  {loading&&!data&&<p role="status">{t.analysisLoading}</p>}
  <form className="book-search" onSubmit={e=>{e.preventDefault();setSubmitted(true);load(query,filter)}}>
   <label className="sr-only" htmlFor="book-query">{t.searchBook}</label><input id="book-query" placeholder={t.searchBook} value={query} maxLength={500} onChange={e=>setQuery(e.target.value)}/>
   <label className="sr-only" htmlFor="search-section">{t.allSections}</label><select id="search-section" value={filter} onChange={e=>setFilter(e.target.value)}><option value="">{t.allSections}</option>{project.chapters.map(c=><option key={c.index} value={c.index}>{c.title}</option>)}</select>
   <button className="secondary" disabled={loading}>{t.search}</button>
  </form>
  <div className="analysis-results" aria-live="polite">{submitted&&!loading&&data?.results?.length===0&&<p>{t.noResults}</p>}{data?.results?.map(r=><button type="button" className="passage" key={r.citation} onClick={()=>onChapter(r.chapter,r.sentence)}><strong>{r.title} · {r.sentence+1}{r.match==='partial'?` · ${t.partialMatch}`:''}</strong><span>{r.context||r.text}</span><small>{r.source} · {r.citation}</small></button>)}</div>
  <ol className="analysis-map">{data?.sections?.map(s=><li key={s.index}>
   <div className="analysis-section-heading"><button className="text-button" onClick={()=>onChapter(s.index)}>{s.title}</button><button className="text-button" disabled={disabled||saving} onClick={()=>setEdit({chapter:s.index,title:s.title,kind:s.kind,start_here:false})}>{t.correctSection}</button></div>
   <small>{t[s.kind]} · {t[s.confidence]||s.confidence}</small>
   <details className="source-evidence"><summary>{t.sourceEvidence}</summary><p>{s.excerpt}</p><small>{s.source||t.reviewBoundary}</small><ul>{s.reasons?.map(reason=><li key={reason}>{t[reason]||reason}</li>)}</ul></details>
   {edit?.chapter===s.index&&<form className="section-review" onSubmit={save}><label>{t.sectionTitle}<input value={edit.title} maxLength={200} required onChange={e=>setEdit({...edit,title:e.target.value})}/></label><label>{t.sectionKind}<select value={edit.kind} onChange={e=>setEdit({...edit,kind:e.target.value})}>{['chapter','front_matter','back_matter','unclassified'].map(kind=><option key={kind} value={kind}>{t[kind]}</option>)}</select></label><label className="check-field"><input type="checkbox" checked={edit.start_here} onChange={e=>setEdit({...edit,start_here:e.target.checked})}/>{t.startHere}</label><div className="actions"><button type="button" className="secondary" onClick={()=>setEdit(null)}>{t.cancel}</button><button className="primary" disabled={saving||disabled}>{t.saveSection}</button></div></form>}
  </li>)}</ol>
  <p className="small muted">{t.reanalyzeHint}</p><button type="button" className="secondary" disabled={disabled||saving} onClick={onReanalyze}>{t.reanalyze}</button>
 </details>
}
