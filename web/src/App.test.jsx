import React from 'react'
import {describe,it,expect,vi} from 'vitest'
import {render,screen,waitFor,fireEvent} from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import App,{CloneDialog,SentenceEditor,UploadDialog} from './App'
import {messages} from './i18n'

const project={id:'a'.repeat(32),title:'The Quiet Harbour',author:'PageVoice',language:'en',status:'ready',engine:'say',voice:'Samantha',format:'m4b',device:'auto',chapters:[{index:0,title:'Arrival',sentences:[{id:'0000-00000',text:'Mira opened her book.',ready:false}]}],progress:{complete:0,total:1},source_pages:[],job:{status:'complete'},output:null}
function server(){vi.stubGlobal('fetch',vi.fn(async(path,options)=>({ok:true,json:async()=>path==='/api/projects'?[project]:path==='/api/engines'?[{id:'say',installed:true,model_ready:true,voices:[{id:'Samantha',language:'en'}]}]:path==='/api/voices'?[]:path==='/api/hardware'?{device:'cpu'}:project}))) }
describe('reader interactions',()=>{
  it('switches interface language and theme while preserving the book language',async()=>{
    server();render(<App/>);const user=userEvent.setup();await screen.findByRole('heading',{name:'The Quiet Harbour'})
    await user.selectOptions(screen.getByLabelText('Interface language'),'es')
    expect(document.documentElement.lang).toBe('es');expect(screen.getByText('Voz y exportación')).toBeTruthy()
    await user.click(screen.getByRole('button',{name:'Tema de color: Oscuro'}));expect(document.documentElement.dataset.theme).toBe('dark')
    expect(localStorage.getItem('pagevoice-locale')).toBe('es');expect(screen.getAllByText('English').length).toBeGreaterThan(0)
  })
  it('never prechecks cloning consent and sends it only after user checks it',async()=>{
    server();const created=vi.fn();render(<CloneDialog t={messages.en} locale="en" onClose={()=>{}} onCreated={created}/>);const user=userEvent.setup()
    const button=screen.getByRole('button',{name:'Save voice profile'});expect(button.disabled).toBe(true)
    await user.type(screen.getByLabelText('Voice name'),'My voice');await user.upload(screen.getByLabelText('WAV or MP3 recording'),new File(['audio'],'voice.wav',{type:'audio/wav'}))
    await user.click(screen.getByRole('checkbox'));expect(button.disabled).toBe(false);expect(screen.getByLabelText('WAV or MP3 recording').files.length).toBe(1);
    // jsdom does not reconcile user-event's FileList with native file validity.
    fireEvent.submit(button.form)
    await waitFor(()=>expect(created).toHaveBeenCalled());expect(fetch.mock.calls.at(-1)[1].body.get('consent')).toBe('true')
  })
  it('edits and saves exactly the selected sentence',async()=>{
    const saved=vi.fn();render(<SentenceEditor row={{text:'Original sentence.'}} t={messages.en} onClose={()=>{}} onSave={saved} busy={false}/>);const user=userEvent.setup()
    await user.clear(screen.getByLabelText('Narration text'));await user.type(screen.getByLabelText('Narration text'),'Updated sentence.')
    await user.click(screen.getByRole('button',{name:'Save & regenerate'}));expect(saved).toHaveBeenCalledWith('Updated sentence.','Narrator')
  })
  it('uploads with explicit Spanish book language',async()=>{
    server();const created=vi.fn();render(<UploadDialog t={messages.en} locale="en" onCreated={created} onClose={()=>{}}/>);const user=userEvent.setup()
    await user.upload(screen.getByLabelText('PDF or EPUB'),new File(['book'],'novela.epub',{type:'application/epub+zip'}))
    await user.selectOptions(screen.getByLabelText('Book language'),'es');await user.click(screen.getByRole('button',{name:'Read this book'}))
    await waitFor(()=>expect(created).toHaveBeenCalled());expect(fetch.mock.calls.at(-1)[1].body.get('language')).toBe('es')
  })
  it('keeps both translation dictionaries complete',()=>{expect(Object.keys(messages.en).sort()).toEqual(Object.keys(messages.es).sort())})
})

it('exposes a read-only project tool with validated input',async()=>{
  const {registerProjectTools}=await import('./webmcp');server()
  const registerTool=vi.fn();const cleanup=registerProjectTools({registerTool})
  const tool=registerTool.mock.calls[0][0]
  expect(tool.annotations.readOnlyHint).toBe(true)
  expect((await tool.execute({}))[0].title).toBe('The Quiet Harbour')
  await expect(tool.execute({render:true})).rejects.toThrow('empty object')
  cleanup();expect(registerTool.mock.calls[0][1].signal.aborted).toBe(true)
})

it('Create audiobook arms playback immediately and SSE starts it at sentence 20',async()=>{
 const rows=Array.from({length:25},(_,i)=>({id:`0000-${String(i).padStart(5,'0')}`,text:`Sentence ${i+1}.`,ready:i<19,audio:`/audio/${i}`}))
 const book={...project,chapters:[{index:0,title:'Arrival',sentences:rows}],progress:{complete:19,total:25},job:{status:'complete'}}
 let progress
 vi.stubGlobal('EventSource',class{addEventListener(name,fn){if(name==='progress')progress=fn}close(){}})
 const start=vi.fn(),resume=vi.fn(async()=>{})
 vi.stubGlobal('AudioContext',class{state='running';currentTime=0;destination={};resume=resume;suspend=async()=>{};close=async()=>{};decodeAudioData=async()=>({duration:2});createBufferSource=()=>({connect(){},disconnect(){},stop(){},start})})
 vi.stubGlobal('fetch',vi.fn(async path=>({ok:true,arrayBuffer:async()=>new ArrayBuffer(8),json:async()=>path==='/api/projects'?[book]:path==='/api/engines'?[{id:'say',installed:true,voices:[{id:'Samantha',language:'en'}]}]:path==='/api/voices'?[]:path==='/api/hardware'?{device:'cpu'}:book})))
 render(<App/>);await screen.findByRole('heading',{name:book.title})
 await userEvent.click(screen.getByRole('button',{name:'Create audiobook'}))
 expect(resume).toHaveBeenCalled();expect(start).not.toHaveBeenCalled()
 await waitFor(()=>expect(progress).toBeTypeOf('function'))
 const next={...book,chapters:[{...book.chapters[0],sentences:rows.map((r,i)=>({...r,ready:i<20}))}],job:{kind:'listen',status:'running'}}
 const {act}=await import('@testing-library/react');await act(async()=>progress({data:JSON.stringify(next)}))
 await waitFor(()=>expect(start).toHaveBeenCalledTimes(4))
 expect(screen.getByText('Listening now')).toBeTruthy()
})
