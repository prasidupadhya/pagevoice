import React,{useEffect,useState} from 'react'
import {api} from './api'

export function DeleteBook({project,t,Modal,onClose,onDeleted,onStopping}) {
 const [info,setInfo]=useState(null),[confirmation,setConfirmation]=useState(''),[pending,setPending]=useState(false),[error,setError]=useState('')
 useEffect(()=>{let alive=true;api(`/api/projects/${project.id}/deletion`).then(v=>{if(alive)setInfo(v)}).catch(e=>{if(alive)setError(e.message)});return()=>{alive=false}},[project.id])
 async function remove(e){
  e.preventDefault();setPending(true);setError('');onStopping(project.id)
  try{const receipt=await api(`/api/projects/${project.id}`,{method:'DELETE'});onDeleted(receipt)}
  catch(e){setError(e.message);setPending(false)}
 }
 return <Modal title={t.deleteBook} t={t} onClose={()=>{if(!pending)onClose()}}><form onSubmit={remove} className="form-stack">
  <p><strong>{project.title}</strong></p><p>{t.deleteExplanation}</p>
  {info&&<><p>{info.source_shared?t.deleteSharedSource:t.deleteSource}</p><p>{t.diskFreed}: <strong>{info.bytes.toLocaleString()} {t.bytes}</strong> {t.afterUndo}</p>
   {info.has_audio&&<label>{t.typeDelete}<input autoComplete="off" value={confirmation} onChange={e=>setConfirmation(e.target.value)} placeholder={t.deleteWord}/></label>}</>}
  {error&&<p role="alert">{error}</p>}{pending&&<p role="status">{t.stoppingDelete}</p>}
  <div className="actions"><button type="button" className="secondary" disabled={pending} onClick={onClose}>{t.cancel}</button><button className="primary danger" disabled={!info||pending||(info.has_audio&&confirmation!==t.deleteWord)}>{t.deleteBook}</button></div>
 </form></Modal>
}

export function UndoDeletion({receipt,t,onRestore,onExpire}) {
 const [remaining,setRemaining]=useState(Math.max(0,Math.ceil(receipt.expires*1000-Date.now())/1000)),[error,setError]=useState(''),[pending,setPending]=useState(false)
 useEffect(()=>{const timer=setInterval(()=>{const left=Math.max(0,(receipt.expires*1000-Date.now())/1000);setRemaining(left);if(!left)onExpire(receipt.id)},100);return()=>clearInterval(timer)},[receipt.id,receipt.expires,onExpire])
 async function restore(){setPending(true);try{const p=await api(`/api/trash/${receipt.id}/restore`,{method:'POST'});onRestore(p)}catch(e){setError(e.message);setPending(false)}}
 return <div className="undo-toast"><p role="status">{t.bookDeleted}: {receipt.title}</p><button className="secondary" disabled={pending||remaining<=0} onClick={restore}>{t.undo} ({Math.ceil(remaining)})</button>{error&&<p role="alert">{error}</p>}</div>
}
