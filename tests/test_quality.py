import wave
import pytest
from pagevoice.book import sentences
from pagevoice.text import speech_windows
from pagevoice.narration import synthesize
from pagevoice.audio import RATE,frames
from rag import analyze,search


@pytest.mark.parametrize('language,text,expected',[
 ('es','El Sr. García llegó a las 3.14. Después salió.',['El Sr. García llegó a las 3.14.','Después salió.']),
 ('es','«Primera frase. Segunda frase». Ella sonrió.',['«Primera frase.','Segunda frase».','Ella sonrió.']),
 ('en','“First sentence. Second sentence.” She smiled.',['“First sentence.','Second sentence.”','She smiled.']),
 ('en','Dr. Reed paid $3.50. He left.',['Dr. Reed paid $3.50.','He left.']),
 ('es','La Dra. Ruiz llegó.otra frase empieza.',['La Dra. Ruiz llegó.','otra frase empieza.']),
 ('en','Visit https://example.com/help. Then email a@b.com.',['Visit https://example.com/help.','Then email a@b.com.']),
 ('es','Vio árboles, flores, etc. Después salió.',['Vio árboles, flores, etc.','Después salió.']),
])
def test_sentence_boundaries(language,text,expected):
    assert sentences(text,language)==expected


def test_edge_sized_sentence_is_not_chopped_at_220(tmp_path):
    text=' '.join(['This sentence continues with natural phrasing']*12)+'.'
    calls=[]
    class Engine:
        max_text_bytes=3500
        def synthesize(self,text,path,*args):
            calls.append(text)
            with wave.open(str(path),'wb') as w:
                w.setparams((1,2,RATE,0,'NONE',''));w.writeframes(b'\x10\x10'*RATE)
    synthesize(Engine(),text,tmp_path/'sentence.wav','voice','en')
    assert len(text)>220 and calls==[text]


def test_large_utf8_request_uses_clauses_without_losing_words():
    text=('Una explicación extensa sobre los árboles del jardín, '*100).strip()+'.'
    windows=list(speech_windows(text,3500))
    assert all(len(w.encode())<=3500 for w in windows)
    assert ' '.join(windows)==text
    assert windows[0].endswith(',')
    with pytest.raises(ValueError,match='single word'):list(speech_windows('x'*4000,3500))


def test_artificial_join_trims_only_edge_padding_and_preserves_authored_pause(tmp_path):
    class Padded:
        max_text_bytes=25
        def synthesize(self,text,path,*args):
            with wave.open(str(path),'wb') as w:
                w.setparams((1,2,RATE,0,'NONE',''))
                # A deliberate internal silence must survive, as must soft guards.
                w.writeframes(b'\0\0'*(RATE//2)+b'\x10\x10'*(RATE//4)+b'\0\0'*(RATE//4)+b'\x10\x10'*(RATE//4)+b'\0\0'*(RATE//2))
    text='A long clause continues and another clause follows.'
    parts=list(speech_windows(text,25))
    target=tmp_path/'joined.wav';synthesize(Padded(),text,target,'voice','en')
    # 1.75 seconds per request minus .96 seconds of padding at each internal join.
    assert frames(target)/RATE==pytest.approx(1.75*len(parts)-.96*(len(parts)-1),abs=.005)
    target=tmp_path/'pause.wav';synthesize(Padded(),'Hello.[pause:1.5]Again.',target,'voice','en')
    assert frames(target)/RATE==pytest.approx(5.0)


def test_contextual_search_rejects_stopword_matches_and_labels_partial(tmp_path):
    book={'chapters':[{'title':'Harbour','source':'book.xhtml#harbour','evidence':'table-of-contents','sentences':['Mira carried a lantern.','The lighthouse stood by the harbour.','A ship sailed away.','The author was born inland.']}]}
    assert search(tmp_path,book,'where is the')==[]
    result=search(tmp_path,book,'Where is the lighthouse?')[0]
    assert result['text']=='The lighthouse stood by the harbour.'
    assert result['context'].startswith('Mira carried')
    assert result['citation']=='0000-00001' and result['match']=='all_terms'
    result=search(tmp_path,book,'lighthouse spaceship')[0]
    assert result['match']=='partial' and result['coverage']==.5
    assert search(tmp_path,book,'unicorn')==[]


def test_semantic_roles_and_manual_corrections_outweigh_titles():
    book={'chapters':[
        {'title':'Chapter I','sentences':['A biography.'],'evidence':'table-of-contents','role':'front_matter'},
        {'title':'A new beginning','sentences':['A story.'],'evidence':'table-of-contents','role':'chapter'},
        {'title':'Chapter II','sentences':['Some notes.'],'evidence':'manual','role':'back_matter'}]}
    report=analyze(book)
    assert report['start_chapter']==1
    assert [s['kind'] for s in report['sections']]==['front_matter','chapter','back_matter']
    assert report['sections'][2]['confidence']=='confirmed'


def test_list_markers_initials_and_quote_closures():
    assert sentences('1. The first choice. 2. The second choice.','en')==['1. The first choice.','2. The second choice.']
    assert sentences('The U.S. economy grew. Dr. Reed agreed.','en')==['The U.S. economy grew.','Dr. Reed agreed.']
    assert sentences("'Hello.' She smiled.",'en')==["'Hello.'",'She smiled.']


def test_review_api_keeps_sentence_audio_and_updates_metadata(tmp_path,monkeypatch):
    from fastapi.testclient import TestClient
    from pagevoice.api import create_app
    from sample import make_sample
    from test_api import wait
    from test_recovery import CountingEngine
    monkeypatch.setattr('pagevoice.pipeline.create',lambda *args:CountingEngine())
    source=make_sample(tmp_path/'book.epub')
    with TestClient(create_app(tmp_path)) as client:
        identifier=client.post('/api/projects',files={'file':('book.epub',source.read_bytes())}).json()['id']
        wait(client,identifier);base=f'/api/projects/{identifier}'
        assert client.post(base+'/render',json={'allow_network':True}).status_code==202
        before=wait(client,identifier)
        result=client.patch(base+'/analysis',json={'chapter':0,'title':'Foreword','kind':'front_matter','start_here':False})
        assert result.status_code==200,result.text
        after=result.json()
        assert after['chapters'][0]['title']=='Foreword' and after['output'] is None
        assert [r['audio'] for c in after['chapters'] for r in c['sentences']]==[r['audio'] for c in before['chapters'] for r in c['sentences']]
        report=client.get(base+'/analysis').json()
        assert report['start_chapter']==1 and report['sections'][0]['confidence']=='confirmed'
        assert client.get(base+'/analysis?q=boat&chapter=1').json()['results']==[]
        assert client.get(base+'/analysis?q=boat&chapter=20').status_code==422


def test_edge_padding_cap_preserves_interior_pause(tmp_path):
    from pagevoice.audio import trim_transport_padding
    target=tmp_path/'padding.wav'
    with wave.open(str(target),'wb') as w:
        w.setparams((1,2,RATE,0,'NONE',''))
        w.writeframes(b'\0\0'*(RATE//2)+b'\x10\x10'*(RATE//2)+b'\0\0'*(RATE//2)+b'\x10\x10'*(RATE//2)+b'\0\0'*(RATE//2))
    trim_transport_padding(target)
    assert frames(target)/RATE==pytest.approx(1.76)
    with wave.open(str(target)) as w:pcm=w.readframes(w.getnframes())
    assert b'\0\0'*(RATE//2) in pcm
