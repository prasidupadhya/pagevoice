"""An original, tiny EPUB fixture; no downloaded book text."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED


def make_sample(path: Path):
    path.parent.mkdir(parents=True, exist_ok=True)
    with ZipFile(path, 'w') as z:
        z.writestr('mimetype', 'application/epub+zip')
        z.writestr('META-INF/container.xml', '<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="Book/book.opf" media-type="application/oebps-package+xml"/></rootfiles></container>')
        z.writestr('Book/book.opf', '''<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="id">pagevoice-sample</dc:identifier><dc:title>The Quiet Harbour</dc:title><dc:creator>PageVoice</dc:creator><dc:language>en</dc:language><meta property="dcterms:modified">2026-09-23T00:00:00Z</meta></metadata><manifest><item id="two" href="two.xhtml" media-type="application/xhtml+xml"/><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/><item id="one" href="one.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="nav"/><itemref idref="one"/><itemref idref="two"/></spine></package>''')
        z.writestr('Book/nav.xhtml', '<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><body><nav epub:type="toc"><ol><li><a href="one.xhtml">Arrival</a></li><li><a href="two.xhtml">Morning</a></li></ol></nav></body></html>')
        for filename, title, text in [('one', 'Arrival', 'The boat reached the quiet harbour. Mira carried a small blue book.'), ('two', 'Morning', 'Sunlight crossed the water. She opened the book and began to read.')]:
            z.writestr(f'Book/{filename}.xhtml', f'<html xmlns="http://www.w3.org/1999/xhtml"><head><title>{title}</title></head><body><h1>{title}</h1><p>{text}</p></body></html>', compress_type=ZIP_DEFLATED)
    return path


if __name__ == '__main__':
    import sys
    print(make_sample(Path(sys.argv[1] if len(sys.argv) > 1 else 'sample.epub')))
