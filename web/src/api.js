export const API_BASE=(import.meta.env.VITE_API_BASE_URL||'').replace(/\/$/,'')
let accessToken=''
export function setAccessToken(value){accessToken=value}
export function apiURL(path){return /^(https?:|blob:)/.test(path)?path:API_BASE+path}
export function request(path,options={}) {
  const destination=apiURL(path)
  const expected=new URL(API_BASE||window.location.origin,window.location.origin).origin
  if(new URL(destination,window.location.origin).origin!==expected)throw new Error('Unexpected backend origin')
  const headers=options.body instanceof FormData?{}:{'Content-Type':'application/json'}
  return fetch(destination,{...options,headers:{...headers,...(accessToken?{Authorization:`Bearer ${accessToken}`}:{ }),...options.headers}})
}
export async function api(path, options={}) {
  let response
  try { response=await request(path,options) }
  catch(e) {if(e.name==='AbortError')throw e;throw new Error('apiOffline')}
  if (!response.ok) {
    if(response.status===507)throw new Error('storageQuota')
    if(response.status===429)throw new Error('rateLimit')
    if(response.status===401)window.dispatchEvent(new Event('pagevoice-auth'))
    const body=await response.json().catch(()=>({}))
    throw new Error(typeof body.detail==='string'?body.detail:JSON.stringify(body.detail||response.statusText))
  }
  try{return await response.json()}catch{throw new Error('backendNotConfigured')}
}

// Fetch-based SSE supports Authorization without putting a shared secret in a URL.
export function progressEvents(path) {
  if(!accessToken)return new EventSource(apiURL(path))
  const listeners=new Map(),controller=new AbortController()
  const events={close(){controller.abort();clearTimeout(events.timer)},addEventListener(name,fn){listeners.set(name,fn)}}
  async function connect(){
    try{
      const response=await request(path,{signal:controller.signal})
      if(!response.ok)throw Error('Progress unavailable')
      events.onopen?.();const reader=response.body.getReader(),decoder=new TextDecoder();let pending=''
      while(!controller.signal.aborted){const {value,done}=await reader.read();if(done)break;pending+=decoder.decode(value,{stream:true});let end
        while((end=pending.indexOf('\n\n'))>=0){const block=pending.slice(0,end);pending=pending.slice(end+2);let name='message',data=[];for(const line of block.split('\n')){if(line.startsWith('event:'))name=line.slice(6).trim();if(line.startsWith('data:'))data.push(line.slice(5).trimStart())}if(data.length)listeners.get(name)?.({data:data.join('\n')})}
      }
    }catch(e){if(e.name!=='AbortError')events.onerror?.(e)}
    if(!controller.signal.aborted)events.timer=setTimeout(connect,2000)
  }
  connect();return events
}

export function uploadBook(body,{signal,onProgress}={}) {
  return new Promise((resolve,reject)=>{
    const xhr=new XMLHttpRequest(),abort=()=>xhr.abort()
    xhr.open('POST',apiURL('/api/projects'))
    if(accessToken)xhr.setRequestHeader('Authorization',`Bearer ${accessToken}`)
    xhr.upload.onprogress=e=>{if(e.lengthComputable)onProgress?.(Math.round(e.loaded/e.total*100))}
    xhr.onload=()=>{let value;try{value=JSON.parse(xhr.responseText)}catch{reject(Error('backendNotConfigured'));return}
      if(xhr.status>=200&&xhr.status<300)resolve(value)
      else{if(xhr.status===401)window.dispatchEvent(new Event('pagevoice-auth'));reject(Error(xhr.status===507?'storageQuota':xhr.status===429?'rateLimit':typeof value.detail==='string'?value.detail:'uploadError'))}}
    xhr.onerror=()=>reject(Error('apiOffline'));xhr.onabort=()=>reject(new DOMException('Upload cancelled','AbortError'))
    xhr.onloadend=()=>signal?.removeEventListener('abort',abort)
    signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted){reject(new DOMException('Upload cancelled','AbortError'));return}
    xhr.send(body)
  })
}
