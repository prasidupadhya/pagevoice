import { vi, afterEach } from 'vitest'
import { cleanup } from '@testing-library/react'
afterEach(()=>{cleanup();localStorage.clear();vi.restoreAllMocks()})
Object.defineProperty(window,'matchMedia',{value:vi.fn(()=>({matches:false,addEventListener(){},removeEventListener(){}})),writable:true})
HTMLDialogElement.prototype.showModal=function(){this.setAttribute('open','')}
HTMLDialogElement.prototype.close=function(){this.removeAttribute('open')}
HTMLMediaElement.prototype.load=vi.fn()
class Events {addEventListener(){} close(){}}
vi.stubGlobal('EventSource',Events)
