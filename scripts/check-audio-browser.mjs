import {spawn} from 'node:child_process'
import {mkdtemp,readFile,rm,open} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
// Audio-engine integration only: no DOM inspection, clicks, or screenshots.
// Requires a running PageVoice and at least one completed English sentence.
const url=process.env.PAGEVOICE_URL||'http://127.0.0.1:8765/'
const executable=process.env.CHROME_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const dir=await mkdtemp(join(tmpdir(),'pagevoice-audio-'))
const log=await open(join(dir,'chrome.log'),'w')
const chrome=spawn(executable,['--headless=new','--no-first-run','--no-default-browser-check','--mute-audio','--remote-debugging-port=0',`--user-data-dir=${dir}`,'about:blank'],{stdio:['ignore',log.fd,log.fd]})
let ws
try {
 let port
 for(let i=0;i<100;i++){try{port=(await readFile(join(dir,'DevToolsActivePort'),'utf8')).split('\n')[0];break}catch{};await new Promise(r=>setTimeout(r,100))}
 if(!port)throw new Error('Chrome did not start')
 const targets=await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
 ws=new WebSocket(targets.find(t=>t.type==='page').webSocketDebuggerUrl)
 await new Promise((resolve,reject)=>{ws.onopen=resolve;ws.onerror=reject})
 let id=0;const pending=new Map()
 ws.onmessage=event=>{const m=JSON.parse(event.data);if(pending.has(m.id)){const p=pending.get(m.id);pending.delete(m.id);m.error?p.reject(m.error):p.resolve(m.result)}}
 const call=(method,params={})=>new Promise((resolve,reject)=>{const key=++id;pending.set(key,{resolve,reject});ws.send(JSON.stringify({id:key,method,params}))})
 await call('Page.navigate',{url})
 await new Promise(r=>setTimeout(r,500))
 const code=(await readFile(new URL('../web/src/listener.js',import.meta.url),'utf8')).replaceAll('export ','')
 const result=await call('Runtime.evaluate',{userGesture:true,awaitPromise:true,returnByValue:true,expression:`(async()=>{${code}
 const projects=await (await fetch('/api/projects')).json();const p=projects.find(p=>p.language==='en'&&p.chapters.some(c=>c.sentences.some(s=>s.ready)));const row=p.chapters.flatMap(c=>c.sentences).find(s=>s.ready);
 if(!row)throw new Error('No real speech available');
 const rows=Array.from({length:21},(_,i)=>({...row,id:String(i),ready:i<19}));const states=[];
 const engine=new Listener(s=>states.push(s.status));
 try{
 await engine.start(rows);if(engine.status!=='buffering'||engine.nodes.length)throw new Error('Started before 20 sentences');
 engine.update(rows.map(r=>({...r,ready:true})));for(let i=0;i<100&&engine.nodes.length<4;i++)await new Promise(r=>setTimeout(r,20));
 if(engine.nodes.length!==4)throw new Error('Could not decode/schedule real speech: '+JSON.stringify({status:engine.status,nodes:engine.nodes.length,states,context:engine.context.state,url:row.audio,response:(await fetch(row.audio)).status}));
 const n=engine.nodes;if(Math.abs(n[1].start-n[0].end)>.001)throw new Error('Non-contiguous scheduled audio');
 await engine.pause();if(engine.context.state!=='suspended')throw new Error('Pause failed');await engine.resume();if(engine.context.state!=='running')throw new Error('Resume failed');
 return {threshold:20,scheduled:engine.nodes.length,sampleRate:engine.context.sampleRate,decodedSeconds:engine.nodes[0].source.buffer.duration,pauseResume:true,sourceLanguage:p.language};
 }finally{await engine.dispose()}
 })()`})
 if(result.exceptionDetails)throw new Error(JSON.stringify(result.exceptionDetails))
 console.log(JSON.stringify(result.result.value,null,2))
}finally{ws?.close();chrome.kill('SIGTERM');await new Promise(r=>chrome.once('exit',r));await log.close();await rm(dir,{recursive:true,force:true})}
