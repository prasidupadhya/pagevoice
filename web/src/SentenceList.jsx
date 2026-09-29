import React,{useRef,useEffect,useCallback} from 'react'
import {useVirtualizer} from '@tanstack/react-virtual'
import {Pencil,Play,Check,Bookmark} from 'lucide-react'

export function SentenceList({rows=[],state,t,busy,onEdit,onListen,onBookmark,bookmarks=[],focusRequest,textSize=21}) {
  const scroll=useRef(null),virtual=rows.length>80
  const getKey=useCallback(i=>rows[i].id,[rows])
  const list=useVirtualizer({count:rows.length,getScrollElement:()=>scroll.current,estimateSize:()=>140,overscan:5,getItemKey:getKey,enabled:virtual,initialRect:{width:600,height:550}})
  useEffect(()=>{
    if(!focusRequest)return
    const index=rows.findIndex(r=>r.id===focusRequest.id);if(index<0)return
    if(virtual)list.scrollToIndex(index,{align:'center'})
    const timer=setTimeout(()=>{const node=document.getElementById('sentence-'+focusRequest.id);node?.focus();node?.scrollIntoView?.({block:'nearest'})},80)
    return()=>clearTimeout(timer)
  },[focusRequest,rows.length])
  const active=rows.findIndex(r=>r.id===state.row?.id)
  useEffect(()=>{
    if(state.status!=='playing'||active<0)return
    if(virtual)list.scrollToIndex(active,{align:'auto'})
    else document.getElementById('sentence-'+rows[active].id)?.scrollIntoView?.({block:'nearest',behavior:'auto'})
  },[active,state.status])
  const items=virtual?list.getVirtualItems():rows.map((_,index)=>({index,key:rows[index].id}))
  return <div ref={scroll} className="sentence-scroll" tabIndex={0} role="region" aria-label={t.text} style={{'--reading-size':`${textSize}px`}}>
    <ol className="sentence-list" style={virtual?{height:list.getTotalSize(),position:'relative'}:undefined}>
      {items.map(item=>{const row=rows[item.index],speaking=state.status==='playing'&&state.row?.id===row.id;return <li key={item.key} ref={virtual?list.measureElement:undefined} data-index={item.index} id={`sentence-${row.id}`} tabIndex={-1} aria-posinset={item.index+1} aria-setsize={rows.length} aria-current={speaking?'true':undefined} className={`${row.ready?'inked':'graphite'} ${speaking?'speaking':''}`} style={virtual?{position:'absolute',top:0,left:0,width:'100%',transform:`translateY(${item.start}px)`}:undefined}>
        <span className="sentence-number" aria-hidden="true">{item.index+1}</span>
        <button className="sentence-text" onClick={()=>onListen(item.index)} aria-label={`${t.listenNow}: ${row.text}`}>
          {row.speaker&&row.speaker!=='Narrator'&&<span className="speaker-label">{row.speaker==='Dialogue'?t.dialogue:row.speaker}</span>}{row.text}
        </button>
        <div className="sentence-actions">
          <button className="icon-button" onClick={()=>onBookmark(row.id)} aria-pressed={bookmarks.includes(row.id)} aria-label={`${t.bookmark} ${item.index+1}`}><Bookmark size={16} fill={bookmarks.includes(row.id)?'currentColor':'none'}/></button>
          <button className="icon-button" onClick={()=>onEdit(row)} disabled={busy} aria-label={`${t.edit} ${item.index+1}`}><Pencil size={16}/></button>
          <button className="icon-button" onClick={()=>onListen(item.index)} aria-label={`${t.listen} ${item.index+1}`}><Play size={16}/></button>
          <span role="img" className={`sentence-state ${row.ready?'ready':''}`} aria-label={row.ready?t.complete:t.reviewing}>{row.ready?<Check size={12}/>:null}</span>
        </div>
      </li>})}
    </ol>
  </div>
}
