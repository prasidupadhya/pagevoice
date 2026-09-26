from zipfile import ZipFile
import wave
from sample import make_sample
from pagevoice.book import read_epub, sentences
from pagevoice.narration import synthesize
from pagevoice.audio import normalize, frames, RATE
from rag import analyze, search


def test_natural_sentences_and_internal_chunks(tmp_path):
    text = ' '.join(['extraordinary'] * 50) + '. Next sentence.'
    assert sentences(text, 'en') == [text.split('. ')[0]+'.', 'Next sentence.']
    assert sentences('Hola.Termina aquí. ¿Vienes? Sí.', 'es') == ['Hola.', 'Termina aquí.', '¿Vienes?', 'Sí.']
    calls=[]
    class Engine:
        max_text_bytes = 220
        def synthesize(self,text,path,*args):
            calls.append(text)
            with wave.open(str(path),'wb') as w:
                w.setparams((1,2,RATE,0,'NONE',''));w.writeframes(b'\x01\x01'*2400)
    synthesize(Engine(),text,tmp_path/'long.wav','Samantha','en')
    assert all(len(c)<=220 for c in calls)
    assert ' '.join(calls)==text
    assert frames(tmp_path/'long.wav')==2400*len(calls)


def test_epub_fragments_frontmatter_and_retrieval(tmp_path):
    path=make_sample(tmp_path/'book.epub')
    with ZipFile(path) as z: entries={n:z.read(n) for n in z.namelist()}
    entries['Book/one.xhtml']=b'<html><body><h1 id="bio">Author biography</h1><p>A life near the sea.</p><h1 id="one">Chapter I</h1><p>She was extra<em>ordinary</em>. The lighthouse shone.</p><h1 id="two">Chapter II</h1><p>The ship departed.</p></body></html>'
    entries['Book/nav.xhtml']=b'<html><body><nav><a href="one.xhtml#bio">Author biography</a><a href="one.xhtml#one">Chapter I</a><a href="one.xhtml#two">Chapter II</a></nav></body></html>'
    with ZipFile(path,'w') as z:
        for n,v in entries.items():z.writestr(n,v)
    book=read_epub(path).to_dict();report=analyze(book)
    assert report['start_chapter']==1
    assert report['sections'][0]['kind']=='front_matter'
    assert book['chapters'][1]['sentences'][0]=='She was extraordinary.'
    hits=search(tmp_path/'rag',book,'lighthouse')
    assert hits[0]['chapter']==1 and hits[0]['source']=='Book/one.xhtml#one'
    book['chapters'][1]['sentences'][1]='A lantern shone.'
    assert search(tmp_path/'rag',book,'lighthouse')==[]
    assert search(tmp_path/'rag',book,'lantern')[0]['sentence']==1


def test_pace_changes_duration(tmp_path):
    import math,struct
    source=tmp_path/'tone.wav'
    with wave.open(str(source),'wb') as w:
        w.setparams((1,2,RATE,0,'NONE',''))
        w.writeframes(b''.join(struct.pack('<h',int(8000*math.sin(i*2*math.pi*220/RATE))) for i in range(RATE*2)))
    normalize(source,tmp_path/'fast.wav',1.5)
    assert 1.2<frames(tmp_path/'fast.wav')/RATE<1.4


def test_analysis_api_and_nondestructive_reanalysis(tmp_path,monkeypatch):
    from fastapi.testclient import TestClient
    from pagevoice.api import create_app
    from test_api import wait
    from test_recovery import CountingEngine
    monkeypatch.setattr('pagevoice.pipeline.create',lambda *args:CountingEngine())
    source=make_sample(tmp_path/'book.epub')
    with TestClient(create_app(tmp_path)) as client:
        original=client.post('/api/projects',files={'file':('book.epub',source.read_bytes())}).json()['id']
        wait(client,original)
        assert client.get(f'/api/projects/{original}/analysis?q=harbour').json()['results'][0]['chapter']==0
        result=client.post(f'/api/projects/{original}/reanalyze')
        assert result.status_code==202,result.text
        revised=result.json()['id'];assert revised!=original
        assert wait(client,revised)['analysis']['version']==2
        assert client.get(f'/api/projects/{original}').status_code==200
        assert client.patch(f'/api/projects/{revised}/settings',json={'engine':'say','pace':1.5}).status_code==200
        assert client.post(f'/api/projects/{revised}/render',json={}).status_code==202
        assert wait(client,revised)['output']
        assert client.patch(f'/api/projects/{revised}/settings',json={'engine':'say','pace':9}).status_code==422


def test_navigation_anchor_on_prose_preserves_first_words(tmp_path):
    path=make_sample(tmp_path/'anchored.epub')
    with ZipFile(path) as z: entries={n:z.read(n) for n in z.namelist()}
    entries['Book/one.xhtml']=b'<html><body><section id="first"><p>The first words must survive.</p><p>More words follow.</p></section><p id="second">A second journey begins.</p></body></html>'
    entries['Book/nav.xhtml']=b'<html><body><nav><a href="one.xhtml#first">Chapter I</a><a href="one.xhtml#second">Chapter II</a></nav></body></html>'
    with ZipFile(path,'w') as z:
        for n,v in entries.items():z.writestr(n,v)
    book=read_epub(path)
    assert book.chapters[0].title=='Chapter I'
    assert book.chapters[0].sentences==['The first words must survive.','More words follow.']
    assert book.chapters[1].sentences==['A second journey begins.']


def test_installed_knowledge_package_outside_repository(tmp_path):
    import subprocess,sys
    result=subprocess.run([sys.executable,'-I','-c','from rag import analyze, search; print("knowledge package importable")'],cwd=tmp_path,capture_output=True,text=True)
    assert result.returncode==0,result.stderr


def test_mixed_epub_blocks_do_not_drop_or_repeat_words(tmp_path):
    path=make_sample(tmp_path/'mixed.epub')
    with ZipFile(path) as z: entries={n:z.read(n) for n in z.namelist()}
    entries['Book/one.xhtml']=b'<html><body><h1>Arrival</h1>Direct text.<div>Outside paragraph.</div><ul><li>Parent item.<ul><li>Nested item.</li></ul>Trailing item.</li></ul><p>Extra<em>ordinary</em><br/>voyage.</p><table><tr><td>Table text.</td></tr></table></body></html>'
    with ZipFile(path,'w') as z:
        for n,v in entries.items():z.writestr(n,v)
    book=read_epub(path)
    assert book.chapters[0].sentences==['Direct text.','Outside paragraph.','Parent item.','Nested item.','Trailing item.','Extraordinary voyage.','Table text.']
