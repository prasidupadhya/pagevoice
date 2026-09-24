import React, {useState} from 'react'

export function Casting({project,voices,busy,t,onChange}) {
  const [drag,setDrag]=useState('')
  function label(name){return name==='Narrator'?t.narrator:name==='Dialogue'?t.dialogue:name}
  return <section className="casting-board" aria-label={t.cast}>
    <h2>{t.cast}</h2><p className="small muted">{t.detectHint}</p>
    <button className="secondary full" disabled={busy} onClick={()=>onChange('speakers/detect',{},'POST')}>{t.detect}</button>
    <div className="voice-chips" aria-label={t.voice}>{voices.map(voice=><span key={voice.id} draggable={!busy} onDragStart={e=>{e.dataTransfer.setData('text/plain',voice.id);setDrag(voice.id)}} onDragEnd={()=>setDrag('')}>{voice.name}</span>)}</div>
    {(project.speakers||['Narrator']).map(speaker=><label key={speaker} className={drag?'drop-target':''} onDragOver={e=>{if(!busy)e.preventDefault()}} onDrop={e=>{e.preventDefault();const voice=e.dataTransfer.getData('text/plain');setDrag('');if(!busy&&voices.some(v=>v.id===voice))onChange('casting',{cast:{[speaker]:voice}},'PATCH')}}>
      {label(speaker)}<select aria-label={`${t.voice}: ${label(speaker)}`} disabled={busy} value={project.cast?.[speaker]||project.voice||''} onChange={e=>onChange('casting',{cast:{[speaker]:e.target.value}},'PATCH')}>
        {voices.map(voice=><option key={voice.id} value={voice.id}>{voice.name}</option>)}
      </select>
    </label>)}
  </section>
}
