import React,{useState,useEffect} from 'react'
export function BookAnalysis({project,t,onChapter,onReanalyze,disabled}) {
 const [data,setData]=useState(null),[query,setQuery]=useState(''),[error,setError]=useState(''),[loading,setLoading]=useState(false)
 useEffect(()=>{setData(null);setQuery('');setError('')},[project.id])
 async function load(q='') {
  setLoading(true);setError('')
  try{const r=await fetch(`/api/projects/${project.id}/analysis?q=${encodeURIComponent(q)}`);if(!r.ok)throw Error(`Analysis: ${r.status}`);setData(await r.json())}
  catch(e){setError(e.message)}finally{setLoading(false)}
 }
 return <details className="book-analysis" onToggle={e=>{if(e.currentTarget.open&&!data&&!loading)load()}}>
  <summary>{t.analysis}<span>{t.analysisHint}</span></summary>
  {error&&<p role="alert">{error}</p>}
  <form onSubmit={e=>{e.preventDefault();load(query)}}><label className="sr-only" htmlFor="book-query">{t.searchBook}</label><input id="book-query" placeholder={t.searchBook} value={query} maxLength={500} onChange={e=>setQuery(e.target.value)}/><button className="secondary" disabled={loading}>{t.search}</button></form>
  <div className="analysis-results">{query&&data?.results?.length===0&&<p>{t.noResults}</p>}{data?.results?.map(r=><button type="button" className="passage" key={`${r.chapter}-${r.sentence}`} onClick={()=>onChapter(Number(r.chapter))}><strong>{r.title} · {Number(r.sentence)+1}</strong><span>{r.text}</span><small>{r.source}</small></button>)}</div>
  <ol className="analysis-map">{data?.sections?.map(s=><li key={s.index}><button className="text-button" onClick={()=>onChapter(s.index)}>{s.title}</button><small>{t[s.kind]}{s.review?` · ${t.reviewBoundary}`:''}</small><small title={s.source}>{s.source}</small></li>)}</ol>
  <p className="small muted">{t.reanalyzeHint}</p><button type="button" className="secondary" disabled={disabled} onClick={onReanalyze}>{t.reanalyze}</button>
 </details>
}
