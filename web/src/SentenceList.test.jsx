import React from 'react'
import {it,expect,vi} from 'vitest'
import {render,screen} from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {SentenceList} from './SentenceList'
import {messages} from './i18n'
it('starts from unprepared source text and bookmarks without requiring audio',async()=>{
 const listen=vi.fn(),bookmark=vi.fn()
 render(<SentenceList rows={[{id:'0000-00003',text:'A lantern by the sea.',ready:false}]} state={{status:'idle'}} t={messages.en} onListen={listen} onBookmark={bookmark} onEdit={()=>{}}/>)
 await userEvent.click(screen.getByRole('button',{name:'Listen from here: A lantern by the sea.'}));expect(listen).toHaveBeenCalledWith(0)
 await userEvent.click(screen.getByRole('button',{name:'Bookmark sentence 1'}));expect(bookmark).toHaveBeenCalledWith('0000-00003')
})
