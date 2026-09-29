"""Explicit local/hosted deployment configuration. No implicit proxy trust."""
from dataclasses import dataclass, field
from pathlib import Path
from urllib.parse import urlsplit
import os
import ipaddress


def values(name, default=''):
    return tuple(x.strip() for x in os.getenv(name, default).split(',') if x.strip())


@dataclass
class Config:
    hosted: bool = field(default_factory=lambda: os.getenv('PAGEVOICE_HOSTED', '0') == '1')
    token: str = field(default_factory=lambda: os.getenv('PAGEVOICE_ACCESS_TOKEN', ''))
    hosts: tuple = field(default_factory=lambda: values('PAGEVOICE_ALLOWED_HOSTS', 'localhost,127.0.0.1,::1,testserver'))
    origins: tuple = field(default_factory=lambda: values('PAGEVOICE_ALLOWED_ORIGINS'))
    quota: int = field(default_factory=lambda: int(os.getenv('PAGEVOICE_DISK_QUOTA_MB', '10240')) * 1024**2)
    rate: int = field(default_factory=lambda: int(os.getenv('PAGEVOICE_RATE_LIMIT', '600')))
    upload_bytes: int = 100 * 1024**2

    def __post_init__(self):
        for proxy in values("PAGEVOICE_TRUSTED_PROXIES"):
            ipaddress.ip_network(proxy, strict=False)  # Reject wildcard trust.
        if not self.hosts or any('*' in x or '/' in x for x in self.hosts):
            raise ValueError('Allowed hosts must be explicit hostnames, never wildcards.')
        for origin in self.origins:
            parsed = urlsplit(origin)
            if parsed.scheme not in ('http', 'https') or not parsed.netloc or parsed.path or parsed.query or parsed.fragment or '*' in origin or parsed.username:
                raise ValueError('Allowed origins must be exact HTTP(S) origins without trailing slash.')
        if self.hosted and (len(self.token) < 32 or not self.origins or not os.getenv('PAGEVOICE_ALLOWED_HOSTS')):
            raise ValueError('Hosted mode requires a 32+ character token, explicit hosts and frontend origins.')
        if self.quota <= 0 or self.rate <= 0:
            raise ValueError('Quota and rate limits must be positive.')

    def origin_allowed(self, origin):
        if self.origins: return origin in self.origins
        parsed = urlsplit(origin)
        return not self.hosted and parsed.scheme in ('http', 'https') and parsed.hostname in ('localhost','127.0.0.1','::1','testserver')


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
