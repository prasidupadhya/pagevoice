from pathlib import Path
from zipfile import ZipFile
import json
import platform
import subprocess
import pytest
from pagevoice.book import read_epub, sentences
from pagevoice.languages import language_code, default_voice
from sample import make_sample


def spanish_epub(path):
    make_sample(path)
    with ZipFile(path) as z:
        files={n:z.read(n) for n in z.namelist()}
    files['Book/book.opf']=files['Book/book.opf'].replace(b'<dc:language>en',b'<dc:language>es')
    for name in ('one','two'):
        files[f'Book/{name}.xhtml']=f'<html><body><h1>Capítulo {name}</h1><p>La luz iluminaba el puerto. María abrió su libro y comenzó a leer.</p></body></html>'.encode()
    with ZipFile(path,'w') as z:
        for name,content in files.items():z.writestr(name,content)
    return path


def test_only_english_and_spanish(tmp_path):
    assert language_code('es-ES')=='es'
    assert language_code('en_US')=='en'
    assert read_epub(spanish_epub(tmp_path/'spanish.epub')).language=='es'
    for language in ('fr','zh','ar','de'):
        with pytest.raises(ValueError,match='Only English'):
            sentences('Unsupported book.',language)
    assert default_voice('say','es')=='Monica'


@pytest.mark.smoke
@pytest.mark.skipif(platform.system()!='Darwin',reason='macOS speech')
def test_spanish_real_synthesis(tmp_path):
    from pagevoice.pipeline import convert
    output=convert(spanish_epub(tmp_path/'spanish.epub'),tmp_path,engine='say')
    state=json.loads((tmp_path/'sessions'/output.stem/'session.json').read_text())
    assert state['voice']=='Monica'
    assert state['book']['language']=='es'
    probe=json.loads(subprocess.check_output(['ffprobe','-v','error','-show_streams','-of','json',str(output)]))
    assert probe['streams'][0]['tags']['language']=='spa'
    subprocess.run(['ffmpeg','-v','error','-i',str(output),'-f','null','-'],check=True,capture_output=True)


def test_spanish_scanned_pdf(tmp_path):
    from pdf_sample import make_pdf
    from pagevoice.pdf import read_pdf
    result=subprocess.run(['tesseract','--list-langs'],capture_output=True,text=True)
    if 'spa' not in result.stdout.split():pytest.skip('Install Tesseract spa data for Spanish OCR')
    book=read_pdf(make_pdf(tmp_path/'spanish-scan.pdf',scanned=True,language='es'),language='es')
    assert book.language=='es'
    assert 'María abrió el libro' in ' '.join(book.chapters[-1].sentences)
    assert any(page['method']=='ocr' for page in book.source_pages)
