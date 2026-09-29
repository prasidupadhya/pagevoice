"""Reflow checked-in public-domain texts into reproducible evaluation containers.
Run from the repository: python -m rag.eval.build_fixtures (test extras + OCR needed).
No download is performed. Editorial fixture sections are explicitly identified.
"""
import hashlib
import html
import json
import tempfile
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED

ROOT = Path(__file__).parent


def sections(source):
    language = source['language']
    front = {'title':'Acknowledgments' if language=='en' else 'Agradecimientos',
             'paragraphs':['Evaluation edition: the following public-domain text is retained for reproducible retrieval testing.' if language=='en' else 'Edición de evaluación: conservamos el texto de dominio público para comprobar la búsqueda de pasajes.'], 'fixture':True}
    back = {'title':'Index' if language=='en' else 'Bibliografía',
            'paragraphs':['Evaluation edition source: '+source['title']+'.'], 'fixture':True}
    return [front, *source['chapters'], back]


def epub(source,path,nested):
    rows=sections(source)
    with ZipFile(path,'w') as z:
        z.writestr('mimetype','application/epub+zip')
        z.writestr('META-INF/container.xml','<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="book.opf"/></rootfiles></container>')
        items=''.join(f'<item id="c{i}" href="c{i}.xhtml" media-type="application/xhtml+xml"/>' for i in range(len(rows)))
        navitem='<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>' if nested else ''
        z.writestr('book.opf',f'<package xmlns="http://www.idpf.org/2007/opf" version="3.0"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>{html.escape(source["title"])}</dc:title><dc:creator>{source["author"]}</dc:creator><dc:language>{source["language"]}</dc:language></metadata><manifest>{items}{navitem}</manifest><spine>'+''.join(f'<itemref idref="c{i}"/>' for i in range(len(rows)))+'</spine></package>')
        for i,row in enumerate(rows):
            paragraphs=''.join('<p>'+html.escape(p)+'</p>' for p in row['paragraphs'])
            z.writestr(f'c{i}.xhtml',f'<html xmlns="http://www.w3.org/1999/xhtml"><body><h1>{html.escape(row["title"])}</h1>{paragraphs}</body></html>',compress_type=ZIP_DEFLATED)
        if nested:
            links=[f'<li><a href="c{i}.xhtml">{html.escape(r["title"])}</a></li>' for i,r in enumerate(rows)]
            z.writestr('nav.xhtml','<html xmlns:epub="http://www.idpf.org/2007/ops"><body><nav epub:type="toc"><ol>'+links[0]+'<li><span>Stories</span><ol>'+''.join(links[1:-1])+'</ol></li>'+links[-1]+'</ol></nav></body></html>')


def pdf(source,path,scanned):
    from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, PageBreak
    from reportlab.lib.styles import getSampleStyleSheet
    from reportlab.pdfgen import canvas
    from reportlab.lib.utils import ImageReader
    from pypdf import PdfReader, PdfWriter
    from pagevoice.pdf import render_page
    class Document(SimpleDocTemplate):
        def afterFlowable(self,flowable):
            if hasattr(flowable,'anchor'):
                self.canv.bookmarkPage(flowable.anchor)
                self.canv.addOutlineEntry(flowable.getPlainText(),flowable.anchor,level=0)
    styles=getSampleStyleSheet();styles['BodyText'].fontName='Times-Roman';styles['BodyText'].fontSize=12;styles['BodyText'].leading=17
    with tempfile.TemporaryDirectory() as temp:
        native=Path(temp)/'native.pdf'
        doc=Document(str(native),title=source['title'],author=source['author'],pagesize=(612,792))
        story=[]
        for i,row in enumerate(sections(source)):
            if i:story.append(PageBreak())
            h=Paragraph(html.escape(row['title']),styles['Heading1']);h.anchor=f's{i}';story += [h,Spacer(1,12)]
            story += [Paragraph(html.escape(p),styles['BodyText']) for p in row['paragraphs']]
        doc.build(story)
        if not scanned:path.write_bytes(native.read_bytes());return
        raster=Path(temp)/'scan.pdf';c=canvas.Canvas(str(raster),pagesize=(612,792))
        reader=PdfReader(native)
        for i in range(len(reader.pages)):
            image=Path(temp)/'page.png';render_page(native,i,image)
            c.drawImage(ImageReader(str(image)),0,0,width=612,height=792);c.showPage()
        c.save();writer=PdfWriter()
        for page in PdfReader(raster).pages:writer.add_page(page)
        writer.add_metadata({'/Title':source['title'],'/Author':source['author']})
        for item in reader.outline:writer.add_outline_item(item.title,reader.get_destination_page_number(item))
        writer.write(path)


def main():
    from pagevoice.pipeline import read_book
    manifest=[]
    for ident,kind in [('wilde','nested-epub'),('ojos','no-toc-epub'),('beso','native-pdf'),('rabbit','scanned-pdf')]:
        source=json.loads((ROOT/'sources'/f'{ident}.json').read_text())
        filename=ident+('.epub' if 'epub' in kind else '.pdf');path=ROOT/'books'/filename
        if 'epub' in kind:epub(source,path,ident=='wilde')
        else:pdf(source,path,ident=='rabbit')
        book=read_book(path,source['language'],cache=Path(tempfile.mkdtemp(prefix='pv-eval-ocr-'))).to_dict()
        (ROOT/'books'/f'{ident}.json').write_text(json.dumps(book,ensure_ascii=False,indent=2)+'\n')
        manifest.append({'id':ident,'file':filename,'fixture':kind,'source':source['url'],'sha256':hashlib.sha256(path.read_bytes()).hexdigest(),'language':source['language']})
        print(ident,[(c['title'],len(c['sentences']),c['evidence']) for c in book['chapters']],flush=True)
    (ROOT/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')


if __name__=='__main__':main()
