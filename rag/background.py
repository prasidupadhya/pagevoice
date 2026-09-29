"""Bounded background rebuilding coordinated with project deletion."""
from threading import Lock,Thread
from copy import deepcopy
from filelock import FileLock
from .lexical import index_book,status

_guard=Lock()
_tasks={}


def rebuild(session,book):
    book=deepcopy(book)
    key=str(session.resolve())
    with _guard:
        if _tasks.get(key,{}).get('state')=='building':return dict(_tasks[key])
        active=sum(v['state']=='building' for v in _tasks.values())
        if active>=2:raise ValueError('Two indexes are already building. Retry shortly.')
        # Retain only active work plus this project, never an unbounded history.
        for old in list(_tasks):
            if _tasks[old]['state']!='building':del _tasks[old]
        _tasks[key]={'state':'building'}
    def run():
        try:
            root=session.parent.parent
            with FileLock(str(root/f'.delete-{session.name}.lock'),timeout=10):
                if not (session/'session.json').exists() or (root/'trash'/session.name/'deletion.json').exists():return
                index_book(session/'rag',book)
            with _guard:_tasks[key]={'state':'ready'}
        except Exception as exc:
            with _guard:_tasks[key]={'state':'failed','error':str(exc)}
        finally:
            with _guard:
                if _tasks.get(key,{}).get('state')=='building':_tasks.pop(key,None)
    Thread(target=run,daemon=True,name='pagevoice-index').start()
    return {'state':'building'}


def index_status(session,book):
    with _guard:
        current=_tasks.get(str(session.resolve()))
        if current and current['state'] in ('building','failed'):return dict(current)
    return status(session/'rag',book)
