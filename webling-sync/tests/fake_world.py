"""A fake Webling and Supabase behind `requests`, for the tests (no network).

World answers every call the legacy scripts and the layer path make:
module functions requests.get/post/delete/patch and requests.Session(). It
records each call (method, URL, parameters, body, headers) so tests can pin
them (the legacy golden test) or check what reached the log (privacy).
"""
import json
import re
import runpy
import sys
from datetime import date
from pathlib import Path
from urllib.parse import parse_qsl, urlsplit

import requests

SRC = Path(__file__).resolve().parent.parent / 'src'

ENV = {
    'WEBLING_DOMAIN': 'club',
    'WEBLING_API_KEY': 'webling-key-123',
    'WEBLING_EMAIL': 'sync@example.com',
    'WEBLING_PASSWORD': 'pw-456',
    'SUPABASE_URL': 'https://db.example',
    'SUPABASE_SERVICE_ROLE_KEY': 'sb_secret_test',
    'ANONYMIZE': 'false',
}

WEBLING = 'https://club.webling.ch'
SUPABASE = 'https://db.example/rest/v1/'
TODAY = date(2026, 10, 28)

NO_JSON = object()
NOW = re.compile(r'\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?\+00:00')


class Response:
    def __init__(self, status_code, body=None):
        self.status_code = status_code
        self.ok = status_code < 400
        self._body = body

    def json(self):
        if self._body is NO_JSON:
            raise ValueError('not JSON')
        return self._body


class World:
    """Webling data (members, groups, calendars, events, participants) and
    Supabase answers (rows per table, RPC handlers). Paths in `failing`
    answer 500, a path in `network_errors` raises ConnectionError with the
    full URL (as requests does)."""

    def __init__(self):
        self.calls = []
        self.members = []
        self.groups = {}
        self.calendars = {}
        self.events = {}
        self.participants = {}
        self.event_list_call = False
        self.login_status = 204
        self.failing = set()
        self.network_errors = set()
        self.tables = {}
        self.table_reads = {}
        self.rpc = {}
        self.post_status = {}

    # requests ------------------------------------------------------------

    def install(self, monkeypatch):
        world = self

        class Session:
            def post(self, url, data=None, **kwargs):
                return world.handle('POST', url, data=data, session=True, **kwargs)

            def get(self, url, **kwargs):
                return world.handle('GET', url, session=True, **kwargs)

        monkeypatch.setattr(requests, 'get', lambda url, **kw: world.handle('GET', url, **kw))
        monkeypatch.setattr(requests, 'post', lambda url, **kw: world.handle('POST', url, **kw))
        monkeypatch.setattr(requests, 'delete', lambda url, **kw: world.handle('DELETE', url, **kw))
        monkeypatch.setattr(requests, 'patch', lambda url, **kw: world.handle('PATCH', url, **kw))
        monkeypatch.setattr(requests, 'Session', Session)
        return self

    def handle(self, method, url, params=None, data=None, json=None, headers=None, session=False,
               timeout=None):
        self.calls.append(record(method, url, params, data, json, headers, session))
        path = urlsplit(url).path
        if any(p in url for p in self.network_errors):
            raise requests.ConnectionError(f'Max retries exceeded with url: {url}?apikey={ENV["WEBLING_API_KEY"]}')
        if url.startswith(WEBLING):
            if any(path.endswith(p) for p in self.failing):
                return Response(500, {'error': 'boom'})
            return self.webling(method, path, params or {}, data or {})
        if url.startswith(SUPABASE):
            body = json if json is not None else (_loads(data) if data else None)
            return self.supabase(method, url[len(SUPABASE):], body)
        raise AssertionError(f'unexpected call {method} {url}')

    # Webling -------------------------------------------------------------

    def webling(self, method, path, params, data):
        if path == '/api/client/session':
            return Response(self.login_status, NO_JSON)
        if path == '/api/client/query/participant':
            event_id = int(data['filter'].split('=')[1])
            return Response(200, {'objects': [p['id'] for p in self.participants.get(event_id, [])]})
        if path.startswith('/api/client/object/'):
            ids = [int(i) for i in path.rsplit('/', 1)[1].split(',')]
            found = [p for ps in self.participants.values() for p in ps if p['id'] in ids]
            if len(ids) == 1:
                # Webling's quirk: one object, not a list, and without its id
                return Response(200, {k: v for k, v in found[0].items() if k != 'id'})
            return Response(200, found)
        rest = path[len('/api/1/'):]
        if rest == 'member':
            return Response(200, self.members)
        if rest.startswith('membergroup/'):
            return Response(200, {'properties': {'title': self.groups[int(rest.split('/')[1])]}})
        if rest == 'calendar':
            return Response(200, {'objects': list(self.calendars)})
        if rest.startswith('calendar/'):
            calendar = self.calendars[int(rest.split('/')[1])]
            return Response(200, {'properties': {'title': calendar['title']},
                                  'children': {'calendarevent': list(calendar['events'])}})
        if rest == 'calendarevent':
            if not self.event_list_call:
                return Response(400, {'error': 'unsupported'})
            calendar_id = int(params['filter'].split('=')[1])
            ids = self.calendars[calendar_id]['events']
            return Response(200, [{'id': i, 'properties': self.events[i], 'parents': [calendar_id]}
                                  for i in ids if i in self.events])
        if rest.startswith('calendarevent/'):
            event_id = int(rest.split('/')[1])
            if event_id not in self.events:
                return Response(404, {'error': 'not found'})
            return Response(200, {'properties': self.events[event_id], 'parents': []})
        raise AssertionError(f'unexpected Webling path {path}')

    # Supabase ------------------------------------------------------------

    def supabase(self, method, rest, body):
        table, _, query = rest.partition('?')
        if table.startswith('rpc/'):
            handler = self.rpc.get(table[4:])
            if handler is None:
                return Response(404, {'code': 'PGRST202', 'message': f'Could not find the function {table[4:]}'})
            return handler(body)
        if method == 'GET':
            rows = self.tables.get(table, [])
            reads = self.table_reads.setdefault(table, 0)
            self.table_reads[table] = reads + 1
            if callable(rows):
                rows = rows(reads)
            if isinstance(rows, Response):
                return rows
            q = dict(parse_qsl(query))
            offset, limit = int(q.get('offset', 0)), int(q.get('limit', 10 ** 9))
            return Response(200, rows[offset:offset + limit])
        if method == 'POST':
            return Response(self.post_status.get(table, 201), NO_JSON)
        return Response(204, NO_JSON)


def _loads(data):
    if isinstance(data, (str, bytes)):
        try:
            return json.loads(data)
        except ValueError:
            return data
    return data


def _now(value):
    if isinstance(value, str):
        return NOW.sub('<now>', value)
    if isinstance(value, list):
        return [_now(v) for v in value]
    if isinstance(value, dict):
        return {k: _now(v) for k, v in value.items()}
    return value


def record(method, url, params, data, json_body, headers, session):
    """One call as the golden file pins it: the API key and timestamps
    replaced, form data and JSON bodies parsed."""
    params = {k: ('<key>' if k == 'apikey' else v) for k, v in (params or {}).items()}
    body = json_body if json_body is not None else _loads(data)
    return _now({
        'method': method,
        'url': url,
        'params': params,
        'body': body,
        'headers': dict(sorted((headers or {}).items())),
        'session': session,
    })


def exit_code(err):
    """The exit status the interpreter gives a SystemExit."""
    if err.code is None:
        return 0
    if isinstance(err.code, int):
        return err.code
    print(err.code, file=sys.stderr)
    return 1


def run_script(name, args=(), today=TODAY):
    """Runs src/<name> as `python src/<name> args` would (in this process,
    so the fakes apply). Returns the exit status."""
    import sync_rules
    original = sync_rules.club_today
    sync_rules.club_today = lambda: today
    argv = sys.argv
    sys.argv = [str(SRC / name), *args]
    try:
        runpy.run_path(str(SRC / name), run_name='__main__')
        return 0
    except SystemExit as err:
        return exit_code(err)
    finally:
        sys.argv = argv
        sync_rules.club_today = original


def set_env(monkeypatch, **extra):
    for key, value in {**ENV, **extra}.items():
        if value is None:
            monkeypatch.delenv(key, raising=False)
        else:
            monkeypatch.setenv(key, value)


# Shared Webling content -------------------------------------------------

def webling_member(member_id, first, last, groups, birthday='2001-02-03', mobile='079 000 00 00',
                   email=None, **extra):
    properties = {'Vorname': first, 'Name': last, 'Geburtstag': birthday, 'Mobile': mobile}
    if email is not None:
        properties['E-Mail'] = email
    properties.update(extra)
    return {'id': member_id, 'parents': list(groups), 'properties': properties}


def participant(pid, member, state='confirmed'):
    return {'id': pid, 'properties': {'594': state, 'Bemerkung': 'secret note'},
            'links': {'member': member}}


def status_rows(rows):
    """members rows as the legacy guard reads them."""
    return [{'id': i, 'membership_status': s, 'archivedAt': None, 'labels': labels}
            for i, s, labels in rows]
