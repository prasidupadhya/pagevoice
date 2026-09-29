"""ASGI boundaries and short-lived, path-scoped media capabilities."""
from collections import deque
from urllib.parse import urlsplit, parse_qs
import hashlib
import hmac
import re
import time
from starlette.responses import JSONResponse
from starlette.exceptions import HTTPException

MEDIA = re.compile(r'^/api/projects/[0-9a-f]{32}/(?:download|cover|previews/\d+|sentences/\d{4}-\d{5}/audio)$')


def media_url(path, config):
    if not config.hosted: return path
    # Round the expiry to avoid changing every SSE snapshot. No text or master
    # secret is included. Capability grants GET for this exact media path only.
    expires = (int(time.time()) // 300 + 13) * 300
    route = urlsplit(path).path
    signature = hmac.new(config.token.encode(), f'{route}:{expires}'.encode(), hashlib.sha256).hexdigest()
    return path + ('&' if '?' in path else '?') + f'expires={expires}&signature={signature}'


def media_allowed(path, query, config):
    if not MEDIA.fullmatch(path): return False
    try:
        params = parse_qs(query)
        expires = int(params['expires'][0])
        if not time.time() < expires <= time.time() + 3900: return False
        expected = hmac.new(config.token.encode(), f'{path}:{expires}'.encode(), hashlib.sha256).hexdigest()
        return hmac.compare_digest(expected.encode(), params['signature'][0].encode())
    except (ValueError, KeyError, IndexError): return False


class Security:
    def __init__(self, app, config):
        self.app, self.config = app, config
        self.requests = {}

    async def __call__(self, scope, receive, send):
        if scope['type'] != 'http': return await self.app(scope, receive, send)
        c = self.config
        headers = {k.decode('latin1').lower(): v.decode('latin1') for k,v in scope['headers']}
        async def reject(code, detail):
            response_headers = {}
            origin = headers.get('origin')
            if origin and c.origin_allowed(origin):
                response_headers = {'Access-Control-Allow-Origin':origin,'Vary':'Origin'}
            await JSONResponse({'detail':detail}, status_code=code,headers=response_headers)(scope,receive,send)
        try: host = urlsplit('//'+headers.get('host','')).hostname
        except ValueError: return await reject(403,'Invalid host.')
        if host not in c.hosts: return await reject(403,'Host is not allowed.')
        origin = headers.get('origin')
        if origin and not c.origin_allowed(origin): return await reject(403,'Origin is not allowed.')
        if not c.hosted and not origin and headers.get('sec-fetch-site') == 'cross-site':
            return await reject(403,'Cross-site access is not allowed.')
        if c.hosted:
            now = time.monotonic()
            ip = (scope.get('client') or ('unknown',0))[0]
            for key in list(self.requests):
                if not self.requests[key] or now-self.requests[key][-1] > 60: del self.requests[key]
            if ip not in self.requests and len(self.requests) >= 4096: return await reject(429,'Too many clients. Retry in one minute.')
            bucket = self.requests.setdefault(ip,deque())
            while bucket and now-bucket[0] > 60: bucket.popleft()
            if len(bucket) >= c.rate: return await reject(429,'Rate limit reached. Retry in one minute.')
            bucket.append(now)
        async def secure_send(message):
            if message['type'] == 'http.response.start':
                extra = [(b'x-content-type-options',b'nosniff'),(b'referrer-policy',b'no-referrer'),(b'cache-control',b'no-store')]
                if origin:
                    extra += [(b'access-control-allow-origin',origin.encode()),(b'vary',b'Origin'),(b'access-control-expose-headers',b'Content-Disposition,Content-Length,Content-Range')]
                message = {**message,'headers':[(k,v) for k,v in message.get('headers',[]) if k.lower()!=b'cache-control']+extra}
            await send(message)
        if scope['method'] == 'OPTIONS':
            if not origin: return await reject(403,'An allowed origin is required.')
            return await JSONResponse({},headers={'Access-Control-Allow-Methods':'GET,POST,PATCH,DELETE,OPTIONS','Access-Control-Allow-Headers':'Authorization,Content-Type,Range','Access-Control-Max-Age':'600'})(scope,receive,secure_send)
        path = scope['path']
        if c.hosted and path != '/api/health':
            valid = hmac.compare_digest(headers.get('authorization','').encode(), ('Bearer '+c.token).encode())
            if not valid and not (scope['method']=='GET' and media_allowed(path,scope.get('query_string',b'').decode('latin1'),c)):
                # Keep CORS on auth failures so the UI can display the login form.
                return await JSONResponse({'detail':'Access token required.'},status_code=401)(scope,receive,secure_send)
        maximum = c.upload_bytes + 1024**2 if path == '/api/projects' else 2*1024**2
        try: length = int(headers.get('content-length','0'))
        except ValueError: return await reject(400,'Invalid content length.')
        if length < 0 or length > maximum: return await reject(413,'Request body is too large.')
        received = 0
        async def limited_receive():
            nonlocal received
            message = await receive()
            received += len(message.get('body',b''))
            if received > maximum: raise HTTPException(413,'Request body is too large.')
            return message
        await self.app(scope,limited_receive,secure_send)
