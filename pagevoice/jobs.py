"""Single local worker and durable job records; no Redis or external service."""
from pathlib import Path
from threading import RLock, Event, Thread
from queue import Queue, Empty
import json
import time
import traceback
import uuid
from filelock import FileLock

from .pipeline import resume, regenerate
from .storage import save

ACTIVE = {'queued', 'running'}


class Jobs:
    def __init__(self, root):
        self.root = Path(root)
        self.folder = self.root / 'jobs'
        self.folder.mkdir(parents=True, exist_ok=True)
        self.records = {}
        self.guard = RLock()
        self.queue = Queue()
        self.stop = Event()
        self.thread = None
        self.owner = FileLock(str(self.folder / '.worker.lock'), timeout=0, thread_local=False)

    def start(self):
        self.owner.acquire()
        for path in sorted(self.folder.glob('*.json')):
            try:
                record = json.loads(path.read_text())
                self.records[record['id']] = record
                if record['status'] in ACTIVE:
                    record['status'] = 'queued'
                    save(path, record)
                    self.queue.put(record['id'])
            except (ValueError, KeyError):
                continue
        self.thread = Thread(target=self.work, daemon=True, name='pagevoice-worker')
        self.thread.start()

    def close(self):
        self.stop.set()
        if self.thread:
            self.thread.join(timeout=5)
        # Keep ownership while a long synthesis is finishing in this process.
        if not self.thread or not self.thread.is_alive():
            self.owner.release()

    def busy(self, project):
        return any(r['project'] == project and r['status'] in ACTIVE for r in self.records.values())

    def submit(self, project, kind, **options):
        with self.guard:
            if self.busy(project):
                raise ValueError('This project already has a queued or running job.')
            record = {'id': uuid.uuid4().hex, 'project': project, 'kind': kind,
                      'status': 'queued', 'created': time.time(), 'options': options}
            self.records[record['id']] = record
            save(self.folder / f'{record["id"]}.json', record)
            self.queue.put(record['id'])
            return dict(record)

    def work(self):
        while not self.stop.is_set():
            try:
                identifier = self.queue.get(timeout=.2)
            except Empty:
                continue
            with self.guard:
                record = self.records[identifier]
                record['status'] = 'running'
                save(self.folder / f'{identifier}.json', record)
            try:
                session = self.root / 'sessions' / record['project']
                options = record['options']
                with FileLock(str(self.folder / '.synthesis.lock')):
                    if record['kind'] == 'regen':
                        regenerate(session, options['sentence_id'], options.get('text'),
                                   options.get('allow_network', False), request_id=identifier)
                    else:
                        resume(session, options.get('allow_network', False),
                               prepare_only=record['kind'] == 'prepare',
                               chapter_index_only=options.get('chapter') if record['kind'] == 'preview' else None)
                record['status'] = 'complete'
            except Exception as exc:
                record.update(status='failed', error=str(exc), traceback=traceback.format_exc())
            finally:
                with self.guard:
                    record['finished'] = time.time()
                    save(self.folder / f'{identifier}.json', record)
                self.queue.task_done()
        self.owner.release()
