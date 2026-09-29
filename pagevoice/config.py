"""Explicit local/hosted deployment configuration. No implicit proxy trust."""
from dataclasses import dataclass, field
from pathlib import Path
from urllib.parse import urlsplit
import os
import ipaddress
import re
import json


def values(name, default=''):
    return tuple(x.strip() for x in os.getenv(name, default).split(',') if x.strip())


@dataclass
class Config:
    hosted: bool = field(default_factory=lambda: os.getenv('PAGEVOICE_HOSTED', '0') == '1')
    auth_mode: str = field(default_factory=lambda: os.getenv('PAGEVOICE_AUTH_MODE', 'token').strip().lower())
    token: str = field(default_factory=lambda: os.getenv('PAGEVOICE_ACCESS_TOKEN', ''))
    pocketbase_url: str = field(default_factory=lambda: os.getenv('PAGEVOICE_POCKETBASE_URL', '').rstrip('/'))
    pocketbase_collection: str = field(default_factory=lambda: os.getenv('PAGEVOICE_POCKETBASE_AUTH_COLLECTION', 'guests'))
    media_secret: str = field(default_factory=lambda: os.getenv('PAGEVOICE_MEDIA_SECRET', ''))
    hosts: tuple = field(default_factory=lambda: values('PAGEVOICE_ALLOWED_HOSTS', 'localhost,127.0.0.1,::1,testserver'))
    origins: tuple = field(default_factory=lambda: values('PAGEVOICE_ALLOWED_ORIGINS'))
    quota: int = field(default_factory=lambda: int(os.getenv('PAGEVOICE_DISK_QUOTA_MB', '10240')) * 1024**2)
    rate: int = field(default_factory=lambda: int(os.getenv('PAGEVOICE_RATE_LIMIT', '600')))
    upload_bytes: int = 100 * 1024**2

    def __post_init__(self):
        if self.auth_mode not in ('token', 'pocketbase'):
            raise ValueError('PAGEVOICE_AUTH_MODE must be token or pocketbase.')
        if not re.fullmatch(r'[A-Za-z][A-Za-z0-9_]{0,49}', self.pocketbase_collection):
            raise ValueError('PocketBase auth collection name is invalid.')
        for proxy in values("PAGEVOICE_TRUSTED_PROXIES"):
            ipaddress.ip_network(proxy, strict=False)  # Reject wildcard trust.
        if not self.hosts or any('*' in x or '/' in x for x in self.hosts):
            raise ValueError('Allowed hosts must be explicit hostnames, never wildcards.')
        for origin in self.origins:
            parsed = urlsplit(origin)
            if parsed.scheme not in ('http', 'https') or not parsed.netloc or parsed.path or parsed.query or parsed.fragment or '*' in origin or parsed.username:
                raise ValueError('Allowed origins must be exact HTTP(S) origins without trailing slash.')
        if self.auth_mode == 'pocketbase':
            parsed = urlsplit(self.pocketbase_url)
            if parsed.scheme not in ('http', 'https') or not parsed.netloc or parsed.path or parsed.query or parsed.fragment or parsed.username:
                raise ValueError('PocketBase URL must be an HTTP(S) origin without path, query or credentials.')
            if len(self.media_secret) < 32:
                raise ValueError('PocketBase mode requires PAGEVOICE_MEDIA_SECRET with at least 32 characters.')
            if self.hosted and parsed.scheme != 'https' and parsed.hostname not in ('pocketbase', 'localhost', '127.0.0.1', '::1'):
                raise ValueError('Hosted PocketBase must use HTTPS.')
        if self.hosted and (not self.origins or not os.getenv('PAGEVOICE_ALLOWED_HOSTS')):
            raise ValueError('Hosted mode requires explicit allowed hosts and frontend origins.')
        if self.hosted and self.auth_mode == 'token' and len(self.token) < 32:
            raise ValueError('Token hosted mode requires a 32+ character access token.')
        if self.quota <= 0 or self.rate <= 0:
            raise ValueError('Quota and rate limits must be positive.')

    def origin_allowed(self, origin):
        if self.origins: return origin in self.origins
        parsed = urlsplit(origin)
        return not self.hosted and parsed.scheme in ('http', 'https') and parsed.hostname in ('localhost','127.0.0.1','::1','testserver')

    @property
    def media_key(self):
        return self.media_secret if self.auth_mode == 'pocketbase' else self.token


def disk_usage(root):
    total = 0
    for p in Path(root).rglob('*'):
        try:
            if p.is_file() and not p.is_symlink(): total += p.stat().st_size
        except FileNotFoundError: pass  # A concurrent trash purge reclaimed it.
    return total


def check_quota(root, additional=0):
    quota = int(os.getenv('PAGEVOICE_DISK_QUOTA_MB', '10240')) * 1024**2
    if disk_usage(root) + additional > quota:
        raise ValueError('Storage quota reached. Remove a book or increase PAGEVOICE_DISK_QUOTA_MB, then retry.')


def tenant_usage(root, owner_id):
    """Bytes attributable to one verified guest, excluding shared service files."""
    root = Path(root).resolve()
    paths = set()
    sources = set()
    project_ids = set()
    for manifest in (root / 'sessions').glob('*/session.json'):
        try:
            state = json.loads(manifest.read_text(encoding='utf-8'))
            if state.get('owner_id') == owner_id:
                project_id = manifest.parent.name
                project_ids.add(project_id)
                paths.add(manifest.parent)
                if state.get('source_name'):
                    sources.add(state['source_name'])
        except (OSError, ValueError):
            continue
    for marker in (root / 'trash').glob('*/deletion.json'):
        try:
            data = json.loads(marker.read_text(encoding='utf-8'))
            if data.get('id') and data.get('id') not in project_ids:
                saved = root / 'trash' / data['id'] / 'files' / 'sessions' / data['id'] / 'session.json'
                state = json.loads(saved.read_text(encoding='utf-8'))
                if state.get('owner_id') == owner_id:
                    project_id = data['id']
                    project_ids.add(project_id)
                    paths.add(marker.parent)
                    if state.get('source_name'):
                        sources.add(state['source_name'])
        except (OSError, ValueError, KeyError):
            continue
    for project_id in project_ids:
        for path in (root / 'outputs').glob(project_id + '.*'):
            paths.add(path)
        for path in (root / 'logs').glob(project_id + '*'):
            paths.add(path)
    for job in (root / 'jobs').glob('*.json'):
        try:
            if json.loads(job.read_text(encoding='utf-8')).get('project') in project_ids:
                paths.add(job)
        except (OSError, ValueError):
            continue
    for source in sources:
        if Path(source).name == source and not Path(source).is_absolute():
            paths.add(root / 'uploads' / source)
    total = 0
    for path in paths:
        try:
            if path.is_file() and not path.is_symlink():
                total += path.stat().st_size
            elif path.is_dir() and not path.is_symlink():
                total += disk_usage(path)
        except OSError:
            continue
    return total


def check_tenant_quota(root, owner_id, additional=0):
    quota = int(os.getenv('PAGEVOICE_USER_QUOTA_MB', '2048')) * 1024**2
    if tenant_usage(root, owner_id) + additional > quota:
        raise ValueError('Storage quota reached for this private library. Remove a book or contact the site owner.')
    check_quota(root, additional)
