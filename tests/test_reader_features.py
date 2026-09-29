from collections import deque
from pathlib import Path
from io import BytesIO
from zipfile import ZipFile
from PIL import Image
from pagevoice.listening import next_sentence,set_priority,sentence_priority,pause
from pagevoice.covers import extract
from sample import make_sample


def test_listen_prioritizes_selected_sentence_then_later_chapters(tmp_path):
    remaining={i:deque((n,str(n)) for n in range(3)) for i in range(4)}
    order=[]
    while any(remaining.values()):
        ci,(si,_)=next_sentence(remaining,2,1);order.append((ci,si))
    assert order[:5]==[(2,1),(2,2),(3,0),(3,1),(3,2)]
    assert len(set(order))==12
    assert order[-1]==(2,0)
    set_priority(tmp_path,2,1);pause(tmp_path);assert sentence_priority(tmp_path)==1


def test_epub_cover_is_local_sanitized_and_owned_by_session(tmp_path):
    source=make_sample(tmp_path/'cover.epub')
    with ZipFile(source) as z:entries={n:z.read(n) for n in z.namelist()}
    package=next(n for n in entries if n.endswith('.opf'))
    entries[package]=entries[package].replace(b'<manifest>',b'<manifest><item id="cover" href="cover.png" properties="cover-image" media-type="image/png"/>')
    out=BytesIO();Image.new('RGB',(800,1200),'green').save(out,format='PNG');entries[str(Path(package).parent/'cover.png')]=out.getvalue()
    with ZipFile(source,'w') as z:
        for n,value in entries.items():z.writestr(n,value)
    session=tmp_path/'session';session.mkdir();assert extract(source,session)
    with Image.open(session/'cover.png') as image:assert image.size==(320,480)
    assert not list(session.glob('*.tmp'))


def test_reader_api_sentence_validation_and_storage(tmp_path):
    from fastapi.testclient import TestClient
    from pagevoice.api import create_app
    from test_api import wait
    source=make_sample(tmp_path/'book.epub')
    with TestClient(create_app(tmp_path)) as client:
        ident=client.post('/api/projects',files={'file':('book.epub',source.read_bytes())}).json()['id'];wait(client,ident)
        base=f'/api/projects/{ident}'
        assert client.post(base+'/listen',json={'chapter':0,'sentence':9999}).status_code==404
        assert client.post(base+'/listen',json={'chapter':0,'sentence':1}).status_code==400
        assert client.get('/api/storage').json()['bytes']>0
        assert client.get(base+'/cover').status_code==404
