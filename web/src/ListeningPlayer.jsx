import React from 'react'
import {Play,Pause,Square,Headphones,LoaderCircle} from 'lucide-react'

export function ListeningPlayer({state,t,onStart,onPause,onResume,onStop,disabled,title}) {
  const active=['buffering','playing','paused','blocked','error'].includes(state.status)
  const status=state.status==='playing'?t.listeningNow:state.status==='paused'?t.pauseListening:state.status==='ended'?t.listeningEnded:state.status==='buffering'?t.buffering:t.listeningReady
  return <section className="listening-player" aria-label={t.playback}>
    <div className="listening-heading"><span className="listening-symbol"><Headphones size={24}/></span><div><p className="small muted">{status}</p><h3>{state.row?.title||title||t.playback}</h3></div>
      {active&&<button className="icon-button" onClick={onStop} aria-label={t.stopListening}><Square size={18}/></button>}
    </div>
    {state.total>0&&<div className="buffer-progress"><div><span>{Math.min(state.ready,state.target)} / {state.target} {t.buffered}</span><span>{t.sentencePosition} {Math.min(state.cursor+1,state.total)} / {state.total}</span></div><progress max={state.target||20} value={Math.min(state.ready,state.target)} aria-label={t.buffering}/></div>}
    <div className="listening-controls">
      {['playing','buffering'].includes(state.status)?<button className="primary" onClick={onPause}>{state.status==='buffering'?<LoaderCircle size={18} className="spin"/>:<Pause size={18}/>} {t.pauseListening}</button>:
       ['paused','blocked','error'].includes(state.status)?<button className="primary" onClick={onResume}><Play size={18}/>{state.status==='blocked'?t.continueAudio:state.status==='error'?t.retry:t.resumeListening}</button>:
       <button className="primary" disabled={disabled} onClick={onStart}><Play size={18}/>{t.listenNow}</button>}
    </div>
    <p className="small muted" role={state.status==='error'?'alert':'status'}>{state.status==='error'?t.audioError:state.status==='buffering'&&state.cursor>0?t.fillingBuffer:active?t.backgroundHint:t.bufferHint}</p>
  </section>
}
