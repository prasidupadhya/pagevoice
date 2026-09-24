import React from 'react'
import {it,expect,vi} from 'vitest'
import {render,screen} from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {ListeningPlayer} from './ListeningPlayer'
import {messages} from './i18n'

it('keeps pause and stop controls usable while preparation is running',async()=>{
 const pause=vi.fn(),stop=vi.fn()
 render(<ListeningPlayer state={{status:'buffering',cursor:0,ready:12,target:20,total:90}} t={messages.en} rate={1} onPause={pause} onStop={stop} disabled/>)
 expect(screen.getByText('12 / 20 sentences ready ahead')).toBeTruthy()
 await userEvent.click(screen.getByRole('button',{name:'Pause listening'}));expect(pause).toHaveBeenCalled()
 await userEvent.click(screen.getByRole('button',{name:'Stop listening'}));expect(stop).toHaveBeenCalled()
})
it('offers Spanish recovery when a browser blocks audio',()=>{
 render(<ListeningPlayer state={{status:'blocked',cursor:0,ready:20,target:20,total:90}} t={messages.es} rate={1}/>)
 expect(screen.getByRole('button',{name:'Toca para activar el audio'}).disabled).toBe(false)
})
