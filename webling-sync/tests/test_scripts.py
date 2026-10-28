"""The sync scripts against a fake Supabase / Webling (no network)."""
import importlib
import json
import sys

import pytest

from sync_rules import WEBLING_NOTE, status_from_labels

ENV = {
    'WEBLING_DOMAIN': 'club',
    'WEBLING_API_KEY': 'key',
    'WEBLING_EMAIL': 'sync@example.com',
    'WEBLING_PASSWORD': 'secret',
    'SUPABASE_URL': 'https://db.example',
    'SUPABASE_SERVICE_ROLE_KEY': 'sb_secret_test',
    'ANONYMIZE': 'false',
}


def load(module, monkeypatch, ask_database=False):
    for key, value in ENV.items():
        monkeypatch.setenv(key, value)
    sys.modules.pop(module, None)
    loaded = importlib.import_module(module)
    if module == 'webling' and not ask_database:
        # The database's status rule answers like the port in sync_rules
        monkeypatch.setattr(loaded, 'database_status_rule',
                            lambda rows: lambda labels: status_from_labels(labels, 'active'))
    return loaded


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
    monkeypatch.setattr(webling.requests, 'get', lambda url, headers=None: Response(200, []))

    assert webling.sync_members() == 1
    assert upserted == [1, 3]

    out = capsys.readouterr().out
    assert 'member 2' in out
    # Group titles (leaving and billing states) never reach the public log
    assert '03_Austritt' not in out


def sync_members_with(monkeypatch, link_response, links=(), in_range=(), calls=None, accept=None):
    if accept is not None:
        monkeypatch.setenv('WEBLING_ACCEPT_GONE', accept)
    webling = load('webling', monkeypatch)
    members = [
        {'id': 1001, 'parents': [10], 'properties': {
            'Vorname': 'Anna', 'Name': 'Muster', 'Geburtstag': None, 'Mobile': None}},
        {'id': 1002, 'parents': [10], 'properties': {'Vorname': 'Ben'}},
        {'id': 1003, 'parents': [10], 'properties': {
            'Vorname': 'Cleo', 'Name': 'Beispiel', 'Geburtstag': None, 'Mobile': None}},
    ]
    monkeypatch.setattr(webling, 'webling_get', lambda *args, **kwargs: Response(200, members))
    monkeypatch.setattr(webling, 'get_label', lambda parents: ['Aktiv'])
    monkeypatch.setattr(webling, 'upsert', lambda table, data: True)
    calls = calls if calls is not None else []

    def post(url, headers=None, data=None):
        calls.append(('post', url, headers, data))
        return link_response if not calls[:-1] else Response(201)

    def get(url, headers=None):
        if '/member_links?' in url:
            return Response(200, [{'external_id': str(i), 'member_id': i, 'gone_at': None} for i in links])
        return Response(200, [{'id': i} for i in in_range])

    def patch(url, headers=None, data=None):
        calls.append(('patch', url, headers, data))
        return Response(204)

    monkeypatch.setattr(webling.requests, 'post', post)
    monkeypatch.setattr(webling.requests, 'get', get)
    monkeypatch.setattr(webling.requests, 'patch', patch)
    return webling.sync_members(), calls


def test_synced_members_are_linked_to_webling(monkeypatch):
    failed, calls = sync_members_with(monkeypatch, Response(201), links=(1001, 1003), in_range=(1001, 1002, 1003))

    assert failed == 1  # member 1002 has no last name property
    assert len(calls) == 1
    _, url, headers, data = calls[0]
    assert url == 'https://db.example/rest/v1/member_links'
    assert 'resolution=merge-duplicates' in headers['Prefer']
    rows = json.loads(data)
    assert [(r['external_id'], r['member_id'], r['gone_at']) for r in rows] == [
        ('1001', 1001, None),
        ('1003', 1003, None),
    ]
    assert all(r['last_seen_at'] for r in rows)


def test_missing_link_table_is_not_an_error(monkeypatch, capsys):
    response = Response(404, {'code': 'PGRST205', 'message': "Could not find the table 'public.member_links'"})
    failed, calls = sync_members_with(monkeypatch, response)

    assert failed == 1  # only member 1002
    assert 'links skipped' in capsys.readouterr().out
    assert [c[0] for c in calls] == ['post']


def test_failed_link_write_fails_the_run(monkeypatch):
    failed, _ = sync_members_with(monkeypatch, Response(500, {'code': 'XX000', 'message': 'boom'}))
    assert failed == 2


def test_members_gone_from_webling_are_marked(monkeypatch, capsys):
    # 1001 and 1003 synced, 1002 failed but is still in Webling; 1004 is gone,
    # 1005 was never linked and is not in Webling
    failed, calls = sync_members_with(
        monkeypatch, Response(201), links=(1001, 1002, 1003, 1004), in_range=range(1001, 1006))

    assert failed == 1
    # Ids only in the bodies, never in a URL (it shows up in errors)
    assert [(c[0], c[1]) for c in calls[1:]] == [
        ('post', 'https://db.example/rest/v1/member_links'),
        ('post', 'https://db.example/rest/v1/member_links'),
    ]
    assert 'resolution=merge-duplicates' in calls[1][2]['Prefer']
    marked = json.loads(calls[1][3])
    assert [(r['external_id'], r['member_id']) for r in marked] == [('1004', 1004)]
    assert marked[0]['gone_at']
    assert 'resolution=ignore-duplicates' in calls[2][2]['Prefer']
    adopted = json.loads(calls[2][3])
    assert [(r['external_id'], r['member_id']) for r in adopted] == [('1005', 1005)]
    assert adopted[0]['gone_at']
    out = capsys.readouterr().out
    assert '1 members are no longer in Webling' in out
    assert '1 former Webling members recorded as gone' in out


def test_mass_gone_is_refused(monkeypatch):
    failed, calls = sync_members_with(
        monkeypatch, Response(201), links=range(1001, 1040), in_range=range(1001, 1040))

    assert [c[0] for c in calls] == ['post']  # links written, nothing marked gone
    assert failed == 2  # member 1002, and the refused marking


def test_mass_gone_goes_ahead_with_the_exact_accepted_count(monkeypatch, capsys):
    # 1004-1039 are gone (36 of 39): refused unless exactly 36 is accepted
    failed, calls = sync_members_with(
        monkeypatch, Response(201), links=range(1001, 1040), in_range=range(1001, 1040), accept='36')

    assert failed == 1  # only member 1002
    assert [c[0] for c in calls] == ['post', 'post']
    assert len(json.loads(calls[1][3])) == 36
    assert '36 members are no longer in Webling' in capsys.readouterr().out


def test_mass_gone_with_a_wrong_accepted_count_is_refused(monkeypatch, capsys):
    failed, calls = sync_members_with(
        monkeypatch, Response(201), links=range(1001, 1040), in_range=range(1001, 1040), accept='35')

    assert failed == 2
    assert [c[0] for c in calls] == ['post']
    assert 'accept_gone=36' in capsys.readouterr().out


def sync_statuses(monkeypatch, labels, current, after=None, accept=None, status_code=200,
                  rule=False):
    """sync_members with Webling members {id: labels}, the database's members
    rows before the run (current) and after it (after, default: current),
    and the database's status rule (rule: labels -> status, None when it
    cannot be asked; default: the port in sync_rules).
    Returns (failed, upserted ids, posted urls)."""
    if accept is not None:
        monkeypatch.setenv('WEBLING_ACCEPT_STATUS_DROP', accept)
    webling = load('webling', monkeypatch)
    if rule is not False:
        monkeypatch.setattr(webling, 'database_status_rule', lambda rows: rule)
    members = [{'id': i, 'parents': [i], 'properties': {
        'Vorname': 'Anna', 'Name': 'Muster', 'Geburtstag': None, 'Mobile': None}} for i in labels]
    monkeypatch.setattr(webling, 'webling_get', lambda *args, **kwargs: Response(200, members))
    monkeypatch.setattr(webling, 'get_label', lambda parents: labels[parents[0]])
    upserted, posted = [], []
    monkeypatch.setattr(webling, 'upsert', lambda table, data: upserted.append(data['id']) or True)
    reads = []

    def get(url, headers=None):
        if '/member_links?' in url:
            return Response(200, [{'external_id': str(i), 'member_id': i, 'gone_at': None} for i in labels])
        reads.append(url)
        if status_code != 200:
            return Response(status_code, {'code': 'XX000', 'message': 'boom'})
        return Response(200, current if len(reads) == 1 or after is None else after)

    def post(url, headers=None, data=None):
        posted.append(url)
        return Response(201)

    monkeypatch.setattr(webling.requests, 'get', get)
    monkeypatch.setattr(webling.requests, 'post', post)
    return webling.sync_members(), upserted, posted


def active_rows(ids, labels=('Aktiv',)):
    return [{'id': i, 'membership_status': 'active', 'archivedAt': None, 'labels': list(labels)}
            for i in ids]


def test_mass_status_drop_writes_nothing(monkeypatch, capsys):
    # Webling renamed Aktiv: all 40 members would lose their membership
    ids = range(1001, 1041)
    failed, upserted, posted = sync_statuses(
        monkeypatch, {i: ['Aktive Mitglieder'] for i in ids}, active_rows(ids))

    assert failed == 1
    assert upserted == [] and posted == []  # no member, link or gone mark
    out = capsys.readouterr().out
    assert '40 of 40 members with an active or passive membership' in out
    assert 'non_member: 40' in out
    assert 'accept_status_drop=40' in out
    # Neither group titles nor ids reach the public log
    assert 'Aktiv' not in out
    assert '1001' not in out


def test_mass_status_drop_goes_ahead_with_the_exact_accepted_count(monkeypatch, capsys):
    ids = range(1001, 1041)
    after = [{**row, 'membership_status': 'non_member'} for row in active_rows(ids)]
    failed, upserted, posted = sync_statuses(
        monkeypatch, {i: ['Aktive Mitglieder'] for i in ids}, active_rows(ids), after=after,
        accept='40')

    assert failed == 0
    assert upserted == list(ids)
    assert posted == ['https://db.example/rest/v1/member_links']
    out = capsys.readouterr().out
    assert ('40 of 40 members lose their active or passive membership in this run '
            '(non_member: 40; accepted with accept_status_drop)') in out
    assert 'warning' not in out


def test_mass_status_drop_with_a_wrong_accepted_count_writes_nothing(monkeypatch, capsys):
    ids = range(1001, 1041)
    failed, upserted, _ = sync_statuses(
        monkeypatch, {i: ['Aktive Mitglieder'] for i in ids}, active_rows(ids), accept='39')

    assert failed == 1
    assert upserted == []
    assert 'accept_status_drop=40' in capsys.readouterr().out


def test_a_few_members_leaving_are_synced_and_counted(monkeypatch, capsys):
    ids = range(1001, 1041)
    labels = {i: ['Aktiv'] for i in ids} | {1001: ['03_Austritt'], 1002: ['Nicht-Mitglieder']}
    failed, upserted, _ = sync_statuses(monkeypatch, labels, active_rows(ids))

    assert failed == 0
    assert upserted == list(ids)
    out = capsys.readouterr().out
    assert ('2 of 40 members lose their active or passive membership in this run '
            '(left: 1, non_member: 1)') in out
    assert 'accept' not in out
    assert 'Austritt' not in out and 'Nicht-Mitglieder' not in out and '1001' not in out


def test_a_run_without_status_changes_says_nothing_about_them(monkeypatch, capsys):
    ids = range(1001, 1041)
    failed, upserted, _ = sync_statuses(monkeypatch, {i: ['Aktiv'] for i in ids}, active_rows(ids))

    assert failed == 0
    assert upserted == list(ids)
    assert 'membership' not in capsys.readouterr().out


def test_status_read_has_no_member_id_in_the_url(monkeypatch):
    webling = load('webling', monkeypatch)
    assert webling.MEMBER_STATUS_QUERY == (
        'members?select=id,membership_status,archivedAt,labels&id=gte.1000&id=lt.10000000&order=id')


def test_unreadable_statuses_write_nothing(monkeypatch, capsys):
    failed, upserted, posted = sync_statuses(
        monkeypatch, {1001: ['Aktiv']}, [], status_code=500)

    assert failed == 1
    assert upserted == [] and posted == []
    assert 'no member written' in capsys.readouterr().out


def test_database_status_unlike_the_prediction_is_reported(monkeypatch, capsys):
    # The rules here predict no change, the database takes 10 of 40 out
    ids = range(1001, 1041)
    after = active_rows(ids)
    for row in after[:10]:
        row['membership_status'] = 'non_member'
    failed, upserted, _ = sync_statuses(
        monkeypatch, {i: ['Aktiv'] for i in ids}, active_rows(ids), after=after)

    assert upserted == list(ids)  # written: the guard saw nothing
    assert failed == 1
    out = capsys.readouterr().out
    assert '::warning::10 members got another membership status' in out
    assert 'Error: 10 members lost their active or passive membership' in out


def test_guard_predicts_with_the_database_rule(monkeypatch, capsys):
    # A changed rule on main must not decide: the database (still the old
    # rule on prod) takes the members out, so the guard refuses
    ids = range(1001, 1041)
    failed, upserted, posted = sync_statuses(
        monkeypatch, {i: ['Aktiv'] for i in ids}, active_rows(ids), rule=lambda labels: 'non_member')

    assert failed == 1
    assert upserted == [] and posted == []
    assert '40 of 40 members with an active or passive membership' in capsys.readouterr().out


def test_status_rule_that_cannot_be_asked_writes_nothing(monkeypatch, capsys):
    failed, upserted, posted = sync_statuses(
        monkeypatch, {1001: ['Aktiv']}, active_rows([1001]), rule=None)

    assert failed == 1
    assert upserted == [] and posted == []
    assert "status rule could not be asked; no member written" in capsys.readouterr().out


def test_status_rule_asks_the_database_once_per_label_set(monkeypatch):
    webling = load('webling', monkeypatch, ask_database=True)
    asked = []

    def post(url, headers=None, data=None):
        asked.append((url, json.loads(data)))
        labels = json.loads(data)['p_labels']
        return Response(200, 'non_member' if 'Aktive Mitglieder' in labels else 'active')

    monkeypatch.setattr(webling.requests, 'post', post)
    rule = webling.database_status_rule([
        {'id': 1001, 'labels': ['Aktiv']},
        {'id': 1002, 'labels': ['Aktiv']},
        {'id': 1003, 'labels': ['Aktive Mitglieder']},
    ])

    assert [url for url, _ in asked] == ['https://db.example/rest/v1/rpc/member_status_from_labels'] * 2
    assert asked[0][1] == {'p_labels': ['Aktiv'], 'p_link': 'active'}
    assert rule(['Aktiv']) == 'active'
    assert rule(['Aktive Mitglieder']) == 'non_member'


@pytest.mark.parametrize('answer', [
    Response(500, {'code': 'XX000', 'message': 'boom'}),
    Response(404, {'code': 'PGRST202', 'message': 'Could not find the function'}),
    Response(200, None),
])
def test_status_rule_that_fails_is_none(monkeypatch, capsys, answer):
    webling = load('webling', monkeypatch, ask_database=True)
    monkeypatch.setattr(webling.requests, 'post', lambda url, headers=None, data=None: answer)

    assert webling.database_status_rule([{'id': 1001, 'labels': ['Aktiv', '03_Austritt']}]) is None
    out = capsys.readouterr().out
    assert 'membership status rule' in out
    assert 'Austritt' not in out and '1001' not in out


def test_network_error_prints_no_url(monkeypatch, capsys):
    webling = load('webling', monkeypatch)

    def fail(url, **kwargs):
        raise webling.requests.ConnectionError(f'Max retries exceeded with url: {url}')

    monkeypatch.setattr(webling.requests, 'post', fail)
    assert webling.supabase('post', 'member_links?external_id=in.(1004)') is None
    out = capsys.readouterr().out
    assert 'ConnectionError' in out
    assert '1004' not in out
