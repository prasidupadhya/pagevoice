import React from 'react'
import {describe,it,expect,vi} from 'vitest'
import {render,screen,fireEvent} from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {Casting} from './Casting'
import {messages} from './i18n'

describe('editable casting',()=>{
  const project={voice:'Samantha',cast:{},speakers:['Narrator','Mira']}
  const voices=[{id:'Samantha',name:'Samantha'},{id:'Daniel',name:'Daniel'}]
  it('assigns a character with keyboard-compatible selects',async()=>{
    const onChange=vi.fn();render(<Casting project={project} voices={voices} t={messages.en} onChange={onChange}/>)
    await userEvent.selectOptions(screen.getByLabelText('Voice: Mira'),'Daniel')
    expect(onChange).toHaveBeenCalledWith('casting',{cast:{Mira:'Daniel'}},'PATCH')
    await userEvent.click(screen.getByRole('button',{name:'Find dialogue'}))
    expect(onChange).toHaveBeenCalledWith('speakers/detect',{},'POST')
  })
  it('supports voice drops and disables changes while rendering',()=>{
    const onChange=vi.fn();const {rerender}=render(<Casting project={project} voices={voices} t={messages.es} onChange={onChange}/>)
    fireEvent.drop(screen.getByLabelText('Voz: Mira').parentElement,{dataTransfer:{getData:()=> 'Daniel'}})
    expect(onChange).toHaveBeenCalledWith('casting',{cast:{Mira:'Daniel'}},'PATCH')
    rerender(<Casting project={project} voices={voices} t={messages.es} onChange={onChange} busy/>)
    expect(screen.getByLabelText('Voz: Mira').disabled).toBe(true)
  })
})
