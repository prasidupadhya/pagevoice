"""Read EPUB spine order without extracting untrusted archive paths."""
from dataclasses import dataclass, asdict, field
from pathlib import Path
from urllib.parse import unquote, urlsplit
import posixpath
import re
import unicodedata
import zipfile

from bs4 import BeautifulSoup
from defusedxml import ElementTree as ET
import pysbd
from .languages import language_code


@dataclass
class Chapter:
    title: str
    sentences: list[str]


@dataclass
class Book:
    title: str
    author: str
    language: str
    chapters: list[Chapter]
    source_pages: list[dict] = field(default_factory=list)

    def to_dict(self):
        return asdict(self)


def clean(text: str) -> str:
    return re.sub(r'\s+', ' ', unicodedata.normalize('NFC', text).replace('\u00ad', '')).strip()


def sentences(text: str, language: str) -> list[str]:
    language = language_code(language)
    try:
        segmenter = pysbd.Segmenter(language=language, clean=False)
    except ValueError as exc:
        raise ValueError(f'Unsupported sentence language {language!r}; use --language.') from exc
    result = []
    for sentence in segmenter.segment(text):
        # Bound model input, including languages without spaces. No text is dropped.
        remaining = sentence.strip()
        while len(remaining) > 220:
            cut = remaining.rfind(' ', 0, 221)
            if cut < 80:
                cut = 220
            result.append(remaining[:cut].strip())
            remaining = remaining[cut:].strip()
        if remaining:
            result.append(remaining)
    return result


def member(base: str, href: str) -> str:
    url = urlsplit(href)
    if url.scheme or url.netloc:
        raise ValueError('External EPUB resources are not supported.')
    path = posixpath.normpath(posixpath.join(base, unquote(url.path)))
    if path.startswith(('/', '../')) or path == '..':
        raise ValueError('Unsafe EPUB resource path.')
    return path


def read_epub(path: Path, language: str | None = None) -> Book:
    with zipfile.ZipFile(path) as archive:
        if sum(i.file_size for i in archive.infolist()) > 200_000_000:
            raise ValueError('EPUB uncompressed size exceeds 200 MB.')
        if 'META-INF/encryption.xml' in archive.namelist():
            encryption = ET.fromstring(archive.read('META-INF/encryption.xml'))
            if any('font' not in e.attrib.get('Algorithm', '').lower()
                   and 'embedding' not in e.attrib.get('Algorithm', '').lower()
                   for e in encryption.findall('.//{*}EncryptionMethod')):
                raise ValueError('Encrypted EPUB content is not supported.')
        container = ET.fromstring(archive.read('META-INF/container.xml'))
        rootfile = container.find('.//{*}rootfile')
        if rootfile is None:
            raise ValueError('EPUB has no package document.')
        package = member('', rootfile.attrib['full-path'])
        root = ET.fromstring(archive.read(package))
        metadata = root.find('{*}metadata')
        def meta(key, default):
            element = metadata.find('{*}' + key) if metadata is not None else None
            return clean(element.text or '') if element is not None else default
        lang = language_code(language or meta('language', 'en'))
        manifest = {e.attrib['id']: e.attrib for e in root.findall('./{*}manifest/{*}item')}
        chapters = []
        for ref in root.findall('./{*}spine/{*}itemref'):
            item = manifest[ref.attrib['idref']]
            if ref.attrib.get('linear') == 'no' or 'nav' in item.get('properties', '').split():
                continue
            if item.get('media-type') not in ('application/xhtml+xml', 'text/html'):
                continue
            html = BeautifulSoup(archive.read(member(posixpath.dirname(package), item['href'])), 'html.parser')
            for unwanted in html.select('script, style, nav, head, [hidden]'):
                unwanted.decompose()
            body = html.body or html
            heading = body.find(re.compile('^h[12]$'))
            title = clean(heading.get_text(' ', strip=True)) if heading else f'Chapter {len(chapters) + 1}'
            text = clean(body.get_text(' ', strip=True))
            if text:
                if re.search(r'\[(?:pause|voice)[:\]]', text):
                    raise ValueError('Inline pause/voice markup is not implemented in phase 1.')
                chapters.append(Chapter(title, sentences(text, lang)))
        if not chapters:
            raise ValueError('EPUB has no readable linear chapters.')
        return Book(meta('title', path.stem), meta('creator', 'Unknown author'), lang, chapters)
