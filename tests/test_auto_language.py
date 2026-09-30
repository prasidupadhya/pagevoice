import json
from pathlib import Path
from zipfile import ZipFile

import pytest

from pagevoice.languages import detect_language


@pytest.mark.parametrize('case', json.loads(Path('tests/language_cases.json').read_text()))
def test_body_language_and_evidence(case):
    result = detect_language([case['text']], case['metadata'])
    assert result['language'] == case['language']
    assert result['source'] and result['scores']
    if case.get('review'):
        assert result['review']


def test_explicit_override_and_unsupported_metadata():
    assert detect_language(['The book was on the table.'], 'en', 'es')['source'] == 'manual'
    with pytest.raises(ValueError, match='Only English'):
        detect_language(['Bonjour.'], 'fr')


def test_spanish_epub_with_wrong_metadata(tmp_path):
    from test_languages import spanish_epub
    from pagevoice.book import read_epub
    path = spanish_epub(tmp_path / 'novela.epub')
    with ZipFile(path) as archive:
        content = {name: archive.read(name) for name in archive.namelist()}
    content['Book/book.opf'] = content['Book/book.opf'].replace(b'<dc:language>es', b'<dc:language>en')
    with ZipFile(path, 'w') as archive:
        for name, data in content.items():
            archive.writestr(name, data)
    book = read_epub(path)
    assert book.language == 'es'
    assert book.language_detection['metadata_mismatch']
    assert read_epub(path, language='en').language == 'en'


def test_spanish_pdf_without_language_metadata(tmp_path):
    from pdf_sample import make_pdf
    from pagevoice.pdf import read_pdf
    book = read_pdf(make_pdf(tmp_path / 'novela.pdf', language='es'), ocr='never')
    assert book.language == 'es'
    assert book.language_detection['source'] == 'text'


def test_upload_auto_detects_without_starting_speech_and_reanalysis_keeps_override(tmp_path, monkeypatch):
    from fastapi.testclient import TestClient
    from pagevoice.api import create_app
    from test_api import wait
    from test_languages import spanish_epub
    source = spanish_epub(tmp_path / 'novela.epub')
    monkeypatch.setattr('pagevoice.pipeline.create', lambda *args: pytest.fail('Upload must not synthesize speech'))
    with TestClient(create_app(tmp_path)) as client:
        response = client.post('/api/projects', files={'file': ('novela.epub', source.read_bytes())})
        assert response.status_code == 202
        book = wait(client, response.json()['id'])
        assert book['language'] == 'es'
        assert book['voice'] == 'es-ES-ElviraNeural'
        assert book['language_detection']['source'] == 'text'
        assert book['progress']['complete'] == 0
        # Direct API clients may explicitly override a bilingual book's language.
        response = client.post('/api/projects', files={'file': ('novela.epub', source.read_bytes())}, data={'language': 'en'})
        overridden = wait(client, response.json()['id'])
        assert overridden['language_detection']['source'] == 'manual'
        response = client.post(f"/api/projects/{overridden['id']}/reanalyze")
        sibling = wait(client, response.json()['id'])
        assert sibling['language'] == 'en'
