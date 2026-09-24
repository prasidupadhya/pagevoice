import {api} from './api'
export function registerProjectTools(context=document.modelContext) {
  if (!context?.registerTool) return ()=>{}
  const lifecycle=new AbortController()
  try {
    Promise.resolve(context.registerTool({
      name:'read_pagevoice_projects',title:'Read audiobook projects',
      description:'Read saved local audiobook projects and their progress. Does not upload, render, or send book text online.',
      inputSchema:{type:'object',properties:{},additionalProperties:false},
      annotations:{readOnlyHint:true,untrustedContentHint:true},
      async execute(input){
        if(!input||Array.isArray(input)||typeof input!=='object'||Object.keys(input).length)throw new Error('Expected an empty object.')
        const projects=await api('/api/projects')
        return projects.map(p=>({id:p.id,title:p.title,language:p.language,status:p.status,progress:p.progress,download:p.output}))
      },
    },{signal:lifecycle.signal})).catch(()=>{})
  } catch { /* Unsupported experimental API must not break the reader. */ }
  return ()=>lifecycle.abort()
}
