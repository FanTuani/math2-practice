#!/usr/bin/env python3
"""Local practice site and OAuth client for the official Daguan learning MCP."""
import argparse
import base64
import difflib
import hashlib
import hmac
import json
import math
import mimetypes
import os
from pathlib import Path
import re
import secrets
import sys
import tempfile
import threading
import time
import unicodedata
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.error import HTTPError, URLError
from urllib.parse import parse_qs, unquote, urlencode, urlsplit
from urllib.request import HTTPRedirectHandler, Request, build_opener

DEFAULT_SITE = Path(__file__).resolve().parent
PAGE_NAME = '数二真题进度.html'
BASE = 'https://cxyonly.fans'
MCP = BASE + '/mcp'
READ_STATE = 'learning_question_state_get'
WRITE_STATE = 'learning_question_state_update'
MASTERY = {'M': 'mastered', 'P': 'needs_practice', 'N': 'not_known', 'u': 'not_started'}
FROM_MASTERY = {v: k for k, v in MASTERY.items()}
TIMEOUT = 15


class Problem(Exception):
    def __init__(self, status, code, message, retry=None):
        super().__init__(message)
        self.status, self.code, self.retry = status, code, retry


def bad(message):
    return Problem(400, 'invalid', message)


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, *args):
        return None


NETWORK = build_opener(NoRedirect())


def request(url, data=None, headers=None):
    if urlsplit(url).netloc != 'cxyonly.fans' or not url.startswith(BASE + '/'):
        raise Problem(502, 'upstream', '大观园返回了未知的服务地址。')
    try:
        return NETWORK.open(Request(url, data=data, headers=headers or {}), timeout=TIMEOUT)
    except HTTPError as exc:
        raw = exc.read(32768).decode(errors='replace')
        retry_header = exc.headers.get('Retry-After', '')
        if exc.code == 429:
            try:
                body_retry = retry_seconds(json.loads(raw))
            except ValueError:
                body_retry = None
            retry = max(int(retry_header) if retry_header.isdigit() else 0, body_retry or 0) or 60
            raise Problem(429, 'rate_limit', '大观园请求过于频繁，请稍后刷新。', retry) from None
        if exc.code == 409:
            raise Problem(409, 'conflict', '大观园标记已变化，请重新核对。') from None
        if exc.code == 401 or 'invalid_grant' in raw:
            raise Problem(401, 'authorization', '大观园登录已失效，请重新连接。') from None
        if exc.code == 403:
            raise Problem(403, 'permission', '当前大观园授权不支持此操作。') from None
        code = 'session_missing' if exc.code == 404 and url == MCP else 'upstream'
        raise Problem(502, code, f'大观园返回 HTTP {exc.code}，请稍后重试。') from None
    except (OSError, URLError, TimeoutError):
        raise Problem(503, 'offline', '暂时无法连接大观园，请检查网络后重试。') from None


def get_json(url, data=None, *, form=False):
    headers = {'Accept': 'application/json'}
    payload = None
    if data is not None:
        headers['Content-Type'] = 'application/x-www-form-urlencoded' if form else 'application/json'
        payload = urlencode(data).encode() if form else json.dumps(data).encode()
    with request(url, payload, headers) as response:
        result = json.load(response)
    if not isinstance(result, dict):
        raise Problem(502, 'upstream', '大观园返回了无法读取的数据。')
    return result


def normalized(text):
    text = unicodedata.normalize('NFKC', text)
    text = re.split(r'(?:^|\n)\s*\([Aa]\)\s*', text, maxsplit=1)[0]
    text = re.sub(r'^(?:求不定积分|求定积分|求积分|计算)', '求', text.strip())
    text = re.sub(r'\\(?:displaystyle|left|right)(?![A-Za-z])', '', text)
    text = re.sub(r'\\(?:mathrm|mathit)\s*\{([a-zA-Z])\}', r'\1', text)
    text = re.sub(r'\\(?:mathrm|mathit)\s+([a-zA-Z])', r'\1', text)
    text = re.sub(r'\\(?:leqslant|leq|le)(?![A-Za-z])', '≤', text)
    text = re.sub(r'\\(?:geqslant|geq|ge)(?![A-Za-z])', '≥', text)
    text = text.replace(r'\dfrac', r'\frac').replace(r'\tfrac', r'\frac')
    text = text.replace(r'\,', '').replace(r'\!', '')
    # Preserve numeric decimal points, TeX grouping and case-sensitive variables.
    return re.sub(r'(?<!\d)\.|\.(?!\d)|[\s$。,，;；:：]+', '', text)


def similar_stem(local, remote):
    a, b = normalized(local)[:3000], normalized(remote)[:3000]
    return min(len(a), len(b)) >= 12 and (a == b or difflib.SequenceMatcher(None, a, b, autojunk=False).ratio() >= .94)


def same_formulae(local, remote):
    def formulae(stem):
        prompt = re.split(r'(?:^|\n)\s*\([Aa]\)\s*', stem, maxsplit=1)[0]
        values = re.findall(r'\$([^$]+)\$', prompt)
        return sorted(re.sub(r'\s+|\\(?:left|right|displaystyle)(?![A-Za-z])', '', val) for val in values)
    here, there = formulae(local), formulae(remote)
    return len(set(here)) >= 2 and any(len(val) >= 4 for val in here) and here == there


def numbered_sources(source):
    """Only complete original-paper references qualify for first-time linking."""
    aliases = {}
    text = unicodedata.normalize('NFKC', source or '')
    for part in re.split(r'[;,、。\n]', text):
        alias = re.sub(r'\s+', '', part)
        match = re.fullmatch(r'(\d{4})年?数(?:学)?二(?:第?([1-9]\d?)题|\(([1-9]\d?)\))', alias)
        if match:
            aliases[f'{match[1]}-{match[2] or match[3]}'] = alias
    return aliases


def hit_source(item):
    return item.get('source') or '；'.join(m['text'] for m in item.get('search_matches', [])
                                         if m.get('field') == 'source' and m.get('text'))


def exact_exam_source(key, source):
    text = re.sub(r'\s+', '', unicodedata.normalize('NFKC', source))
    year, number = key.split('-')
    return bool(re.search(rf'(?<!\d){year}年?数(?:学)?二(?:第?{number}(?:题)?|\({number}\))(?![0-9])(?:$|[;、,。])', text))


def retry_seconds(obj):
    if not isinstance(obj, dict):
        return None
    value = obj.get('retry_after', obj.get('retry_after_seconds'))
    if isinstance(value, (int, float)) and math.isfinite(value):
        return max(1, math.ceil(value))
    return next((n for item in obj.values() if isinstance(item, dict)
                 if (n := retry_seconds(item)) is not None), None)


def mcp_error(info):
    value = json.dumps(info, ensure_ascii=False).lower()
    if any(word in value for word in ('conflict', 'mismatch', '冲突', '状态已', 'stale')):
        return Problem(409, 'conflict', '大观园中的标记已变化，请重新核对。')
    if 'retry_after' in value or 'rate_limit' in value or 'rate limit' in value:
        return Problem(429, 'rate_limit', '大观园暂时限流，请稍后刷新。', retry_seconds(info) or 60)
    if 'scope' in value or 'permission' in value or 'forbidden' in value:
        return Problem(403, 'permission', '当前连接没有相应的大观园权限。')
    return Problem(502, 'mcp', '大观园未能完成这次请求，请重新读取当前题目。')


class Store:
    def __init__(self, folder):
        folder.mkdir(parents=True, exist_ok=True, mode=0o700)
        self.path = folder / 'connection.json'
        self.data = json.loads(self.path.read_text(encoding='utf-8')) if self.path.exists() else {}

    def save(self):
        with tempfile.NamedTemporaryFile('w', encoding='utf-8', dir=self.path.parent, delete=False) as handle:
            temp = Path(handle.name)
            try:
                json.dump(self.data, handle, ensure_ascii=False)
                handle.flush()
                os.fsync(handle.fileno())
            except BaseException:
                temp.unlink(missing_ok=True)
                raise
        os.replace(temp, self.path)


class Bridge:
    def __init__(self, origin, folder, site_dir=DEFAULT_SITE):
        self.origin, self.store = origin, Store(folder)
        self.site_dir = site_dir.resolve()
        self.lock = threading.RLock()
        self.csrf = secrets.token_urlsafe(32)
        self.pending_auth = None
        self.offers = {}
        self.metadata = None
        self.serial = 0
        self.throttle_until = 0
        self.refresh_after_rejection = False
        self.local_papers = None
        self.timeline_checked = 0
        self.reset_transport()

    def reset_transport(self):
        self.session_id = None
        self.protocol = None
        self.tools = None

    def session(self):
        return {'connected': bool(self.store.data.get('token')), 'csrf': self.csrf,
                'connectionId': self.store.data.get('connectionId'),
                'canWriteFavorite': bool(self.store.data.get('canWriteFavorite')),
                'canWrite': bool(self.store.data.get('canWrite'))}

    def oauth_meta(self):
        if self.metadata is None:
            resource = get_json(BASE + '/.well-known/oauth-protected-resource/mcp')
            meta = get_json(BASE + '/.well-known/oauth-authorization-server')
            if resource.get('resource') != MCP or meta.get('issuer') not in resource.get('authorization_servers', []):
                raise Problem(502, 'oauth', '大观园授权服务声明不一致。')
            for attr in ('registration_endpoint', 'authorization_endpoint', 'token_endpoint'):
                if not str(meta.get(attr, '')).startswith(BASE + '/'):
                    raise Problem(502, 'oauth', '大观园未提供可用的授权地址。')
            if 'S256' not in meta.get('code_challenge_methods_supported', []):
                raise Problem(502, 'oauth', '授权服务器未提供 PKCE S256。')
            self.metadata = meta
        return self.metadata

    def connect(self, write):
        meta = self.oauth_meta()
        scope = 'learning.read learning.write' if write else 'learning.read'
        callback = self.origin + '/oauth/callback'
        clients = self.store.data.setdefault('clients', {})
        cache_key = callback + ' ' + scope
        client_id = clients.get(cache_key)
        if not client_id:
            reg = get_json(meta['registration_endpoint'], {
                'client_name': '数二真题练习（本机）', 'redirect_uris': [callback],
                'token_endpoint_auth_method': 'none', 'scope': scope,
                'grant_types': ['authorization_code', 'refresh_token'], 'response_types': ['code']
            })
            client_id = reg.get('client_id')
            if not isinstance(client_id, str) or not client_id:
                raise Problem(502, 'oauth', '大观园没有返回客户端标识。')
            clients[cache_key] = client_id
            self.store.save()
        verifier, state = secrets.token_urlsafe(48), secrets.token_urlsafe(32)
        challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).decode().rstrip('=')
        self.pending_auth = (state, time.monotonic() + 600, verifier, callback, client_id, scope)
        query = urlencode({'client_id': client_id, 'redirect_uri': callback, 'response_type': 'code',
                           'scope': scope, 'resource': MCP, 'state': state, 'code_challenge': challenge,
                           'code_challenge_method': 'S256'})
        return {'url': meta['authorization_endpoint'] + '?' + query}

    def callback(self, params):
        p = self.pending_auth
        if not p or not hmac.compare_digest(params.get('state', ''), p[0]) or time.monotonic() >= p[1]:
            raise bad('授权请求已过期，请从练习页重新连接。')
        self.pending_auth = None
        if 'error' in params or not params.get('code'):
            raise bad('未完成大观园授权。')
        token = get_json(self.oauth_meta()['token_endpoint'], {'grant_type': 'authorization_code',
                         'code': params['code'], 'code_verifier': p[2], 'redirect_uri': p[3],
                         'client_id': p[4], 'resource': MCP}, form=True)
        self.store_token(token, p[5], p[4])
        self.store.data.update(connectionId=secrets.token_hex(16), canWrite=False, canWriteFavorite=False)
        self.store.save()
        self.reset_transport()
        self.offers.clear()
        self.clear_timeline()
        self.refresh_after_rejection = False
        self.throttle_until = 0
        self.ready()

    def store_token(self, token, default_scope, client_id):
        if not token.get('access_token') or str(token.get('token_type', 'bearer')).lower() != 'bearer':
            raise Problem(502, 'oauth', '大观园没有返回可用的访问令牌。')
        self.store.data['token'] = {'access_token': token['access_token'], 'refresh_token': token.get('refresh_token'),
                                    'scope': token.get('scope', default_scope), 'client_id': client_id,
                                    'expiry': time.time() + float(token.get('expires_in') or 3600)}

    def disconnect(self):
        self.pending_auth = None
        self.store.data = {'clients': self.store.data.get('clients', {}), 'links': self.store.data.get('links', {})}
        self.store.save()
        self.reset_transport()
        self.offers.clear()
        self.clear_timeline()
        self.refresh_after_rejection = False

    def access_token(self):
        current = self.store.data.get('token')
        if not current:
            raise Problem(401, 'disconnected', '请先连接大观园。')
        if current['expiry'] <= time.time() + 30:
            if not current.get('refresh_token'):
                self.disconnect()
                raise Problem(401, 'authorization', '大观园登录已过期，请重新连接。')
            try:
                token = get_json(self.oauth_meta()['token_endpoint'], {'grant_type': 'refresh_token',
                                 'refresh_token': current['refresh_token'], 'client_id': current['client_id'],
                                 'resource': MCP}, form=True)
            except Problem as exc:
                if exc.code == 'authorization':
                    self.disconnect()
                raise
            token.setdefault('refresh_token', current['refresh_token'])
            self.store_token(token, current['scope'], current['client_id'])
            self.store.save()
        return self.store.data['token']['access_token']

    def rpc(self, method, params, *, notification=False):
        wait = math.ceil(self.throttle_until - time.monotonic())
        if wait > 0:
            raise Problem(429, 'rate_limit', '请等待大观园限流时间结束。', wait)
        self.serial += 1
        body = {'jsonrpc': '2.0', 'method': method, 'params': params}
        if not notification:
            body['id'] = self.serial
        headers = {'Authorization': 'Bearer ' + self.access_token(), 'Content-Type': 'application/json',
                   'Accept': 'application/json, text/event-stream'}
        if self.session_id:
            headers['Mcp-Session-Id'] = self.session_id
        if self.protocol:
            headers['MCP-Protocol-Version'] = self.protocol
        try:
            with request(MCP, json.dumps(body, ensure_ascii=False).encode(), headers) as response:
                if method == 'initialize':
                    self.session_id = response.headers.get('Mcp-Session-Id')
                if notification:
                    return {}
                if response.headers.get_content_type() == 'text/event-stream':
                    message, lines, size = {}, [], 0
                    for raw in response:
                        size += len(raw)
                        if size > 6_000_000:
                            break
                        line = raw.decode().rstrip('\r\n')
                        if line.startswith('data:'):
                            lines.append(line[5:].lstrip())
                        elif not line and lines:
                            try:
                                event = json.loads('\n'.join(lines))
                            except ValueError:
                                event = {}
                            lines.clear()
                            if isinstance(event, dict) and event.get('id') == self.serial:
                                message = event
                                break
                else:
                    message = json.load(response)
            if not isinstance(message, dict) or message.get('id') != self.serial:
                raise Problem(502, 'mcp', '大观园未返回匹配的 MCP 响应。')
            if 'error' in message:
                raise mcp_error(message['error'])
            self.refresh_after_rejection = False
            return message['result']
        except Problem as exc:
            if exc.code == 'authorization':
                token = self.store.data.get('token', {})
                if token.get('refresh_token') and not self.refresh_after_rejection:
                    token['expiry'] = 0
                    self.store.save()
                    self.refresh_after_rejection = True
                else:
                    self.disconnect()
            if exc.code == 'rate_limit':
                self.throttle_until = time.monotonic() + (exc.retry or 60)
            if exc.code == 'session_missing':
                self.reset_transport()
            raise

    def ready(self):
        if self.tools is not None:
            return
        self.reset_transport()
        r = self.rpc('initialize', {'protocolVersion': '2025-06-18', 'capabilities': {},
                     'clientInfo': {'name': 'math2-local-practice', 'version': '1.0'}})
        self.protocol = r['protocolVersion']
        self.rpc('notifications/initialized', {}, notification=True)
        available, cursor = {}, None
        while True:
            page = self.rpc('tools/list', {'cursor': cursor} if cursor else {})
            for tool in page['tools']:
                available[tool['name']] = tool.get('inputSchema', {})
            cursor = page.get('nextCursor')
            if not cursor:
                break
        self.tools = available
        token_scope = self.store.data['token']['scope'].split()
        self.store.data['canWrite'] = 'learning.write' in token_scope and WRITE_STATE in available
        fields = available.get(WRITE_STATE, {}).get('properties', {})
        self.store.data['canWriteFavorite'] = (
            self.store.data['canWrite'] and 'is_favorite' in fields and 'expected_is_favorite' in fields
        )
        self.store.save()

    def tool(self, name, args):
        self.ready()
        if name not in self.tools:
            raise Problem(403, 'permission', '大观园未向当前连接开放这项操作。')
        res = self.rpc('tools/call', {'name': name, 'arguments': args})
        data = res.get('structuredContent')
        if not isinstance(data, dict):
            text = '\n'.join(block['text'] for block in res.get('content', []) if block.get('type') == 'text')
            try:
                data = json.loads(text)
            except ValueError:
                data = {'message': text}
        if res.get('isError') or 'error' in data:
            err = mcp_error(data)
            if err.retry:
                self.throttle_until = time.monotonic() + err.retry
            raise err
        return data

    def state(self, qid):
        remote = self.tool(READ_STATE, {'question_id': qid})
        if remote.get('mastery') not in FROM_MASTERY:
            raise Problem(502, 'mastery', '大观园返回了未知掌握状态。')
        fields = {'status': FROM_MASTERY[remote['mastery']]}
        if type(remote.get('is_favorite')) is bool:
            fields['favorite'] = remote['is_favorite']
        values = self.journal()['values']
        if values.get(str(qid)) != fields:
            values[str(qid)] = fields
            self.store.save()
        return {'matched': True, 'id': qid, **fields,
                'canWriteFavorite': self.store.data['canWriteFavorite'],
                'connectionId': self.store.data['connectionId'], 'canWrite': self.store.data['canWrite']}

    def clear_timeline(self):
        self.next_audit = 0
        self.timeline_checked = 0

    def local_catalog(self):
        if self.local_papers is None:
            html = (self.site_dir / PAGE_NAME).read_text(encoding='utf-8')
            def embedded(name):
                match = re.search(r'<script id="' + name + r'" type="application/json">(.*?)</script>', html, re.S)
                return json.loads(match[1])
            records, content = embedded('snapshot'), embedded('question-content')
            self.local_papers = {}
            for paper in records:
                simple = not (paper.get('sectioned') or paper.get('partial') or paper.get('labels'))
                for ordinal in range(1, sum(group[1] for group in paper['groups']) + 1):
                    key = f"{paper['year']}-{ordinal}"
                    self.local_papers[key] = (simple, content[key]['stem'])
        return self.local_papers

    def discover_exam_question(self, qid, links):
        question = self.tool('question_get', {'question_id': qid})
        sources = numbered_sources(question.get('source'))
        local = self.local_catalog()
        keys = sources.keys() & local.keys()
        if question.get('id') == qid and len(keys) == 1:
            key = next(iter(keys))
            simple, stem = local[key]
            remote_stem = question.get('stem') or ''
            if key not in links and (similar_stem(stem, remote_stem) or simple and same_formulae(stem, remote_stem)):
                # A source label can also occur on duplicate bank entries. Keep ambiguous ones unlinked.
                result = self.tool('question_search', {'q': sources[key], 'per_page': 2})
                hits = result.get('items', [])
                if (result.get('total', len(hits)) == len(hits) == 1 and hits[0].get('id') == qid and
                        key in numbered_sources(hit_source(hits[0]))):
                    links[key] = qid
                    self.store.save()
                    return key
        return None

    def journal(self):
        data = self.store.data
        if 'syncJournal' not in data or data['syncJournal']['connection'] != data['connectionId']:
            data['syncJournal'] = {'connection': data['connectionId'], 'page': 1, 'prefix': [],
                                   'queue': {}, 'values': {}, 'unmatched': {}}
        return data['syncJournal']

    def collect_page(self, journal):
        # Ascending pages keep their positions as newer events arrive. Validate the
        # consumed prefix so a changed upstream page is replayed rather than skipped.
        args = {'filter_list_id': 'exam-math-2', 'time_order': 'asc', 'per_page': 40}
        page = journal['page']
        if page > 1 and not journal['prefix'] and journal.get('boundary'):
            prior = self.tool('learning_practice_events_list', {**args, 'page': page - 1})['items']
            if not prior or prior[-1]['id'] != journal['boundary']:
                journal.update(page=1, prefix=[], more=True)
                return
        result = self.tool('learning_practice_events_list', {**args, 'page': page})
        rows = result['items']
        ids = [row['id'] for row in rows]
        prefix = journal['prefix']
        if ids[:len(prefix)] != prefix or (page > 1 and not rows and page > result.get('total_pages', page)):
            journal.update(page=1, prefix=[], more=True)
            return
        for row in rows[len(prefix):]:
            if row.get('question_id') is not None:
                journal['queue'][str(check_id(row['question_id']))] = row['id']
        more = page < result.get('total_pages', page)
        if more and ids:
            journal['boundary'] = ids[-1]
        journal.update(page=page + 1 if more else page, prefix=[] if more else ids, more=more)

    def updates(self, fresh=False):
        self.ready()
        links = self.store.data.setdefault('links', {})
        journal = self.journal()
        queue = journal['queue']
        now = time.monotonic()
        if not self.timeline_checked or now - self.timeline_checked >= (2 if fresh or queue or journal.get('more') else 12):
            if len(queue) < 40 or not any(journal.get('retryAfter', {}).get(k,0) <= time.time() for k in queue):
                self.collect_page(journal)
                # The cursor and unprocessed IDs are committed in one atomic file.
                self.store.save()
            by_id = {str(qid): key for key, qid in links.items()}
            retries = journal.setdefault('retryAfter', {})
            due = (sid for sid in queue if retries.get(sid, 0) <= time.time())
            for sid in list(due)[:4]:
                qid = int(sid)
                try:
                    key = by_id.get(sid) or self.discover_exam_question(qid, links)
                    if key:
                        self.state(qid)
                        journal['unmatched'].pop(sid, None)
                    else:
                        journal['unmatched'][sid] = queue[sid]
                except Problem as exc:
                    if exc.status in (401, 403, 429, 503) or exc.code == 'session_missing':
                        raise
                    # One unavailable question must not hold up all the others.
                    retries[sid] = time.time() + 90
                else:
                    del queue[sid]
                    retries.pop(sid, None)
                self.store.save()
            # Clears and changes to manually linked questions may have no event
            # in the Math II list. Reconcile confirmed links in rotation as well.
            if links and now >= getattr(self, 'next_audit', 0):
                keys = sorted(links)
                previous = journal.get('auditKey', '')
                key = next((k for k in keys if k > previous), keys[0])
                journal['auditKey'] = key
                self.next_audit = now + 15
                self.store.save()
                try:
                    self.state(links[key])
                except Problem as exc:
                    if exc.status in (401, 403, 429, 503) or exc.code == 'session_missing':
                        raise
                    journal['retryAfter'][str(links[key])] = time.time() + 90
                    queue.setdefault(str(links[key]), None)
                    self.store.save()
            self.timeline_checked = now
        values = journal['values']
        items = [{'key': key, 'id': qid, **values[str(qid)]} for key, qid in links.items() if str(qid) in values]
        return {'connectionId': journal['connection'], 'items': items, 'backlog': len(queue),
                'more': bool(queue or journal.get('more')),
                'unmatched': [int(sid) for sid in journal['unmatched'] if int(sid) not in links.values()]}

    def question(self, data):
        self.ready()
        key = question_key(data)
        year, ordinal = key.split('-')
        links = self.store.data.setdefault('links', {})
        manual = data.get('id')
        if not manual and key in links:
            return self.state(links[key])
        complete = True
        if manual:
            qid = check_id(manual)
            found = self.tool('question_get', {'question_id': qid})
            items = [found] if found.get('id') == qid else []
        else:
            number = data.get('number') or ordinal
            if not isinstance(number, str) or len(number) > 20:
                raise bad('缺少原卷题号。')
            # Older originals restart numbering within each section. Some Daguan sources instead
            # identify the same question by its sequential position in parentheses.
            result = self.tool('question_search', {'q': year + '年数学二第' + number + '题', 'per_page': 4})
            batches = [result]
            if number != ordinal or not result.get('items'):
                batches.append(self.tool('question_search', {'q': year + '数二（' + ordinal + '）', 'per_page': 4}))
            items_by_id = {}
            for batch in batches:
                rows = batch.get('items', [])
                complete = complete and batch.get('total', len(rows)) <= len(rows)
                for row in rows:
                    items_by_id[row['id']] = row
            items = list(items_by_id.values())
        local = data.get('stem', '')
        if not isinstance(local, str):
            raise bad('本地题干格式错误。')
        local = local[:12000]
        candidates = []
        for item in items:
            qid = check_id(item['id'])
            source = hit_source(item)
            stem = item.get('stem') or ''
            candidates.append({'id': qid, 'source': str(source)[:240], 'stem': str(stem)[:750]})
        if not manual and complete and len(candidates) == 1:
            hit = candidates[0]
            rewritten = (key in numbered_sources(hit['source']) and self.local_catalog().get(key, (False,))[0]
                         and same_formulae(local, hit['stem']))
            if exact_exam_source(key, hit['source']) and (rewritten or similar_stem(local, hit['stem'])):
                links[key] = hit['id']
                self.timeline_checked = self.next_audit = 0
                self.store.save()
                return self.state(hit['id'])
        self.offers[key] = {c['id'] for c in candidates}
        return {'matched': False, 'candidates': candidates, 'message': (
            '请核对大观园题干并确认关联。' if candidates else '未找到对应题目，可输入已知的大观园题目 ID。')}

    def check_connection(self, data):
        if not self.store.data.get('connectionId') or data.get('connectionId') != self.store.data['connectionId']:
            raise Problem(409, 'connection_changed', '大观园连接已变化，请重新打开这道题。')

    def link(self, data):
        self.check_connection(data)
        key, qid = question_key(data), check_id(data.get('id'))
        if qid not in self.offers.get(key, set()):
            raise bad('请先核对当前候选题目。')
        state = self.state(qid)
        self.store.data.setdefault('links', {})[key] = qid
        self.store.save()
        self.offers.pop(key, None)
        return state

    def mark(self, data, field='mastery'):
        self.check_connection(data)
        self.ready()
        if not self.store.data['canWrite']:
            raise Problem(403, 'permission', '当前仅授权读取，请重新连接并授权写入。')
        key = question_key(data)
        qid = self.store.data.get('links', {}).get(key)
        if not qid:
            raise bad('请先确认这道题对应的大观园题目。')
        if check_id(data.get('id')) != qid:
            raise Problem(409, 'conflict', '此题关联已变化，请重新核对。')
        local_field = 'favorite' if field == 'is_favorite' else 'status'
        old, new = data.get('expected'), data.get(local_field)
        if field == 'is_favorite':
            if not self.store.data['canWriteFavorite']:
                raise Problem(403, 'permission', '大观园未向当前连接开放收藏写入。')
            if type(old) is not bool or type(new) is not bool:
                raise bad('收藏状态必须是布尔值。')
            old_value, new_value = old, new
        else:
            if old not in MASTERY or new not in MASTERY:
                raise bad('掌握状态格式不正确。')
            old_value, new_value = MASTERY[old], MASTERY[new]
        current = self.state(qid)
        if local_field not in current:
            raise Problem(502, 'favorite', '大观园未返回此题的收藏状态。')
        if current[local_field] == new:
            return current
        if current[local_field] != old:
            raise Problem(409, 'conflict', '大观园中的标记已变化，请重新核对。')
        args = {'question_id': qid, field: new_value, 'expected_' + field: old_value}
        schema = self.tools[WRITE_STATE]
        if 'operation_id' in schema.get('properties', {}):
            intent = data.get('operationId')
            if intent is None:
                # Older clients do not send an edit ID. Each explicit submission is a new intent.
                intent = secrets.token_hex(16)
            if not isinstance(intent, str) or not re.fullmatch(r'[A-Za-z0-9:_-]{1,128}', intent):
                raise bad('无效的同步操作标识。')
            # Scope the retry key to the account and exact compare-and-set request.
            context = [data['connectionId'], qid, field, old_value, new_value, intent]
            args['operation_id'] = hashlib.sha256(json.dumps(context).encode()).hexdigest()
        if 'field' in schema.get('required', []):
            args['field'] = field
        if field == 'mastery' and new == 'u' and 'enum' in schema.get('properties', {}).get('mastery', {}):
            if new_value not in schema['properties']['mastery']['enum']:
                raise Problem(422, 'unsupported', '大观园当前不支持清除此标记。')
        self.tool(WRITE_STATE, args)
        actual = self.state(qid)
        if actual.get(local_field) != new:
            raise Problem(409, 'conflict', '回读时大观园状态已变化，请重新核对。')
        return actual


def question_key(data):
    key = data.get('key')
    if not isinstance(key, str) or not re.fullmatch(r'(?:19|20)\d{2}-[1-9]\d?', key):
        raise bad('无效的卷面题号。')
    return key


def check_id(value):
    if type(value) is not int or not 0 < value < 2**31:
        raise bad('大观园题目 ID 必须是正整数。')
    return value


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args):
        # OAuth callback URLs contain short-lived secrets.
        pass

    @property
    def bridge(self):
        return self.server.bridge

    def send(self, status, payload, kind='application/json; charset=utf-8', **headers):
        self.send_response(status)
        self.send_header('Content-Type', kind)
        self.send_header('Content-Length', str(len(payload)))
        self.send_header('Cache-Control', 'no-store')
        self.send_header('Referrer-Policy', 'no-referrer')
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.send_header('X-Frame-Options', 'DENY')
        for key, val in headers.items():
            self.send_header(key, str(val))
        self.end_headers()
        if self.command != 'HEAD':
            self.wfile.write(payload)

    def reply(self, result):
        self.send(200, json.dumps(result, ensure_ascii=False).encode())

    def check_host(self):
        if self.headers.get('Host') != urlsplit(self.bridge.origin).netloc:
            raise Problem(403, 'host', '请使用启动时显示的本机地址。')

    def serve(self):
        self.check_host()
        url = urlsplit(self.path)
        path = unquote(url.path)
        if self.command == 'POST':
            if self.headers.get('Origin') != self.bridge.origin or not hmac.compare_digest(
                    self.headers.get('X-CSRF-Token', ''), self.bridge.csrf):
                raise Problem(403, 'origin', '请在本机练习页执行该操作。')
            if self.headers.get_content_type() != 'application/json':
                raise bad('请求必须使用 JSON。')
            length = int(self.headers.get('Content-Length', -1))
            if not 0 <= length <= 256000:
                raise bad('请求过大或无效。')
            data = json.loads(self.rfile.read(length))
            if not isinstance(data, dict):
                raise bad('请求格式无效。')
            with self.bridge.lock:
                if path == '/api/connect':
                    result = self.bridge.connect(data.get('write') is True)
                elif path == '/api/disconnect':
                    self.bridge.disconnect()
                    result = self.bridge.session()
                elif path == '/api/question':
                    result = self.bridge.question(data)
                elif path == '/api/link':
                    result = self.bridge.link(data)
                elif path == '/api/updates':
                    result = self.bridge.updates(fresh=data.get('fresh') is True)
                elif path == '/api/mark':
                    result = self.bridge.mark(data)
                elif path == '/api/favorite':
                    result = self.bridge.mark(data, field='is_favorite')
                else:
                    raise Problem(404, 'missing', '未找到接口。')
            self.reply(result)
            return
        if path == '/api/health':
            self.reply({'service': 'math2-practice', 'protocol': 1})
            return
        if path == '/api/session':
            self.reply(self.bridge.session())
            return
        if path == '/oauth/callback':
            with self.bridge.lock:
                self.bridge.callback({k: v[0] for k, v in parse_qs(url.query).items() if len(v) == 1})
            self.send(303, b'', Location='/')
            return
        if path in ('/', '/' + PAGE_NAME):
            target = self.bridge.site_dir / PAGE_NAME
        elif path.startswith('/练习资源/'):
            base = (self.bridge.site_dir / '练习资源').resolve()
            target = (self.bridge.site_dir / path[1:]).resolve()
            if not target.is_relative_to(base):
                raise Problem(404, 'missing', '文件不存在。')
        else:
            raise Problem(404, 'missing', '文件不存在。')
        if not target.is_file():
            raise Problem(404, 'missing', '文件不存在。')
        self.send(200, target.read_bytes(), mimetypes.guess_type(target)[0] or 'application/octet-stream')

    def run_handler(self):
        try:
            self.serve()
        except (BrokenPipeError, ConnectionResetError):
            pass
        except Exception as exc:
            if isinstance(exc, Problem):
                issue = exc
            elif isinstance(exc, (ValueError, TypeError)):
                issue = bad('请求或返回数据格式无效。')
            else:
                issue = Problem(502, 'service', '本机服务未能完成此操作，请稍后重试。')
            body = {'code': issue.code, 'error': str(issue)}
            if issue.retry:
                body['retryAfter'] = issue.retry
            if urlsplit(self.path).path == '/oauth/callback':
                import html
                message = html.escape(str(issue))
                self.send(issue.status, ('<!doctype html><meta charset=utf-8><title>大观园连接</title><p>' +
                          message + '</p><a href="/">返回练习页</a>').encode(), 'text/html; charset=utf-8')
            else:
                self.send(issue.status, json.dumps(body, ensure_ascii=False).encode())

    do_GET = run_handler
    do_POST = run_handler
    do_HEAD = run_handler


def default_state_dir():
    override = os.getenv('DAGUAN_STATE_DIR')
    if override:
        return Path(override)
    if sys.platform == 'darwin':
        return Path.home() / 'Library' / 'Application Support' / '数二真题练习'
    if sys.platform == 'win32':
        root = Path(os.getenv('LOCALAPPDATA') or Path.home() / 'AppData' / 'Local')
    else:
        root = Path(os.getenv('XDG_STATE_HOME') or Path.home() / '.local' / 'state')
    return root / 'math2-practice'


def main():
    parser = argparse.ArgumentParser(description='数二真题本机练习服务')
    parser.add_argument('--port', type=int, default=17846)
    parser.add_argument('--site-dir', type=Path, default=DEFAULT_SITE)
    parser.add_argument('--state-dir', type=Path, default=default_state_dir())
    args = parser.parse_args()
    httpd = ThreadingHTTPServer(('127.0.0.1', args.port), Handler)
    origin = f'http://127.0.0.1:{httpd.server_port}'
    httpd.bridge = Bridge(origin, args.state_dir, args.site_dir)
    print('数二真题练习 ' + origin + '/', flush=True)
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        httpd.server_close()


if __name__ == '__main__':
    main()
