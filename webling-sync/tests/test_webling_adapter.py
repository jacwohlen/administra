"""webling_adapter: record builders, dates, the calls and the run plan."""
from datetime import date
from types import SimpleNamespace

import pytest

from fake_world import World, participant, webling_member
from integration.clock import club_today
from integration.runner import FetchFailed, UsageError
from scenarios import events_world, members_world
from webling_adapter import WeblingAdapter, dates
from webling_adapter.api import WeblingApi
from webling_adapter.events import Calendar, event_record, participant_list
from webling_adapter.members import member_record

CAL = Calendar(501, 'Judo Agenda', [])


# dates ------------------------------------------------------------------

@pytest.mark.parametrize('value, expected', [
    ('2026-03-31 19:00:00', ('2026-03-31', '19:00', None)),
    ('2026-03-31', ('2026-03-31', '00:00', None)),
    ('1971-01-01 00:00:00', ('1971-01-01', '00:00', None)),
    ('1970-01-01 00:00:00', (None, None, 'no_date')),
    ('1900-05-05 10:00:00', (None, None, 'no_date')),
    (None, (None, None, 'no_date')),
    ('', (None, None, 'no_date')),
    ('31.03.2026', (None, None, 'invalid_date')),
    ('2026-13-45 10:00:00', (None, None, 'invalid_date')),
    (20260331, (None, None, 'invalid_date')),
])
def test_dates(value, expected):
    assert tuple(dates.split(value)) == expected


def test_club_today_is_a_date():
    # The fallback when integration_begin gave no 'today'
    assert isinstance(club_today(), date)


# members ----------------------------------------------------------------

TITLES = {10: 'Aktiv', 13: '04_Probetraining', 99: None}


def test_member_record():
    raw = webling_member(4711, ' Anna ', 'Muster ', [10, 13], birthday='2010-04-01',
                         mobile='0790000000', email=' anna@example.com ')
    assert member_record(raw, TITLES) == {'external_id': '4711', 'data': {
        'firstname': 'Anna', 'lastname': 'Muster', 'birthday': '2010-04-01', 'mobile': '0790000000',
        'email': 'anna@example.com',
        # raw titles: the layer's catalog renames 04_Probetraining
        'groups': [{'id': '10', 'name': 'Aktiv'}, {'id': '13', 'name': '04_Probetraining'}]}}


@pytest.mark.parametrize('email', [None, '', '   '])
def test_member_without_email_sends_null(email):
    # The layer only fills the e-mail: null keeps one entered in the app
    raw = webling_member(1, 'A', 'B', [], email=email)
    assert member_record(raw, TITLES)['data']['email'] is None


def test_member_values_as_sent():
    raw = webling_member(1, None, 'B', [], birthday=None, mobile='')
    data = member_record(raw, TITLES)['data']
    assert data['firstname'] == '' and data['birthday'] is None and data['mobile'] == ''


@pytest.mark.parametrize('missing', ['Vorname', 'Name', 'Geburtstag', 'Mobile'])
def test_missing_property_is_a_problem(missing):
    raw = webling_member(1, 'Anna', 'Muster', [10])
    del raw['properties'][missing]
    # Seen (never gone), not written, and no personal data staged
    assert member_record(raw, TITLES) == {'external_id': '1', 'data': {'problem': 'missing_field'}}


def test_group_that_could_not_be_read_is_a_problem():
    raw = webling_member(1, 'Anna', 'Muster', [10, 99])
    assert member_record(raw, TITLES) == {'external_id': '1', 'data': {'problem': 'fetch_failed'}}


@pytest.fixture
def world(monkeypatch):
    return World().install(monkeypatch)


def run_info(today='2026-10-28', scope=None, settings=None):
    return SimpleNamespace(today=today, scope=scope or {'from': '2026-01-01'},
                           settings=settings or {'participant_state_property': '594'})


def test_member_records_fetch_each_group_once(world, monkeypatch):
    _, _, members_fake, _ = members_world()
    world.members, world.groups, world.failing = members_fake.members, members_fake.groups, {'membergroup/99'}
    adapter = WeblingAdapter('club', 'key')
    plan = adapter.plan('members')
    assert plan.scope == {'complete': True}
    records = adapter.records(plan, run_info())
    assert [r['external_id'] for r in records] == ['1001', '1002', '1003', '1004', '1005', '1006', '1007']
    group_calls = [c['url'] for c in world.calls if '/membergroup/' in c['url']]
    assert len(group_calls) == len(set(group_calls)) == 7
    assert adapter.errors == 1
    assert adapter.counters == {'members': 7, 'groups': 6, 'groups_failed': 1, 'missing_field': 1}


def test_member_list_failure_fails_the_fetch(world):
    world.failing = {'/api/1/member'}
    adapter = WeblingAdapter('club', 'key')
    with pytest.raises(FetchFailed) as raised:
        adapter.records(adapter.plan('members'), run_info())
    assert str(raised.value) == 'Webling GET /api/1/member failed: HTTP 500'


# events -----------------------------------------------------------------

def props(begin='2026-11-05 18:00:00', end='2026-11-05 20:00:00', **extra):
    return {'title': ' Kyu Prüfung ', 'begin': begin, 'end': end, 'place': ' Dojo ',
            'maxParticipants': '12', **extra}


def test_event_record():
    link = 'https://club.webling.ch/portal#/calendar/event/7001'
    assert event_record(7001, props(), CAL, 'club', [{'member': '1001', 'state': 'confirmed'}]) == {
        'external_id': '7001', 'data': {
            'calendar': {'id': '501', 'name': 'Judo Agenda'}, 'title': 'Kyu Prüfung',
            'starts_on': '2026-11-05', 'ends_on': None, 'all_day': False, 'time_from': '18:00',
            'time_to': '20:00', 'location': 'Dojo', 'max_participants': 12, 'url': link,
            'participants': [{'member': '1001', 'state': 'confirmed'}]}}


def test_event_record_defaults():
    data = event_record(7, {'title': '  ', 'begin': '2026-11-05 18:00:00', 'end': None,
                            'place': '  '}, CAL, 'club')['data']
    assert data['title'] == 'Untitled Event'
    assert (data['ends_on'], data['all_day'], data['time_from'], data['time_to']) == (
        None, False, '18:00', None)
    assert data['location'] is None and data['max_participants'] is None
    # Not read (or a past event): the key is left out, registrations stay
    assert 'participants' not in data


# end dates and all day (phase 4) ---------------------------------------

def span_of(begin, end, **extra):
    return tuple(dates.span(extra, dates.split(begin), dates.split(end)))


@pytest.mark.parametrize('begin, end, extra, expected', [
    # A timed event, on one day and over several
    ('2026-11-05 18:00:00', '2026-11-05 20:00:00', {}, (None, False)),
    ('2026-11-13 18:00:00', '2026-11-15 14:00:00', {}, ('2026-11-15', False)),
    # Over midnight: it ends the next day
    ('2026-12-31 20:00:00', '2027-01-01 01:00:00', {}, ('2027-01-01', False)),
    # Until midnight: its last day is the day before the end
    ('2026-11-06 19:00:00', '2026-11-07 00:00:00', {}, (None, False)),
    ('2026-11-06 19:00:00', '2026-11-08 00:00:00', {}, ('2026-11-07', False)),
    ('2026-11-06 19:00:00', '2026-11-08', {}, ('2026-11-07', False)),
    # All day as Webling keeps it: 00:00 to 00:00 of the day after the last day
    ('2026-04-03 00:00:00', '2026-04-04 00:00:00', {}, (None, True)),
    ('2026-09-26 00:00:00', '2026-10-12 00:00:00', {}, ('2026-10-11', True)),
    ('2026-12-25 00:00:00', '2026-12-25 00:00:00', {}, (None, True)),
    ('2026-12-25', '2026-12-26', {}, (None, True)),
    # Without an end, or an end that cannot be read or lies before the start: one day
    ('2026-12-25 00:00:00', None, {}, (None, True)),
    ('2026-11-05 18:00:00', 'morgen', {}, (None, False)),
    ('2026-11-05 18:00:00', '2026-11-04 20:00:00', {}, (None, False)),
    # Webling's own flag wins over the times (timed: until midnight, as above)
    ('2026-10-03 00:00:00', '2026-10-18 00:00:00', {'isAllDay': False}, ('2026-10-17', False)),
    ('2026-10-03 08:00:00', '2026-10-04 12:00:00', {'isAllDay': True}, ('2026-10-04', True)),
    ('2026-04-03 00:00:00', '2026-04-04 00:00:00', {'isAllDay': True}, (None, True)),
    ('2026-11-06 19:00:00', '2026-11-07 00:00:00', {'isAllDay': True}, (None, True)),
    ('2026-10-03 08:00:00', '2026-10-04 12:00:00', {'isAllDay': 'ja'}, ('2026-10-04', False)),
])
def test_span(begin, end, extra, expected):
    assert span_of(begin, end, **extra) == expected


def test_event_record_with_end_dates():
    link = 'https://club.webling.ch/portal#/calendar/event/7001'
    holiday = event_record(7001, props(begin='2026-10-03 00:00:00', end='2026-10-18 00:00:00'),
                           CAL, 'club')['data']
    assert holiday == {
        'calendar': {'id': '501', 'name': 'Judo Agenda'}, 'title': 'Kyu Prüfung',
        'starts_on': '2026-10-03', 'ends_on': '2026-10-17', 'all_day': True,
        'time_from': None, 'time_to': None, 'location': 'Dojo', 'max_participants': 12, 'url': link}
    timed = event_record(7001, props(), CAL, 'club')['data']
    assert (timed['ends_on'], timed['all_day'], timed['time_from'], timed['time_to']) == (
        None, False, '18:00', '20:00')
    # The portal link is the link's url; the description is the app's
    assert 'description' not in timed and timed['url'] == link


def test_a_multi_day_event_counts_until_its_end(world):
    world.calendars = {1: {'title': 'Club', 'events': [11, 12]}}
    # Begun before the window, ends inside it; under way today
    world.events = {11: props(begin='2025-12-30 00:00:00', end='2026-01-02 00:00:00'),
                    12: props(begin='2026-10-26 09:00:00', end='2026-10-30 17:00:00')}
    world.participants = {12: [participant(1, [1001])]}
    adapter = WeblingAdapter('club', 'key', 'sync@example.com', 'pw')
    records = {r['external_id']: r['data'] for r in adapter.records(adapter.plan('events'), run_info())}
    assert records['11']['ends_on'] == '2026-01-01'
    assert records['12']['participants'] == [{'member': '1001', 'state': 'confirmed'}]


@pytest.mark.parametrize('value, sent', [(12, 12), ('12', 12), (None, None), ('zwölf', 'zwölf')])
def test_event_limit(value, sent):
    assert event_record(7, props(maxParticipants=value), CAL, 'club')['data']['max_participants'] == sent


@pytest.mark.parametrize('begin, problem', [
    ('1970-01-01 00:00:00', 'no_date'), (None, 'no_date'), ('morgen', 'invalid_date')])
def test_event_without_a_date_is_a_problem(begin, problem):
    assert event_record(7, props(begin=begin), CAL, 'club') == {
        'external_id': '7', 'data': {'calendar': {'id': '501', 'name': 'Judo Agenda'}, 'problem': problem}}


def test_participant_list():
    objects = [participant(1, [1001]), participant(2, 1002, 'declined'), participant(3, '1003'),
               participant(4, []), participant(5, None), {'id': 6, 'properties': {}, 'links': {'member': [7]}}]
    assert participant_list(objects, '594') == [
        {'member': '1001', 'state': 'confirmed'}, {'member': '1002', 'state': 'declined'},
        {'member': '1003', 'state': 'confirmed'}, {'member': '7', 'state': ''}]


def events_fixture(world):
    _, _, fake, _ = events_world()
    world.calendars, world.events, world.participants = fake.calendars, fake.events, fake.participants
    return WeblingAdapter('club', 'key', 'sync@example.com', 'pw')


def test_event_plan_scope_is_the_calendars_read(world):
    adapter = events_fixture(world)
    world.failing = {'calendar/502'}
    plan = adapter.plan('events')
    # 502 could not be read: not in the scope, but Webling still has it
    assert plan.scope == {'complete': True, 'calendars': ['501'], 'provider_calendars': ['501', '502']}
    assert adapter.errors == 1


def test_event_plan_with_a_selection(world):
    adapter = events_fixture(world)
    adapter.selectors = ['aikido']
    # Every calendar Webling has, whatever the selection
    assert adapter.plan('events').scope == {'complete': True, 'calendars': ['502'],
                                            'provider_calendars': ['501', '502']}
    adapter.selectors = ['501', 'aikido']
    assert adapter.plan('events').scope['calendars'] == ['501', '502']
    adapter.selectors = ['999']
    with pytest.raises(UsageError):
        adapter.plan('events')


def test_event_plan_without_calendars_fails(world):
    adapter = events_fixture(world)
    world.calendars = {}
    with pytest.raises(FetchFailed):
        adapter.plan('events')
    world.failing = {'/api/1/calendar'}
    with pytest.raises(FetchFailed):
        adapter.plan('events')


def test_event_records(world):
    adapter = events_fixture(world)
    plan = adapter.plan('events')
    records = {r['external_id']: r['data'] for r in adapter.records(plan, run_info())}
    # 7004 is from last year (before the window): not sent, counted
    assert sorted(records) == ['7001', '7002', '7003', '7005', '7006', '7101', '7102']
    assert records['7005'] == {'calendar': {'id': '501', 'name': 'Kalender Geheim Judo'},
                               'problem': 'fetch_failed'}
    assert records['7006']['problem'] == 'no_date' and records['7101']['problem'] == 'no_date'
    # Participants from today on only, [] for nobody; past events leave them out
    assert records['7001']['participants'] == [
        {'member': '1001', 'state': 'confirmed'}, {'member': '1002', 'state': 'declined'},
        {'member': '1003', 'state': 'confirmed'}]
    assert records['7002']['participants'] == [{'member': '1006', 'state': 'confirmed'}]
    assert records['7102']['participants'] == []
    assert 'participants' not in records['7003']
    assert adapter.errors == 1
    assert adapter.counters == {
        'calendars': 2, 'calendars_read': 2, 'events': 8, 'fetch_failed': 1, 'no_date': 2,
        'invalid_date': 0, 'before_window': 1, 'participant_lists': 3,
        'participant_lists_failed': 0, 'list_calls': 0}


def test_the_window_and_today_come_from_the_database(world):
    adapter = events_fixture(world)
    plan = adapter.plan('events')
    records = adapter.records(plan, run_info(today='2026-11-06', scope={'from': '2026-11-01'}))
    by_id = {r['external_id']: r['data'] for r in records}
    assert '7003' not in by_id  # before the window
    assert 'participants' not in by_id['7001']  # over by that day
    assert by_id['7102']['participants'] == []


def test_failed_participant_list_leaves_the_registrations(world):
    adapter = events_fixture(world)
    world.failing = {'query/participant'}
    records = {r['external_id']: r['data'] for r in adapter.records(adapter.plan('events'), run_info())}
    assert 'participants' not in records['7001'] and 'participants' not in records['7102']
    assert adapter.counters['participant_lists_failed'] == 3
    assert adapter.errors == 1 + 3


def test_failed_login_reads_no_participants(world):
    adapter = events_fixture(world)
    world.login_status = 401
    records = adapter.records(adapter.plan('events'), run_info())
    assert all('participants' not in r['data'] for r in records)
    assert adapter.counters['login_failed'] == 1
    logins = [c for c in world.calls if c['url'].endswith('/api/client/session')]
    assert len(logins) == 1


def test_state_property_from_the_settings(world):
    adapter = events_fixture(world)
    world.participants[7001] = [{'id': 1, 'properties': {'777': 'confirmed'}, 'links': {'member': [5]}}]
    records = adapter.records(adapter.plan('events'),
                              run_info(settings={'participant_state_property': '777'}))
    assert records[0]['data']['participants'] == [{'member': '5', 'state': 'confirmed'}]


def test_one_list_call_per_calendar_when_webling_answers_it(world):
    adapter = events_fixture(world)
    world.event_list_call = True
    world.events[7005] = props()
    # A full object has every property (an unset one as null)
    world.events[7006] = {'title': 'Ohne Datum', 'begin': None}
    records = adapter.records(adapter.plan('events'), run_info())
    singles = [c for c in world.calls if '/api/1/calendarevent/' in c['url']]
    lists = [c for c in world.calls if c['url'].endswith('/api/1/calendarevent')]
    assert singles == [] and len(lists) == 2
    assert lists[0]['params'] == {'apikey': '<key>', 'format': 'full', 'filter': '$parents.$id=501'}
    assert adapter.counters['list_calls'] == 2
    assert {r['external_id'] for r in records} == {'7001', '7002', '7003', '7005', '7006', '7101', '7102'}


def test_list_call_is_not_taken_when_it_answers_other_events(world, monkeypatch):
    api = WeblingApi('club', 'key')
    world.calendars = {1: {'title': 'A', 'events': [11, 12]}}
    world.events = {11: props(), 12: props()}
    world.event_list_call = True
    # Webling answers the list without event 12: one call per event instead
    monkeypatch.setattr(api, 'get', wrap_list(api.get, lambda body: body[:1]))
    events, failed, how = api.calendar_events(1, [11, 12])
    assert how == 'single calls' and set(events) == {11, 12} and failed == []
    # ... or with an object that has no begin
    monkeypatch.setattr(api, 'get', wrap_list(WeblingApi.get.__get__(api), lambda body: [
        {**body[0], 'properties': {'title': 'x'}}, body[1]]))
    assert api.calendar_events(1, [11, 12])[2] == 'single calls'


def wrap_list(get, change):
    def patched(path, **params):
        body = get(path, **params)
        return change(body) if path == 'calendarevent' else body
    return patched


def test_list_call_can_be_switched_off(world):
    world.calendars = {1: {'title': 'A', 'events': [11]}}
    world.events = {11: props()}
    world.event_list_call = True
    api = WeblingApi('club', 'key', list_call=False)
    assert api.calendar_events(1, [11])[2] == 'single calls'
    assert not any(c['url'].endswith('/api/1/calendarevent') for c in world.calls)


def test_single_participant_object(world):
    # Webling answers one object (not a list, no id) when one id is asked for
    world.participants = {7: [participant(9005, [1006])]}
    api = WeblingApi('club', 'key', 'a@b.c', 'pw')
    assert api.login()
    assert api.participants(7) == [{'properties': {'594': 'confirmed', 'Bemerkung': 'secret note'},
                                    'links': {'member': [1006]}, 'id': 9005}]


def test_webling_errors_never_hold_the_url(world):
    world.network_errors = {'/api/1/member'}
    api = WeblingApi('club', 'webling-key-123')
    with pytest.raises(Exception) as raised:
        api.members()
    assert str(raised.value) == 'Webling GET /api/1/member failed: ConnectionError'
    assert raised.value.__suppress_context__
