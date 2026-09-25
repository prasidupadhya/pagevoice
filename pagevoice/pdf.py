"""Local native-text extraction with page-level Tesseract fallback."""
import json
import hashlib
import re
import shutil
import tempfile
from pathlib import Path

from pypdf import PdfReader
import pypdfium2 as pdfium

from .audio import run
from .book import Book, Chapter, clean, sentences
from .storage import digest, save
from .languages import language_code

OCR_LANGUAGES = {'en': 'eng', 'es': 'spa', 'fr': 'fra', 'de': 'deu', 'it': 'ita',
                 'pt': 'por', 'zh': 'chi_sim', 'ja': 'jpn', 'ko': 'kor', 'hi': 'hin',
                 'ar': 'ara', 'ru': 'rus', 'nl': 'nld'}


def render_page(path, index, destination):
    with pdfium.PdfDocument(str(path)) as document:
        page = document[index]
        try:
            width, height = page.get_size()
            scale = 300 / 72
            if width * height * scale * scale > 40_000_000:
                raise ValueError(f'PDF page {index + 1} exceeds the 40 megapixel OCR limit.')
            bitmap = page.render(scale=scale)
            try:
                bitmap.to_pil().save(destination)
            finally:
                bitmap.close()
        finally:
            page.close()


def ocr_page(path, index, language):
    if not shutil.which('tesseract'):
        raise ValueError(f'Page {index + 1} needs OCR. Install Tesseract (macOS: brew install tesseract).')
    if not re.fullmatch(r'[A-Za-z0-9_]+(?:\+[A-Za-z0-9_]+)*', language):
        raise ValueError('Invalid OCR language; use Tesseract codes such as eng or eng+spa.')
    installed = set(run(['tesseract', '--list-langs'], timeout=30).splitlines()[1:])
    missing = set(language.split('+')) - installed
    if missing:
        raise ValueError(f'Missing Tesseract language data: {", ".join(sorted(missing))}. Install language data or use --ocr-language.')
    with tempfile.TemporaryDirectory(prefix='pagevoice-ocr-') as folder:
        image = Path(folder) / 'page.png'
        render_page(path, index, image)
        return run(['tesseract', str(image), 'stdout', '-l', language, '--psm', '3'], timeout=180)


def read_pdf(path: Path, language=None, ocr='auto', ocr_language=None, cache=None) -> Book:
    if ocr not in ('auto', 'always', 'never'):
        raise ValueError('OCR mode must be auto, always, or never.')
    reader = PdfReader(path)
    if reader.is_encrypted:
        raise ValueError('Encrypted PDFs are not supported; provide a decrypted copy.')
    lang = language_code(language or reader.trailer['/Root'].get('/Lang', 'en'))
    ocr_lang = ocr_language or OCR_LANGUAGES[lang]
    if set(ocr_lang.split('+')) - {'eng', 'spa'}:
        raise ValueError('Only English and Spanish OCR data (eng, spa, eng+spa) are supported.')
    key = {'source': digest(path), 'language': lang, 'ocr': ocr, 'ocr_language': ocr_lang, 'parser': 2}
    if cache:
        cache.mkdir(parents=True, exist_ok=True)
    pages = []
    for index, page in enumerate(reader.pages):
        cached = cache / f'{index:05d}.json' if cache else None
        entry = None
        if cached and cached.exists():
            try:
                record = json.loads(cached.read_text())
                if (isinstance(record, dict) and record.get('key') == key and isinstance(record.get('text'), str)
                        and record.get('page') == index + 1 and record.get('method') in ('native', 'ocr')
                        and record.get('text_sha256') == hashlib.sha256(record['text'].encode()).hexdigest()):
                    entry = record
            except (ValueError, OSError):
                pass
        if entry is None:
            text = '' if ocr == 'always' else (page.extract_text() or '')
            method = 'native'
            if ocr == 'always' or (ocr == 'auto' and sum(c.isalnum() for c in text) < 24):
                text = ocr_page(path, index, ocr_lang)
                method = 'ocr'
            if not clean(text) and ocr == 'never':
                raise ValueError(f'PDF page {index + 1} has no text; enable OCR to avoid omitting scanned content.')
            entry = {'key': key, 'page': index + 1, 'method': method, 'text': text,
                     'text_sha256': hashlib.sha256(text.encode()).hexdigest()}
            if cached:
                save(cached, entry)
        pages.append(entry)

    # Flatten nested bookmarks in document order; page anchors remain reviewable.
    starts = {}
    def outlines(items):
        for item in items:
            if isinstance(item, list): yield from outlines(item)
            else: yield item
    for item in outlines(reader.outline):
        number = reader.get_destination_page_number(item)
        if number is not None and 0 <= number < len(pages):
            starts.setdefault(number, clean(item.title))
    use_outline = bool(starts)
    chapters = []
    current_title, parts, start_page = None, [], 1
    def flush():
        if parts:
            text = clean(' '.join(parts))
            chapters.append(Chapter(current_title, sentences(text, lang), f'page:{start_page}', 'outline' if use_outline else 'heading' if not current_title.startswith('Page ') else 'page-fallback'))
    for index, entry in enumerate(pages):
        text = re.sub(r'(?<=[a-záéíóúñ])-\s*\n\s*(?=[a-záéíóúñ])', '', entry['text'])
        lines = [clean(line) for line in text.splitlines() if clean(line)]
        if use_outline:
            if index in starts or current_title is None:
                flush(); parts = []
                current_title = starts.get(index, f'Page {index + 1}')
                start_page = index + 1
            parts.extend(lines)
            continue
        def is_heading(line):
            if len(line) > 100: return False
            return bool(re.fullmatch(r'[IVXLCDM]+[.]?', line) or
                        re.match(r'^(?:chapter|capítulo|capitulo|part|parte)\s+(?:\d+|[IVXLCDM]+|one|two|three|four|five|six|seven|eight|nine|ten|uno|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez)\b', line, re.I) or
                        re.fullmatch(r'(?:prologue|epilogue|prólogo|prologo|epílogo|epilogo|preface|introduction|introducción|biografía|author biography)', line, re.I))
        # A heading can appear midway down a page, after a biography or preface.
        if current_title is None or current_title.startswith('Page '):
            flush(); parts = []; current_title = f'Page {index + 1}'; start_page = index + 1
        for line in lines:
            if is_heading(line):
                flush(); parts = []; current_title = line; start_page = index + 1
            else:
                parts.append(line)
    flush()
    if not chapters:
        raise ValueError('PDF contains no readable text, including after OCR.')
    meta = reader.metadata
    return Book(clean(meta.title or path.stem) if meta else path.stem,
                clean(meta.author or 'Unknown author') if meta else 'Unknown author', lang, chapters,
                [{'page': p['page'], 'method': p['method'], 'characters': len(clean(p['text'])),
                  'warning': 'No text recognized; inspect this page.' if not clean(p['text']) else None} for p in pages])
