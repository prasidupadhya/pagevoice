"""Small local raster covers. Never fetch remote EPUB resources."""
import io
from pathlib import Path
from zipfile import ZipFile
from defusedxml import ElementTree as ET
from PIL import Image
from .book import member


def extract(source,session):
    target=session/'cover.png'
    try:
        if source.suffix.lower()=='.epub':
            with ZipFile(source) as archive:
                container=ET.fromstring(archive.read('META-INF/container.xml'))
                root=container.find('.//{*}rootfile')
                if root is None:return False
                package=member('',root.attrib['full-path']);opf=ET.fromstring(archive.read(package))
                metadata=opf.find('.//{*}meta[@name="cover"]');cover_id=metadata.attrib.get('content') if metadata is not None else None
                item=next((i for i in opf.findall('.//{*}manifest/{*}item') if 'cover-image' in i.attrib.get('properties','').split() or i.attrib.get('id')==cover_id),None)
                if item is None:return False
                name=member(str(Path(package).parent),item.attrib['href'])
                if archive.getinfo(name).file_size>10*1024**2:return False
                image=Image.open(io.BytesIO(archive.read(name)))
                if image.width*image.height>20_000_000:return False
                image.load()
        else:
            import pypdfium2 as pdfium
            with pdfium.PdfDocument(str(source)) as document:
                page=document[0]
                try:
                    width,height=page.get_size()
                    if min(width,height)<=0:return False
                    bitmap=page.render(scale=min(1,600/max(width,height)))
                    try:image=bitmap.to_pil().copy()
                    finally:bitmap.close()
                finally:page.close()
        image.thumbnail((320,480));image=image.convert('RGB')
        temporary=target.with_suffix('.tmp');image.save(temporary,format='PNG');temporary.replace(target)
        return True
    except (OSError,ValueError,KeyError,IndexError,ET.ParseError):
        # An absent/unreadable cover never prevents book preparation.
        return False
