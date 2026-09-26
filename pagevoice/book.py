"""Read EPUB spine order without extracting untrusted archive paths."""
from dataclasses import dataclass, asdict, field
from pathlib import Path
from urllib.parse import unquote, urlsplit
import posixpath
import re
import unicodedata
import zipfile

from bs4 import BeautifulSoup, NavigableString, Comment
from defusedxml import ElementTree as ET
from .languages import language_code


@dataclass
class Chapter:
    title: str
    sentences: list[str]
    source: str = ""
    evidence: str = "spine"
    role: str = ""


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


def plain_sentences(text: str, language: str) -> list[str]:
    from .text import split_sentences
    return split_sentences(text, language)


def sentences(text: str, language: str) -> list[str]:
    from .narration import events
    language = language_code(language)
    result = []
    for kind, value, voice in events(text):
        if kind == 'pause':
            result.append(f'[pause:{value:g}]')
        else:
            result.extend(f'[voice:{voice}]{part}[/voice]' if voice else part
                          for part in plain_sentences(value, language))
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
        # Resolve both EPUB 3 navigation and nested EPUB 2 NCX destinations.
        navigation = {}
        for item in manifest.values():
            if 'nav' not in item.get('properties', '').split() and item.get('media-type') != 'application/x-dtbncx+xml': continue
            nav_path = member(posixpath.dirname(package), item['href'])
            if 'nav' in item.get('properties', '').split():
                nav = BeautifulSoup(archive.read(nav_path), 'html.parser')
                toc = next((n for n in nav.find_all('nav') if 'toc' in n.get('epub:type', '').split() or n.get('role') == 'doc-toc'), nav.find('nav'))
                for link in toc.select('a[href]') if toc else []:
                    if urlsplit(link['href']).scheme or urlsplit(link['href']).netloc: continue
                    target = member(posixpath.dirname(nav_path), link['href'])
                    navigation[(target, unquote(urlsplit(link['href']).fragment))] = clean(link.get_text(' ', strip=True))
            elif item.get('media-type') == 'application/x-dtbncx+xml':
                nav = ET.fromstring(archive.read(nav_path))
                for point in nav.findall('.//{*}navPoint'):
                    content, label = point.find('{*}content'), point.find('{*}navLabel/{*}text')
                    if content is not None and label is not None:
                        href = content.attrib['src']
                        navigation.setdefault((member(posixpath.dirname(nav_path), href), unquote(urlsplit(href).fragment)), clean(label.text or ''))
        chapters = []
        for ref in root.findall('./{*}spine/{*}itemref'):
            item = manifest[ref.attrib['idref']]
            if ref.attrib.get('linear') == 'no' or 'nav' in item.get('properties', '').split():
                continue
            if item.get('media-type') not in ('application/xhtml+xml', 'text/html'):
                continue
            resource = member(posixpath.dirname(package), item['href'])
            html = BeautifulSoup(archive.read(resource), 'html.parser')
            # EPUB 2 often puts an HTML contents page in the linear spine.
            guide_toc = {member(posixpath.dirname(package), e.attrib.get('href', '')) for e in root.findall('./{*}guide/{*}reference') if e.attrib.get('type') == 'toc'}
            if resource in guide_toc: continue
            for unwanted in html.select('script, style, nav, head, [hidden]'):
                unwanted.decompose()
            body = html.body or html
            title = navigation.get((resource, ''), '')
            evidence = 'table-of-contents' if title else 'spine'
            parts, anchor, heading_seen, role = [], resource, False, ""
            def flush():
                if parts:
                    text = clean(' '.join(parts))
                    if text:
                        chapters.append(Chapter(title or f'Section {len(chapters) + 1}', sentences(text, lang), anchor, evidence, role))
            # Read blocks in document order; concatenate inline tags without inserting
            # spaces inside words, but retain paragraph boundaries between blocks.
            for br in body.find_all('br'): br.replace_with(' ')
            block_names = {'h1','h2','h3','p','li','blockquote','pre','td','th','dt','dd','div','section','body'}
            blocks = []
            for leaf in body.descendants:
                if not isinstance(leaf, NavigableString) or isinstance(leaf, Comment): continue
                parent = next((x for x in leaf.parents if x.name in block_names), body)
                if blocks and blocks[-1][0] is parent:
                    blocks[-1][1].append(str(leaf))
                else:
                    blocks.append((parent, [str(leaf)]))
            seen_anchors = set()
            for node, fragments in blocks:
                value = clean(''.join(fragments))
                if not value: continue
                ids = [node.get('id', '')] + [x.get('id', '') for x in node.find_all(id=True)] + [x.get('id', '') for x in node.parents if getattr(x, 'attrs', None)]
                nav_id = next((i for i in ids if i and i not in seen_anchors and (resource, i) in navigation), None)
                label = navigation.get((resource, nav_id)) if nav_id else None
                seen_anchors.update(i for i in ids if i)
                semantic = ' '.join(x.get('epub:type','') + ' ' + x.get('role','') for x in [node,*node.parents] if getattr(x,'attrs',None)).split()
                semantic_role = 'front_matter' if any(v in semantic for v in ('frontmatter','preface','foreword','doc-preface','doc-foreword','dedication','titlepage','copyright-page')) else 'back_matter' if any(v in semantic for v in ('backmatter','endnotes','bibliography','appendix','doc-endnotes','doc-bibliography')) else 'chapter' if any(v in semantic for v in ('chapter','bodymatter','doc-chapter')) else ''
                heading = node.name in ('h1', 'h2', 'h3') or bool(re.fullmatch(r'(?:[IVXLCDM]+|(?:Chapter|Capítulo|Capitulo)\s+\S+)', value, re.I))
                if label or heading:
                    had_parts = bool(parts)
                    if parts: flush(); parts = []
                    use_toc = not heading_seen and not had_parts and evidence == 'table-of-contents'
                    title = label or (title if use_toc else value)
                    evidence = 'table-of-contents' if label or use_toc else 'heading'
                    heading_seen = True
                    role = semantic_role
                    source_id = nav_id or ids[0]
                    anchor = resource + ('#' + source_id if source_id else '')
                    # Chapter titles live in metadata rather than interrupting prose.
                    if not heading: parts.append(value)
                else:
                    if not parts: role = semantic_role or role
                    parts.append(value)
            flush()
        if not chapters:
            raise ValueError('EPUB has no readable linear chapters.')
        return Book(meta('title', path.stem), meta('creator', 'Unknown author'), lang, chapters)
