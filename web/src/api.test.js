import {afterEach,describe,it,expect,vi} from 'vitest'
import {api,request,apiURL,setAccessToken,progressEvents} from './api'
afterEach(()=>{setAccessToken('');vi.unstubAllEnvs()})
describe('direct backend transport',()=>{
 it('keeps tokens in request headers, never URLs',async()=>{
  setAccessToken('private-secret');vi.stubGlobal('fetch',vi.fn(async()=>({ok:true,json:async()=>({ok:true})})))
  await api('/api/projects');expect(fetch.mock.calls[0][0]).toBe('/api/projects');expect(fetch.mock.calls[0][1].headers.Authorization).toBe('Bearer private-secret')
  expect(apiURL('blob:example')).toBe('blob:example')
 })
 it('requests authentication on 401 and preserves aborts',async()=>{
  const listener=vi.fn();window.addEventListener('pagevoice-auth',listener)
  vi.stubGlobal('fetch',vi.fn(async()=>({ok:false,status:401,json:async()=>({detail:'Access token required.'})})))
  await expect(api('/api/projects')).rejects.toThrow('Access token required.');expect(listener).toHaveBeenCalledOnce();window.removeEventListener('pagevoice-auth',listener)
  vi.stubGlobal('fetch',vi.fn(async()=>{throw new DOMException('Cancelled','AbortError')}));await expect(api('/api/projects')).rejects.toHaveProperty('name','AbortError')
 })
 it('parses authenticated SSE across network chunks and closes without retry',async()=>{
  setAccessToken('secret');const encoder=new TextEncoder(),handler=vi.fn()
  vi.stubGlobal('fetch',vi.fn(async()=>({ok:true,body:new ReadableStream({start(c){c.enqueue(encoder.encode('event: pro'));c.enqueue(encoder.encode('gress\ndata: {"id":1}\n\n'));c.close()}})})))
  const events=progressEvents('/api/projects/id/events');events.addEventListener('progress',e=>{handler(JSON.parse(e.data));events.close()})
  await vi.waitFor(()=>expect(handler).toHaveBeenCalledWith({id:1}));expect(fetch).toHaveBeenCalledOnce()
 })
})

it('uses the configured backend for files and rejects secret forwarding to other origins',async()=>{
 vi.resetModules();vi.stubEnv('VITE_API_BASE_URL','https://books.example')
 const remote=await import('./api');remote.setAccessToken('private')
 vi.stubGlobal('fetch',vi.fn(async()=>({ok:true})))
 await remote.request('/api/projects/id/download?signature=abc')
 expect(fetch.mock.calls[0][0]).toBe('https://books.example/api/projects/id/download?signature=abc')
 expect(()=>remote.request('https://untrusted.example/')).toThrow('Unexpected backend origin')
 remote.setAccessToken('')
})

it('reports real upload progress and supports cancellation',async()=>{
 const {uploadBook}=await import('./api');let xhr
 vi.stubGlobal('XMLHttpRequest',class{constructor(){xhr=this;this.upload={}}open(){}setRequestHeader(){}send(){}abort(){this.onabort();this.onloadend?.()}})
 const controller=new AbortController(),progress=vi.fn()
 const result=uploadBook(new FormData(),{signal:controller.signal,onProgress:progress})
 xhr.upload.onprogress({lengthComputable:true,loaded:25,total:100});expect(progress).toHaveBeenCalledWith(25)
 const assertion=expect(result).rejects.toMatchObject({name:'AbortError'});controller.abort();await assertion
})
