"""Durable, reversible project deletion. Moves and restores are restartable."""
import json
import re
import shutil
import time
from pathlib import Path
from filelock import FileLock, Timeout
from .storage import save, sync_directory

UNDO_SECONDS = 8


def project_id(value):
    if not re.fullmatch(r'[0-9a-f]{32}', value):
        raise ValueError('Invalid project ID.')
    return value


def safe_path(root, relative):
    root = Path(root).resolve()
    path = root / relative
    if Path(relative).is_absolute() or '..' in Path(relative).parts:
        raise ValueError('Unsafe project path.')
    cursor = path
    while cursor != root:
        if cursor.is_symlink():
            raise ValueError('Project paths cannot contain symlinks.')
        cursor = cursor.parent
    if not path.resolve().is_relative_to(root):
        raise ValueError('Project path escapes data directory.')
    return path


def size(path):
    if not path.exists(): return 0
    if path.is_symlink(): raise ValueError('Project paths cannot contain symlinks.')
    if path.is_file(): return path.stat().st_size
    return sum(size(child) for child in path.iterdir())


class Trash:
    def __init__(self, root):
        self.root = Path(root).resolve()
        self.folder = self.root / 'trash'
        self.folder.mkdir(exist_ok=True)
        self.lock = FileLock(str(self.root / '.library.lock'), timeout=10)

    def marker(self, identifier):
        return safe_path(self.root, f'trash/{project_id(identifier)}/deletion.json')

    def hidden(self, identifier):
        return self.marker(identifier).exists()

    def read(self, identifier):
        return json.loads(self.marker(identifier).read_text())

    def source_shared(self, identifier, source):
        # Also count pending Undo projects so the last live sibling cannot erase
        # an upload that will be needed when the other sibling is restored.
        manifests = list((self.root/'sessions').glob('*/session.json'))
        manifests += list(self.folder.glob('*/files/sessions/*/session.json'))
        for path in manifests:
            if path.parent.name == identifier: continue
            try:
                record = json.loads(path.read_text())
                if record.get('source_name') == source: return True
            except (OSError, ValueError):
                # A corrupt sibling cannot safely prove exclusive ownership.
                return True
        return False

    def inventory(self, identifier):
        identifier = project_id(identifier)
        session = safe_path(self.root, f'sessions/{identifier}')
        record = json.loads((session/'session.json').read_text())
        if record.get('id') != identifier: raise ValueError('Project ID mismatch.')
        paths = [f'sessions/{identifier}']
        paths += [str(p.relative_to(self.root)) for p in (self.root/'outputs').glob(f'{identifier}.*')]
        paths += [str(p.relative_to(self.root)) for p in (self.root/'logs').glob(f'{identifier}.*')]
        if (self.root/'logs'/identifier).exists(): paths.append(f'logs/{identifier}')
        for path in (self.root/'jobs').glob('*.json'):
            job = json.loads(path.read_text())
            if job.get('project') == identifier: paths.append(str(path.relative_to(self.root)))
        source = record['source_name']
        safe_path(self.root, 'uploads/'+source)
        shared = self.source_shared(identifier, source)
        if not shared: paths.append('uploads/'+source)
        return {'id':identifier, 'paths':paths, 'bytes':sum(size(safe_path(self.root,p)) for p in paths),
                'source_name':source, 'source_shared':shared, 'has_audio':bool(record.get('chunks')),
                'title':(record.get('book') or {}).get('title',record.get('original_name','Book'))}

    def request(self, identifier):
        with self.lock:
            if self.hidden(identifier): raise FileNotFoundError('Project already deleted.')
            data = self.inventory(identifier)
            data.update(state='waiting', requested=time.time(), expires=None)
            self.marker(identifier).parent.mkdir()
            sync_directory(self.folder)
            save(self.marker(identifier), data)  # Durable tombstone BEFORE any move.
            return data

    def finish(self, identifier):
        with self.lock:
            data = self.read(identifier)
            if data['state'] != 'waiting': return data
            session = safe_path(self.root, f'sessions/{identifier}')
            try:
                # Must never move a directory while synthesis/indexing writes it.
                with FileLock(str(self.root/f'.delete-{identifier}.lock'),timeout=0):
                    lock = FileLock(str(session/'.lock'),timeout=0) if session.exists() else None
                    if lock: lock.acquire()
                    try:
                        if session.exists():
                            data.update(self.inventory(identifier))
                            data['state']='moving'
                            save(self.marker(identifier),data)
                    finally:
                        if lock: lock.release()
            except Timeout: return data
            return self._move(data)

    def _move(self, data):
        identifier=data['id']
        for relative in data['paths']:
            source=safe_path(self.root,relative)
            target=safe_path(self.root,f'trash/{identifier}/files/{relative}')
            if source.exists():
                if target.exists(): raise ValueError('Deletion destination already exists.')
                target.parent.mkdir(parents=True,exist_ok=True)
                source.replace(target)
                sync_directory(source.parent)
                sync_directory(target.parent)
        data.update(state='trashed',expires=time.time()+UNDO_SECONDS)
        save(self.marker(identifier),data)
        return data

    def restore(self, identifier):
        with self.lock:
            data=self.read(identifier)
            if data['state']!='trashed' or time.time()>=data['expires']:
                raise ValueError('Undo window has expired or deletion is still stopping.')
            data['state']='restoring';save(self.marker(identifier),data)
            self._restore(data)

    def _restore(self, data):
        for relative in data['paths']:
            source=safe_path(self.root,f'trash/{data["id"]}/files/{relative}')
            target=safe_path(self.root,relative)
            if source.exists():
                if target.exists(): raise ValueError('Restore destination already exists.')
                target.parent.mkdir(parents=True,exist_ok=True)
                source.replace(target)
                sync_directory(source.parent)
                sync_directory(target.parent)
        # Never auto-resume a restored book and implicitly send text online.
        manifest=self.root/'sessions'/data['id']/'session.json'
        state=json.loads(manifest.read_text())
        if state['status'] not in ('complete','ready'): state['status']='paused'
        save(manifest,state)
        for relative in data['paths']:
            if relative.startswith('jobs/'):
                path=self.root/relative;job=json.loads(path.read_text())
                if job['status'] in ('queued','running','cancelled'): job['status']='paused'
                save(path,job)
        shutil.rmtree(self.marker(data['id']).parent)

    def sweep(self):
        with self.lock:
            for marker in list(self.folder.glob('*/deletion.json')):
                data=json.loads(marker.read_text());identifier=project_id(data['id'])
                if marker != self.marker(identifier): raise ValueError('Invalid trash record.')
                if data['state']=='restoring': self._restore(data)
                elif data['state']=='moving': self._move(data)
                elif data['state']=='waiting': self.finish(identifier)
                elif data['state']=='trashed' and time.time()>=data['expires']:
                    # All files are already isolated; purge is safely repeatable.
                    data['state']='purging';save(marker,data)
                    self._purge(data)
                elif data['state']=='purging': self._purge(data)

    def _purge(self,data):
        # A source left behind because an Undo sibling referenced it becomes
        # collectible only after no live/trashed manifest references it anymore.
        source=data['source_name'];folder=self.marker(data['id']).parent
        files=folder/'files'
        if files.exists(): shutil.rmtree(files)
        if not self.source_shared(data['id'],source):
            safe_path(self.root,'uploads/'+source).unlink(missing_ok=True)
        shutil.rmtree(folder)
        (self.root/f'.delete-{data["id"]}.lock').unlink(missing_ok=True)
