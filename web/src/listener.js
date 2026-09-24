// Original bounded Web Audio scheduler. Readiness is contiguous, never just a count.
export function forwardRows(project, chapter) {
  return (project?.chapters||[]).slice(chapter).flatMap(c=>c.sentences.map((row,i)=>({...row,chapter:c.index,sentence:i,title:c.title})))
}
export function bufferStatus(rows, cursor=0) {
  let ready=0
  for(let i=cursor;i<rows.length&&rows[i].ready;i++)ready++
  const target=Math.min(20,rows.length-cursor)
  return {ready,target,canStart:target>0&&ready>=target}
}

export class Listener {
  constructor(onChange,{contextFactory=()=>new (window.AudioContext||window.webkitAudioContext)(),fetcher=(url,options)=>fetch(url,options)}={}) {
    this.onChange=onChange;this.contextFactory=contextFactory;this.fetcher=fetcher
    this.rows=[];this.cursor=0;this.next=0;this.nodes=[];this.version=0;this.status='idle';this.intent=false;this.started=false;this.pumping=false
  }
  emit(status=this.status) {
    this.status=status
    this.onChange({status,cursor:this.cursor,row:this.rows[this.cursor],...bufferStatus(this.rows,this.cursor),total:this.rows.length})
  }
  update(rows) {this.rows=rows;this.emit();this.pump()}
  async start(rows) {
    this.reset();this.rows=rows;this.intent=true;const version=this.version
    try {
      this.context ||= this.contextFactory()
      // Called synchronously from the click handler to unlock audio before buffering.
      const resumed=this.context.resume()
      this.emit('buffering');await resumed
      if(version!==this.version)return
      if(this.context.state==='suspended'){this.emit('blocked');return}
      await this.pump()
    } catch(e) {if(version===this.version)this.emit('error')}
  }
  reset() {
    this.version++;this.abort?.abort();this.abort=new AbortController()
    for(const node of this.nodes){node.source.onended=null;try{node.source.stop()}catch{};node.source.disconnect()}
    this.nodes=[];this.cursor=0;this.next=0;this.offset=0;this.started=false;this.intent=false;this.pumping=false
    clearInterval(this.timer);this.timer=null;this.emit('idle')
  }
  async pause() {this.intent=false;await this.context?.suspend();this.emit('paused')}
  async resume() {
    this.intent=true
    try{await this.context?.resume();if(this.context?.state==='suspended'){this.emit('blocked');return};this.emit(this.nodes.length?'playing':'buffering');this.pump()}
    catch{this.emit('blocked')}
  }
  tick() {
    const current=this.nodes.find(n=>n.start<=this.context.currentTime&&n.end>this.context.currentTime)
    if(current&&this.cursor!==current.index){this.cursor=current.index;this.emit()}
  }
  async pump() {
    if(this.pumping||!this.intent||!this.context||this.status==='error'||this.status==='blocked')return
    if(!this.started&&!bufferStatus(this.rows,this.cursor).canStart){this.emit('buffering');return}
    this.pumping=true;const version=this.version
    try {
      while(this.intent&&this.nodes.length<4&&this.next<this.rows.length&&this.rows[this.next].ready) {
        const index=this.next,row=this.rows[index]
        const response=await this.fetcher(row.audio,{signal:this.abort.signal})
        if(!response.ok)throw new Error('audio unavailable')
        const buffer=await this.context.decodeAudioData(await response.arrayBuffer())
        if(version!==this.version)return
        const source=this.context.createBufferSource();source.buffer=buffer;source.connect(this.context.destination)
        const start=Math.max(this.context.currentTime+.06,this.nodes.at(-1)?.end||0)
        const node={source,index,start,end:start+buffer.duration}
        this.nodes.push(node);this.next++;this.started=true
        source.onended=()=>{
          if(version!==this.version)return
          this.nodes=this.nodes.filter(n=>n!==node);source.disconnect()
          this.cursor=Math.max(this.cursor,index+1)
          if(this.cursor>=this.rows.length){this.intent=false;clearInterval(this.timer);this.emit('ended');return}
          this.emit(this.intent?(this.nodes.length?'playing':'buffering'):'paused');this.pump()
        }
        source.start(start)
        if(!this.timer)this.timer=setInterval(()=>this.tick(),150)
        this.emit(this.intent?'playing':'paused')
      }
      if(!this.nodes.length&&this.cursor<this.rows.length&&this.intent)this.emit('buffering')
    } catch(e) {
      if(version===this.version&&e.name!=='AbortError'){const cursor=this.cursor;this.reset();this.cursor=cursor;this.next=cursor;this.emit('error')}
    } finally {
      if(version===this.version)this.pumping=false
    }
  }
  async dispose(){this.reset();await this.context?.close()}
}
