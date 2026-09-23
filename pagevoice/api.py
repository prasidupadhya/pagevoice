"""Loopback-only REST/SSE surface over the original local pipeline."""
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Literal
from urllib.parse import urlsplit
import asyncio
import json
import os
import re
import tempfile

from fastapi import FastAPI, File, UploadFile, Form, HTTPException, Request
from fastapi.responses import FileResponse, StreamingResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, ConfigDict, Field
from filelock import FileLock, Timeout

from .engines import REGISTRY, hardware, xtts_ready
from .jobs import Jobs
from .pipeline import new_session, load, signature
from .storage import save
from .languages import default_voice


class Settings(BaseModel):
    model_config = ConfigDict(extra='forbid')
    engine: Literal['xtts', 'say', 'edge'] = 'xtts'
    voice: str | None = Field(default=None, max_length=120)
    format: Literal['m4b', 'mp3'] = 'm4b'
    device: Literal['auto', 'cpu', 'mps', 'cuda', 'rocm'] = 'auto'


class RenderRequest(BaseModel):
    allow_network: bool = False


class PreviewRequest(RenderRequest):
    chapter: int = Field(ge=0)


class RegenRequest(RenderRequest):
    sentence_id: str = Field(pattern=r'^\d{4}-\d{5}$')
    text: str | None = Field(default=None, min_length=1, max_length=220)


def create_app(data=None):
    root = Path(data or os.environ.get('PAGEVOICE_DATA', '.')).resolve()
    root.mkdir(parents=True, exist_ok=True)
    jobs = Jobs(root)

    @asynccontextmanager
    async def lifespan(app):
        jobs.start()
        yield
        jobs.close()

    app = FastAPI(title='PageVoice', version='0.2.0', lifespan=lifespan,
                  docs_url=None, redoc_url=None)
    app.state.root, app.state.jobs = root, jobs

    @app.middleware('http')
    async def local_only(request, call_next):
        host = request.url.hostname
        if host not in ('127.0.0.1', 'localhost', '::1', 'testserver'):
            return JSONResponse({'detail': 'Only localhost is supported.'}, status_code=403)
        origin = request.headers.get('origin')
        if origin:
            parsed = urlsplit(origin)
            if parsed.hostname not in ('localhost', '127.0.0.1', '::1', 'testserver') or parsed.scheme not in ('http', 'https'):
                return JSONResponse({'detail': 'Cross-origin access is not allowed.'}, status_code=403)
        if request.headers.get('sec-fetch-site') == 'cross-site':
            return JSONResponse({'detail': 'Cross-site access is not allowed.'}, status_code=403)
        response = await call_next(request)
        response.headers['X-Content-Type-Options'] = 'nosniff'
        return response

    @app.exception_handler(ValueError)
    async def bad_value(request, exc):
        return JSONResponse({'detail': str(exc)}, status_code=400)

    @app.exception_handler(Timeout)
    async def locked(request, exc):
        return JSONResponse({'detail': 'Project is busy.'}, status_code=409)

    def session(project):
        if not re.fullmatch(r'[0-9a-f]{32}', project):
            raise HTTPException(404, 'Project not found.')
        path = root / 'sessions' / project
        if not (path / 'session.json').is_file():
            raise HTTPException(404, 'Project not found.')
        return path

    def present(project):
        path = session(project)
        state = load(path)
        records = {r['id']: r for r in state['chunks']}
        chapters = []
        ready = total = 0
        for ci, chapter in enumerate((state.get('book') or {}).get('chapters', [])):
            rows = []
            for si, text in enumerate(chapter['sentences']):
                identifier = f'{ci:04d}-{si:05d}'
                record = records.get(identifier)
                complete = bool(record and record.get('signature') == signature(state, identifier, text) and (path / record['audio']).is_file())
                ready += int(complete)
                total += 1
                rows.append({'id': identifier, 'text': text, 'ready': complete,
                             'audio': f'/api/projects/{project}/sentences/{identifier}/audio' if complete else None})
            chapters.append({'index': ci, 'title': chapter['title'], 'sentences': rows,
                             'preview': f'/api/projects/{project}/previews/{ci}' if str(ci) in state.get('previews', {}) else None})
        with jobs.guard:
            latest = sorted((dict(r) for r in jobs.records.values() if r['project'] == project), key=lambda r: r['created'], reverse=True)
        return {'id': project, 'title': (state.get('book') or {}).get('title', state.get('original_name', 'Book')),
                'author': (state.get('book') or {}).get('author', ''),
                'language': (state.get('book') or {}).get('language', state.get('parse_options', {}).get('language', 'en')),
                'status': state['status'], 'error': state.get('error'),
                'engine': state['engine'], 'voice': state['voice'], 'format': state['format'], 'device': state['device'],
                'chapters': chapters, 'progress': {'complete': ready, 'total': total},
                'source_pages': (state.get('book') or {}).get('source_pages', []),
                'output': f'/api/projects/{project}/download' if state.get('output_current') else None,
                'duration': state.get('duration'), 'job': dict(latest[0]) if latest else None,
                'last_run': state.get('last_run')}

    @app.get('/api/health')
    def health():
        return {'status': 'ok', 'languages': ['en', 'es']}

    @app.get('/api/hardware')
    def system():
        return hardware()

    @app.get('/api/engines')
    def engines():
        import importlib.util
        return [{'id': key, 'name': info.name, 'online': info.online, 'model_ready': xtts_ready() if key=='xtts' else True,
                 'installed': (bool(__import__('shutil').which('say')) if key == 'say' else importlib.util.find_spec('TTS' if key == 'xtts' else 'edge_tts') is not None),
                 'voices': [{'id': default_voice(key, lang), 'language': lang} for lang in ('en', 'es')]}
                for key, info in REGISTRY.items()]

    @app.get('/api/projects')
    def projects():
        result = []
        for path in sorted((root / 'sessions').glob('*/session.json'), key=lambda p:p.stat().st_mtime, reverse=True):
            try:
                result.append(present(path.parent.name))
            except (ValueError, KeyError, HTTPException):
                continue
        return result

    @app.post('/api/projects', status_code=202)
    def upload(file: UploadFile = File(...), language: Literal['en','es'] = Form('en'),
               ocr: Literal['auto','always','never'] = Form('auto')):
        suffix = Path(file.filename or '').suffix.lower()
        if suffix not in ('.epub', '.pdf'):
            raise HTTPException(415, 'Choose an EPUB or PDF file.')
        with tempfile.TemporaryDirectory(prefix='pagevoice-upload-') as folder:
            source = Path(folder) / ('book' + suffix)
            size = 0
            with source.open('wb') as stream:
                while chunk := file.file.read(1024 * 1024):
                    size += len(chunk)
                    if size > 100 * 1024 * 1024:
                        raise HTTPException(413, 'Book exceeds 100 MB.')
                    stream.write(chunk)
            if not size:
                raise HTTPException(400, 'The book is empty.')
            path = new_session(source, root, language=language, ocr=ocr)
            state = load(path)
            state['original_name'] = Path(file.filename).name
            save(path / 'session.json', state)
        jobs.submit(path.name, 'prepare')
        return present(path.name)

    @app.get('/api/projects/{project}')
    def project_detail(project: str):
        return present(project)

    @app.patch('/api/projects/{project}/settings')
    def settings(project: str, settings: Settings):
        path = session(project)
        with jobs.guard, FileLock(str(path / '.lock'), timeout=0):
            if jobs.busy(project):
                raise HTTPException(409, 'Wait for the current job to finish.')
            state = load(path)
            if not state.get('book'):
                raise HTTPException(409, 'Book is still being prepared.')
            values = settings.model_dump()
            values['voice'] = values['voice'] or default_voice(values['engine'], state['book']['language'])
            if any(state.get(key) != value for key, value in values.items()):
                state.update(values, output_current=False, status='ready', previews={})
                save(path / 'session.json', state)
        return present(project)

    def enqueue(project, kind, values):
        path = session(project)
        with jobs.guard:
            state = load(path)
            if kind != 'prepare' and not state.get('book'):
                raise HTTPException(409, 'Prepare the book before rendering.')
            if state['engine'] == 'edge' and not values.get('allow_network'):
                raise HTTPException(400, 'Edge sends text to Microsoft; explicit network consent is required.')
            try:
                return jobs.submit(project, kind, **values)
            except ValueError as exc:
                raise HTTPException(409, str(exc)) from exc

    @app.post('/api/projects/{project}/render', status_code=202)
    def render(project: str, options: RenderRequest):
        return enqueue(project, 'render', options.model_dump())

    @app.post('/api/projects/{project}/resume', status_code=202)
    def recover(project: str, options: RenderRequest):
        state = load(session(project))
        return enqueue(project, 'render' if state.get('book') else 'prepare', options.model_dump())

    @app.post('/api/projects/{project}/preview', status_code=202)
    def preview(project: str, options: PreviewRequest):
        state = load(session(project))
        if options.chapter >= len((state.get('book') or {}).get('chapters', [])):
            raise HTTPException(404, 'Chapter not found.')
        return enqueue(project, 'preview', options.model_dump())

    @app.post('/api/projects/{project}/regen', status_code=202)
    def regen(project: str, options: RegenRequest):
        return enqueue(project, 'regen', options.model_dump())

    @app.get('/api/projects/{project}/events')
    async def events(project: str, request: Request):
        session(project)
        async def stream():
            previous = None
            while not await request.is_disconnected():
                data = json.dumps(present(project), ensure_ascii=False)
                if data != previous:
                    yield f'event: progress\ndata: {data}\n\n'
                    previous = data
                else:
                    yield ': heartbeat\n\n'
                await asyncio.sleep(.5)
        return StreamingResponse(stream(), media_type='text/event-stream',
                                 headers={'Cache-Control':'no-cache', 'X-Accel-Buffering':'no'})

    @app.get('/api/projects/{project}/download')
    def download(project: str):
        state = load(session(project))
        path = root / 'outputs' / (project + '.' + state['format'])
        if not state.get('output_current') or not path.is_file():
            raise HTTPException(409, 'No current export. Render or resume this book first.')
        title = re.sub(r'[^\w .-]', '', state['book']['title'])[:100] or 'audiobook'
        return FileResponse(path, filename=title + '.' + state['format'],
                            media_type='audio/mp4' if state['format']=='m4b' else 'audio/mpeg')

    @app.get('/api/projects/{project}/previews/{chapter}')
    def preview_audio(project: str, chapter: int):
        path = session(project)
        state = load(path)
        if str(chapter) not in state.get('previews', {}):
            raise HTTPException(404, 'Preview not ready.')
        return FileResponse(path / 'previews' / f'chapter-{chapter}.mp3', media_type='audio/mpeg')

    @app.get('/api/projects/{project}/sentences/{identifier}/audio')
    def sentence_audio(project: str, identifier: str):
        path = session(project)
        state = load(path)
        record = next((r for r in state['chunks'] if r['id'] == identifier), None)
        if not record:
            raise HTTPException(404, 'Sentence audio not ready.')
        text = state['book']['chapters'][record['chapter']]['sentences'][record['sentence']]
        if record.get('signature') != signature(state, identifier, text):
            raise HTTPException(409, 'Sentence audio is out of date.')
        from .pipeline import chunk_path
        return FileResponse(chunk_path(path, record), media_type='audio/wav')

    web = Path(__file__).resolve().parent.parent / 'web' / 'dist'
    if web.is_dir():
        app.mount('/', StaticFiles(directory=web, html=True), name='reader')
    return app


def serve():
    import uvicorn
    uvicorn.run(create_app(), host='127.0.0.1', port=int(os.environ.get('PAGEVOICE_PORT', '8765')))
