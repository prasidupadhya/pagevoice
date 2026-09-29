"""Validate containers before queuing expensive book parsing."""
from pathlib import PurePosixPath
import zipfile


def validate_upload(path):
    if path.suffix == '.pdf':
        with path.open('rb') as stream:
            if b'%PDF-' not in stream.read(1024): raise ValueError('The file is not a PDF.')
        return
    try:
        with zipfile.ZipFile(path) as archive:
            entries = archive.infolist()
            if len(entries) > 10000 or sum(x.file_size for x in entries) > 512*1024**2:
                raise ValueError('EPUB exceeds the safe expanded size or entry limit.')
            for entry in entries:
                name = PurePosixPath(entry.filename)
                if name.is_absolute() or '..' in name.parts or '\\' in entry.filename or entry.flag_bits & 1:
                    raise ValueError('EPUB contains an unsafe or encrypted entry.')
                if entry.file_size > 32*1024**2 or entry.file_size > max(1024**2, entry.compress_size*200):
                    raise ValueError('EPUB entry exceeds the safe compression limit.')
            if archive.read('mimetype').strip() != b'application/epub+zip': raise ValueError('The file is not an EPUB.')
            if 'META-INF/container.xml' not in archive.namelist(): raise ValueError('EPUB package metadata is missing.')
    except (zipfile.BadZipFile, KeyError) as exc:
        raise ValueError('The file is not a readable EPUB.') from exc
