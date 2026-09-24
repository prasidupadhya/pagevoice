import {describe,it,expect,vi,afterEach} from 'vitest'
import {waitFor} from '@testing-library/react'
import {Listener,bufferStatus,forwardRows} from './listener'

const rows=(ready=30)=>Array.from({length:30},(_,i)=>({id:String(i),audio:`/audio/${i}`,ready:i<ready,chapter:2,title:'Chapter 3'}))
let engines=[]
afterEach(async()=>{await Promise.all(engines.map(e=>e.dispose()));engines=[]})
function setup(fetcher=vi.fn(async()=>({ok:true,arrayBuffer:async()=>new ArrayBuffer(8)}))) {
  const context={state:'running',currentTime:0,destination:{},resume:vi.fn(async()=>{context.state='running'}),suspend:vi.fn(async()=>{context.state='suspended'}),close:vi.fn(async()=>{}),decodeAudioData:vi.fn(async()=>({duration:2})),createBufferSource:vi.fn(()=>({playbackRate:{value:1},connect:vi.fn(),disconnect:vi.fn(),start:vi.fn(),stop:vi.fn()}))}
  const changed=vi.fn(),engine=new Listener(changed,{contextFactory:()=>context,fetcher});engines.push(engine)
  return {engine,context,fetcher,changed}
}
describe('progressive audio scheduling',()=>{
  it('requires 20 consecutive ready sentences, not 20 scattered sentences',async()=>{
    const {engine,fetcher}=setup();await engine.start(rows(19))
    expect(engine.status).toBe('buffering');expect(fetcher).not.toHaveBeenCalled()
    engine.update(rows(20));await waitFor(()=>expect(engine.nodes.length).toBe(4))
    expect(engine.status).toBe('playing')
    expect(engine.nodes[1].start).toBe(engine.nodes[0].end)
    const broken=rows();broken[2].ready=false;expect(bufferStatus(broken).canStart).toBe(false)
  })
  it('allows a short remaining tail and traverses chapters only forward',async()=>{
    const project={chapters:[0,1,2,3].map(index=>({index,title:String(index),sentences:rows(30).slice(0,3)}))}
    const forward=forwardRows(project,2);expect(forward.map(r=>r.chapter)).toEqual([2,2,2,3,3,3])
    const {engine}=setup();await engine.start(forward);expect(engine.status).toBe('playing');expect(bufferStatus(forward).target).toBe(6)
  })
  it('pauses and resumes without losing position; chapter changes cancel old audio',async()=>{
    const {engine,context}=setup();await engine.start(rows())
    const old=engine.nodes.map(n=>n.source)
    await engine.pause();expect(context.suspend).toHaveBeenCalled();expect(engine.status).toBe('paused')
    await engine.resume();expect(engine.status).toBe('playing')
    await engine.start(rows().map(r=>({...r,id:'new-'+r.id})))
    expect(old.every(n=>n.stop.mock.calls.length===1)).toBe(true)
    expect(engine.rows[0].id).toBe('new-0')
  })
  it('waits for a missing next sentence and resumes when the SSE update arrives',async()=>{
    const {engine}=setup();await engine.start(rows(20))
    for(let i=0;i<20;i++){
      await waitFor(()=>expect(engine.nodes.length).toBeGreaterThan(0))
      const node=engine.nodes[0];node.source.onended()
    }
    await waitFor(()=>expect(engine.status).toBe('buffering'))
    engine.update(rows(21));await waitFor(()=>expect(engine.nodes.length).toBe(1))
    expect(engine.nodes[0].index).toBe(20)
  })
  it('does not autoplay new audio while the listener has paused buffering',async()=>{
    const {engine}=setup();await engine.start(rows(5));await engine.pause()
    engine.update(rows(20));expect(engine.nodes.length).toBe(0);expect(engine.status).toBe('paused')
    await engine.resume();await waitFor(()=>expect(engine.nodes.length).toBe(4))
  })
  it('stops queued audio and exposes failed downloads for retry',async()=>{
    const {engine}=setup(vi.fn(async()=>({ok:false})))
    await engine.start(rows());expect(engine.status).toBe('error');expect(engine.nodes.length).toBe(0)
  })
})

it('calls browser fetch with its correct global receiver',async()=>{
 const {context}=setup()
 vi.stubGlobal('fetch',function(){if(this instanceof Listener)throw new TypeError('Illegal invocation');return Promise.resolve({ok:true,arrayBuffer:async()=>new ArrayBuffer(8)})})
 const engine=new Listener(()=>{},{contextFactory:()=>context});engines.push(engine)
 await engine.start(rows());expect(engine.status).toBe('playing');expect(engine.nodes.length).toBe(4)
})
