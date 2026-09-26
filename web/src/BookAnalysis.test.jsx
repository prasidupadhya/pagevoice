import React from 'react'
import {it,expect,vi} from 'vitest'
import {render,screen,waitFor} from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {BookAnalysis} from './BookAnalysis'
import {messages} from './i18n'
const project={id:'a'.repeat(32),narration_version:2,chapters:[{index:0,title:'Harbour'}]}
const section={index:0,title:'Harbour',kind:'chapter',confidence:'document',source:'book.xhtml#harbour',excerpt:'A lamp shone.',reasons:['structural_boundary']}
const report={sections:[section],results:[],review_count:0}
it('opens the cited sentence and labels partial retrieval matches',async()=>{
 vi.stubGlobal('fetch',vi.fn(async()=>({ok:true,json:async()=>({...report,results:[{chapter:0,sentence:1,citation:'0000-00001',title:'Harbour',context:'A lamp shone. The lighthouse stood nearby.',source:'book.xhtml#harbour',match:'partial'}]})})))
 const open=vi.fn();render(<BookAnalysis project={project} t={messages.en} onChapter={open}/>)
 await userEvent.click(await screen.findByRole('button',{name:/Harbour · 2 · Partial match/}))
 expect(open).toHaveBeenCalledWith(0,1)
})
it('saves explicit structure corrections and start position',async()=>{
 vi.stubGlobal('fetch',vi.fn(async(url,options)=>({ok:true,json:async()=>options?.method==='PATCH'?project:report})))
 const reviewed=vi.fn(),open=vi.fn();render(<BookAnalysis project={project} t={messages.en} onReviewed={reviewed} onChapter={open}/>)
 await userEvent.click(await screen.findByRole('button',{name:'Review section'}))
 await userEvent.clear(screen.getByLabelText('Section title'));await userEvent.type(screen.getByLabelText('Section title'),'Foreword')
 await userEvent.selectOptions(screen.getByLabelText('Section type'),'front_matter')
 await userEvent.click(screen.getByLabelText('Start listening from this section'))
 await userEvent.click(screen.getByRole('button',{name:'Save review'}))
 await waitFor(()=>expect(reviewed).toHaveBeenCalledWith(project))
 const payload=JSON.parse(fetch.mock.calls.find(([,o])=>o?.method==='PATCH')[1].body)
 expect(payload).toEqual({chapter:0,title:'Foreword',kind:'front_matter',start_here:true});expect(open).toHaveBeenCalledWith(0)
})
it('warns that older audio needs non-destructive reanalysis',async()=>{
 vi.stubGlobal('fetch',vi.fn(async()=>({ok:true,json:async()=>report})))
 const reanalyze=vi.fn();render(<BookAnalysis project={{...project,narration_version:1}} t={messages.es} onReanalyze={reanalyze}/>)
 expect(screen.getByText(messages.es.oldAnalysis)).toBeTruthy()
 await userEvent.click(screen.getByRole('button',{name:messages.es.reanalyze}));expect(reanalyze).toHaveBeenCalled()
})
