"""Original native and image-only-page fixtures, generated locally."""
from pathlib import Path
import tempfile
from reportlab.pdfgen import canvas
from reportlab.lib.utils import ImageReader

from pagevoice.pdf import render_page


def make_pdf(path: Path, scanned=False, bookmarks=True, language="en"):
    path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory() as folder:
        native = Path(folder) / 'native.pdf'
        c = canvas.Canvas(str(native), pagesize=(612, 792))
        c.setTitle('The Paper Lantern')
        c.setAuthor('PageVoice')
        for number, title, line in [(1, 'Chapter One', 'A paper lantern glowed beside the door.'),
                                    (2, 'Chapter Two', 'Mira carried the lantern down to the harbour.')]:
            if language == 'es':
                title = f'Capítulo {number}'
                line = 'María abrió el libro junto al puerto.'
            if bookmarks:
                c.bookmarkPage(str(number))
                c.addOutlineEntry(title, str(number), level=0)
            c.setFont('Helvetica-Bold', 24)
            c.drawString(60, 700, title)
            c.setFont('Helvetica', 16)
            c.drawString(60, 650, line)
            c.drawString(60, 618, 'La noche estaba tranquila. Comenzaba una historia.' if language == 'es' else 'The night was quiet. A new story was beginning.')
            c.showPage()
        c.save()
        if not scanned:
            path.write_bytes(native.read_bytes())
            return path
        image = Path(folder) / 'scan.png'
        render_page(native, 1, image)
        # Build a mixed PDF: one native page followed by an image-only page.
        scan = Path(folder) / 'scan.pdf'
        c = canvas.Canvas(str(scan), pagesize=(612, 792))
        c.drawImage(ImageReader(str(image)), 0, 0, width=612, height=792)
        c.showPage()
        c.save()
        from pypdf import PdfReader, PdfWriter
        writer = PdfWriter()
        writer.add_page(PdfReader(native).pages[0])
        writer.add_page(PdfReader(scan).pages[0])
        writer.add_metadata({'/Title': 'The Paper Lantern', '/Author': 'PageVoice'})
        if bookmarks:
            writer.add_outline_item('Chapter One', 0)
            writer.add_outline_item('Chapter Two', 1)
        writer.write(path)
        return path


if __name__ == '__main__':
    folder = Path('outputs/fixtures')
    print(make_pdf(folder / 'native.pdf'))
    print(make_pdf(folder / 'mixed-scan.pdf', scanned=True))
