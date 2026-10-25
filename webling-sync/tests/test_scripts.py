"""The sync scripts against a fake Supabase / Webling (no network)."""
import importlib
import json
import sys

import pytest

from sync_rules import WEBLING_NOTE

ENV = {
    'WEBLING_DOMAIN': 'club',
    'WEBLING_API_KEY': 'key',
    'WEBLING_EMAIL': 'sync@example.com',
    'WEBLING_PASSWORD': 'secret',
    'SUPABASE_URL': 'https://db.example',
    'SUPABASE_SERVICE_ROLE_KEY': 'sb_secret_test',
    'ANONYMIZE': 'false',
}


def load(module, monkeypatch):
    for key, value in ENV.items():
        monkeypatch.setenv(key, value)
    sys.modules.pop(module, None)
    return importlib.import_module(module)


class Response:
    def __init__(self, status_code, body=None):
        self.status_code = status_code
        self.ok = status_code < 400
        self._body = body

    def json(self):
        return self._body


class FakeSupabase:
    """Answers GET with fixed rows per table and records DELETE / POST calls."""

    def __init__(self, rows, get_status=200):
        self.rows = rows
        self.get_status = get_status
        self.deleted = []
        self.posted = []

    def get(self, url, headers=None):
        table = url.split('/rest/v1/')[1].split('?')[0]
        return Response(self.get_status, self.rows.get(table, []))

    def delete(self, url, headers=None):
        self.deleted.append(url)
        return Response(204)

    def post(self, url, headers=None, data=None):
        self.posted.append((url, headers, data))
        return Response(201)


@pytest.fixture
def events(monkeypatch):
    return load('events', monkeypatch)


def webling_participant(member_id, state='confirmed'):
    return {'id': 900 + member_id, 'properties': {'594': state}, 'links': {'member': [member_id]}}


def use(monkeypatch, module, fake):
    monkeypatch.setattr(module.requests, 'get', fake.get)
    monkeypatch.setattr(module.requests, 'delete', fake.delete)
    monkeypatch.setattr(module.requests, 'post', fake.post)


def test_participants_are_synced_without_touching_app_rows(events, monkeypatch):
    fake = FakeSupabase({
        'event_participants': [
            {'memberId': 1, 'attendanceStatus': 'registered', 'notes': WEBLING_NOTE},
            {'memberId': 2, 'attendanceStatus': 'registered', 'notes': WEBLING_NOTE},
            {'memberId': 3, 'attendanceStatus': 'attended', 'notes': WEBLING_NOTE},
            {'memberId': 4, 'attendanceStatus': 'registered', 'notes': None},
        ],
        'event_logs': [],
    })
    use(monkeypatch, events, fake)

    events.sync_event_participants(42, [webling_participant(1), webling_participant(5)])

    # Only member 2: a Webling registration no longer confirmed. Member 3 attended,
    # member 4 was added in the app.
    assert len(fake.deleted) == 1
    url = fake.deleted[0]
    assert url.startswith('https://db.example/rest/v1/event_participants?')
    assert 'eventId=eq.42' in url
    assert 'memberId=in.(2)' in url
    assert 'attendanceStatus=eq.registered' in url
    # Spaces percent-encoded as %20, never '+'
    assert 'notes=like.Imported%20from%20Webling*' in url

    # Only member 5 is new; member 1's row is not rewritten
    assert len(fake.posted) == 1
    _, headers, data = fake.posted[0]
    assert 'resolution=ignore-duplicates' in headers['Prefer']
    assert '"memberId": 5' in data
    assert events.errors == []


def test_empty_webling_list_removes_webling_registrations(events, monkeypatch):
    fake = FakeSupabase({
        'event_participants': [
            {'memberId': 1, 'attendanceStatus': 'registered', 'notes': WEBLING_NOTE},
        ],
        'event_logs': [],
    })
    use(monkeypatch, events, fake)

    events.sync_event_participants(42, [])

    assert len(fake.deleted) == 1
    assert 'memberId=in.(1)' in fake.deleted[0]


def test_rows_with_attendance_are_kept(events, monkeypatch):
    fake = FakeSupabase({
        'event_participants': [
            {'memberId': 1, 'attendanceStatus': 'registered', 'notes': WEBLING_NOTE},
        ],
        'event_logs': [{'memberId': 1}],
    })
    use(monkeypatch, events, fake)

    events.sync_event_participants(42, [])

    assert fake.deleted == []


def test_nothing_changes_when_supabase_cannot_be_read(events, monkeypatch):
    fake = FakeSupabase({}, get_status=500)
    use(monkeypatch, events, fake)

    events.sync_event_participants(42, [webling_participant(1)])

    assert fake.deleted == []
    assert fake.posted == []
    assert events.errors


def test_failed_participant_fetch_is_none_not_empty(events, monkeypatch):
    monkeypatch.setattr(events.session, 'post', lambda url, data=None: Response(500))
    assert events.get_event_participants(42) is None

    monkeypatch.setattr(events.session, 'post', lambda url, data=None: Response(200, {'objects': []}))
    assert events.get_event_participants(42) == []


@pytest.mark.parametrize('body', [{'error': 'x'}, {'objects': None}, ['objects']])
def test_unexpected_participant_answer_is_none(events, monkeypatch, body):
    # A 200 without a list of ids must not look like an event without participants
    monkeypatch.setattr(events.session, 'post', lambda url, data=None: Response(200, body))
    assert events.get_event_participants(42) is None
    assert events.errors


def test_failed_bulk_fetch_is_none(events, monkeypatch):
    monkeypatch.setattr(events.session, 'post', lambda url, data=None: Response(200, {'objects': [7]}))
    monkeypatch.setattr(events.session, 'get', lambda url: Response(500))
    assert events.get_event_participants(42) is None


def test_one_broken_member_does_not_stop_the_others(monkeypatch, capsys):
    webling = load('webling', monkeypatch)
    members = [
        {'id': 1, 'parents': [10], 'properties': {
            'Vorname': 'Anna', 'Name': 'Muster', 'Geburtstag': None, 'Mobile': None}},
        {'id': 2, 'parents': [10], 'properties': {'Name': 'Ohne Vorname'}},
        {'id': 3, 'parents': [10], 'properties': {
            'Vorname': 'Ben', 'Name': 'Beispiel', 'Geburtstag': None, 'Mobile': None}},
    ]
    monkeypatch.setattr(webling, 'webling_get', lambda *args, **kwargs: Response(200, members))
    monkeypatch.setattr(webling, 'get_label', lambda parents: ['03_Austritt'])
    upserted = []
    monkeypatch.setattr(webling, 'upsert', lambda table, data: upserted.append(data['id']) or True)
    monkeypatch.setattr(webling.requests, 'post', lambda url, headers=None, data=None: Response(201))

    assert webling.sync_members() == 1
    assert upserted == [1, 3]

    out = capsys.readouterr().out
    assert 'member 2' in out
    # Group titles (leaving and billing states) never reach the public log
    assert '03_Austritt' not in out


def sync_members_with(monkeypatch, link_response):
    webling = load('webling', monkeypatch)
    members = [
        {'id': 1, 'parents': [10], 'properties': {
            'Vorname': 'Anna', 'Name': 'Muster', 'Geburtstag': None, 'Mobile': None}},
        {'id': 2, 'parents': [10], 'properties': {'Vorname': 'Ben'}},
        {'id': 3, 'parents': [10], 'properties': {
            'Vorname': 'Cleo', 'Name': 'Beispiel', 'Geburtstag': None, 'Mobile': None}},
    ]
    monkeypatch.setattr(webling, 'webling_get', lambda *args, **kwargs: Response(200, members))
    monkeypatch.setattr(webling, 'get_label', lambda parents: ['Aktiv'])
    monkeypatch.setattr(webling, 'upsert', lambda table, data: True)
    posted = []

    def post(url, headers=None, data=None):
        posted.append((url, headers, data))
        return link_response

    monkeypatch.setattr(webling.requests, 'post', post)
    return webling.sync_members(), posted


def test_synced_members_are_linked_to_webling(monkeypatch):
    failed, posted = sync_members_with(monkeypatch, Response(201))

    assert failed == 1  # member 2 has no last name property
    assert len(posted) == 1
    url, headers, data = posted[0]
    assert url == 'https://db.example/rest/v1/member_links'
    assert 'resolution=ignore-duplicates' in headers['Prefer']
    assert json.loads(data) == [
        {'connection': 'webling', 'external_id': '1', 'member_id': 1},
        {'connection': 'webling', 'external_id': '3', 'member_id': 3},
    ]


def test_missing_link_table_is_not_an_error(monkeypatch, capsys):
    response = Response(404, {'code': 'PGRST205', 'message': "Could not find the table 'public.member_links'"})
    failed, _ = sync_members_with(monkeypatch, response)

    assert failed == 1  # only member 2
    assert 'links skipped' in capsys.readouterr().out


def test_failed_link_write_fails_the_run(monkeypatch):
    failed, _ = sync_members_with(monkeypatch, Response(500, {'code': 'XX000', 'message': 'boom'}))
    assert failed == 2
