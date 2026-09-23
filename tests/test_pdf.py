import json
import shutil
from pathlib import Path

import pytest
from pypdf import PdfReader, PdfWriter

from pagevoice.pdf import read_pdf
from pdf_sample import make_pdf


def test_native_pdf_without_ocr(tmp_path, monkeypatch):
    path = make_pdf(tmp_path / 'native.pdf')
    monkeypatch.setattr('pagevoice.pdf.ocr_page', lambda *args: pytest.fail('Native text should not use OCR'))
    book = read_pdf(path)
    assert book.title == 'The Paper Lantern'
    assert book.author == 'PageVoice'
    assert [c.title for c in book.chapters] == ['Chapter One', 'Chapter Two']
    assert all(p['method'] == 'native' for p in book.source_pages)
    assert 'paper lantern' in ' '.join(book.chapters[0].sentences)


@pytest.mark.skipif(not shutil.which('tesseract'), reason='Requires Tesseract with eng data')
def test_real_ocr_and_page_cache(tmp_path, monkeypatch):
    path = make_pdf(tmp_path / 'mixed.pdf', scanned=True)
    assert not PdfReader(path).pages[1].extract_text()
    book = read_pdf(path, cache=tmp_path / 'pages')
    assert [p['method'] for p in book.source_pages] == ['native', 'ocr']
    assert 'Mira carried the lantern' in ' '.join(book.chapters[1].sentences)
    assert len(book.chapters) == 2
    monkeypatch.setattr('pagevoice.pdf.ocr_page', lambda *args: pytest.fail('Cached OCR should be reused'))
    assert read_pdf(path, cache=tmp_path / 'pages').to_dict() == book.to_dict()
    # Invalid cache JSON shape is discarded; native extraction repairs page 1.
    (tmp_path / 'pages' / '00000.json').write_text('[]')
    assert read_pdf(path, cache=tmp_path / 'pages').to_dict() == book.to_dict()


def test_ocr_disabled_and_missing_language(tmp_path):
    path = make_pdf(tmp_path / 'scan.pdf', scanned=True)
    with pytest.raises(ValueError, match='enable OCR'):
        read_pdf(path, ocr='never')
    if shutil.which('tesseract'):
        with pytest.raises(ValueError, match='Only English and Spanish OCR'):
            read_pdf(path, ocr_language='not_installed')


def test_heading_fallback(tmp_path):
    book = read_pdf(make_pdf(tmp_path / 'native.pdf', bookmarks=False), ocr='never')
    assert [c.title for c in book.chapters] == ['Chapter One', 'Chapter Two']


def test_encrypted_pdf(tmp_path):
    path = make_pdf(tmp_path / 'native.pdf')
    writer = PdfWriter(clone_from=path)
    writer.encrypt('private')
    protected = tmp_path / 'protected.pdf'
    writer.write(protected)
    with pytest.raises(ValueError, match='Encrypted'):
        read_pdf(protected)


def test_parse_recovery_reuses_finished_pages(tmp_path, monkeypatch):
    from pagevoice import pipeline
    from pagevoice import pdf
    path = make_pdf(tmp_path / 'native.pdf')
    original = pdf.ocr_page
    calls = []
    def failing(path, index, language):
        calls.append(index)
        if index == 1:
            raise RuntimeError('OCR interrupted')
        return 'Chapter One\nA lantern glowed in the harbour.'
    monkeypatch.setattr(pdf, 'ocr_page', failing)
    with pytest.raises(RuntimeError, match='OCR interrupted'):
        pipeline.convert(path, tmp_path, engine='say', ocr='always')
    session = next((tmp_path / 'sessions').iterdir())
    assert (session / 'pages' / '00000.json').is_file()
    calls.clear()
    def finishing(path, index, language):
        calls.append(index)
        return 'Chapter Two\nMira opened the book.'
    monkeypatch.setattr(pdf, 'ocr_page', finishing)
    # Exercise parse recovery without depending on a platform speech engine.
    from test_recovery import CountingEngine
    monkeypatch.setattr(pipeline, 'create', lambda *args: CountingEngine())
    pipeline.resume(session)
    assert calls == [1]
    assert json.loads((session / 'session.json').read_text())['status'] == 'complete'
