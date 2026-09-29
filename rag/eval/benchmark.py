"""Benchmark a local text reflowed into a real 600-page PDF; no downloads.
python -m rag.eval.benchmark /path/to/pg1342.txt --output /tmp/benchmark.json
"""
import argparse
import hashlib
import json
import math
import platform
import statistics
import tempfile
import textwrap
import time
from pathlib import Path


def run(source):
    from reportlab.pdfgen import canvas
    from pagevoice.pdf import read_pdf
    from rag import index_book,search
    from rag.eval.run import percentile
    raw=source.read_text(encoding='utf-8-sig')
    text=raw.split('*** START OF THE PROJECT GUTENBERG EBOOK',1)[-1].split('***',1)[-1].split('*** END OF THE PROJECT GUTENBERG EBOOK',1)[0]
    words=text.split()
    if len(words)<600:raise ValueError('Provide a complete long book, at least 600 words.')
    with tempfile.TemporaryDirectory(prefix='pv-600-page-') as tmp:
        folder=Path(tmp);pdf=folder/'book.pdf';c=canvas.Canvas(str(pdf),pagesize=(612,792));c.setTitle(source.stem)
        for page in range(600):
            start=math.floor(page*len(words)/600);end=math.floor((page+1)*len(words)/600)
            if page%10==0:
                c.bookmarkPage(str(page));c.addOutlineEntry(f'Section {page//10+1}',str(page))
            block=c.beginText(54,738);block.setFont('Times-Roman',11);block.setLeading(16)
            for line in textwrap.wrap(' '.join(words[start:end]),width=86):block.textLine(line)
            c.drawText(block);c.showPage()
        c.save();t=time.perf_counter();book=read_pdf(pdf,language='en',ocr='never').to_dict();parse_seconds=time.perf_counter()-t
        t=time.perf_counter();index_book(folder/'rag',book);build=time.perf_counter()-t
        queries=['Elizabeth Darcy','Bennet daughters','marriage fortune','Lady Catherine','Pemberley','Wickham regiment','Jane Bingley','"young man"','Lizzy','Darcy -Elizabeth']*10
        timings=[]
        for q in queries:
            t=time.perf_counter();search(folder/'rag',book,q,limit=10);timings.append((time.perf_counter()-t)*1000)
        return {'source_sha256':hashlib.sha256(source.read_bytes()).hexdigest(),'platform':platform.platform(),'python':platform.python_version(),'pages':600,'words':len(words),'chapters':len(book['chapters']),'sentences':sum(len(c['sentences']) for c in book['chapters']),'parse_seconds':parse_seconds,'index_build_seconds':build,'index_bytes':sum(p.stat().st_size for p in (folder/'rag').glob('book.sqlite*')),'latency_p50_ms':statistics.median(timings),'latency_p95_ms':percentile(timings,.95),'queries':len(queries),'note':'Complete source reflowed into 600 pages with 60 artificial bookmarks. Not the original edition pagination; native PDF, not OCR.'}


if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('source',type=Path);parser.add_argument('--output',type=Path,required=True);args=parser.parse_args()
    result=run(args.source);args.output.write_text(json.dumps(result,indent=2)+'\n');print(json.dumps(result,indent=2))
