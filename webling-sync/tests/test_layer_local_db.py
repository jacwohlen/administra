"""The layer path against a real database with the integration layer.

Skipped unless LAYER_TEST_PSQL names a psql command for a FRESH local
database with every migration (including 20261029120000_integration_layer)
and the seed; the tests change it and expect to run once, in file order:

    LAYER_TEST_PSQL='psql postgresql://postgres:postgres@127.0.0.1:54322/postgres' \\
        pytest tests/test_layer_local_db.py

sync.py runs in layer mode with a fake Webling built from the database's
own Webling members (what the legacy sync wrote), and the client calls the
SQL functions through psql as service_role (tests/psql_transport.py)
instead of PostgREST. LAYER_TEST_PSQL_NO_LAYER (optional) names a database
without the layer, for the fallback.
"""
import json
import os

import pytest

import sync
from fake_world import World, participant, set_env
from integration.client import Client
from integration.layer import LAYER_MISSING, Layer
from psql_transport import PsqlTransport
from sync_rules import WEBLING_NOTE

pytestmark = pytest.mark.skipif(not os.environ.get('LAYER_TEST_PSQL'),
                                reason='LAYER_TEST_PSQL is not set (no local database)')

# The legacy sync renamed this Webling group (transform_label)
WEBLING_TITLE = {'Probetraining': '04_Probetraining'}

STATE = {}


@pytest.fixture(scope='module')
def db():
    transport = PsqlTransport(os.environ['LAYER_TEST_PSQL'])
    runs = transport.query('SELECT count(*) FROM public.integration_runs')
    assert runs == ['0'], 'needs a fresh database (build it again)'
    return transport


def value(db, sql):
    rows = db.query(sql)
    return rows[0] if rows else None


def snapshot(db):
    """The live Webling members as the database has them."""
    rows = db.query("""
        SELECT coalesce(json_agg(json_build_object(
                 'id', l.external_id::int, 'firstname', m.firstname, 'lastname', m.lastname,
                 'birthday', m.birthday, 'mobile', m.mobile, 'email', m.email,
                 'labels', coalesce(m.labels, '[]'::jsonb)) ORDER BY l.external_id::int), '[]')
          FROM public.member_links l JOIN public.members m ON m.id = l.member_id
         WHERE l.connection = 'webling' AND l.gone_at IS NULL""")
    return json.loads(rows[0])


def webling_from(members):
    titles = sorted({WEBLING_TITLE.get(label, label) for m in members for label in m['labels']})
    group_ids = {title: 500 + i for i, title in enumerate(titles)}
    world = World()
    world.groups = {i: title for title, i in group_ids.items()}
    world.members = [{'id': m['id'],
                      'parents': [group_ids[WEBLING_TITLE.get(label, label)] for label in m['labels']],
                      'properties': {'Vorname': m['firstname'], 'Name': m['lastname'],
                                     'Geburtstag': m['birthday'], 'Mobile': m['mobile'],
                                     'E-Mail': m['email']}}
                     for m in members]
    return world


def rows_version(db, table):
    """Changes whenever a row of the table is written (xmin) or removed."""
    return value(db, f"SELECT md5(string_agg(id::text || ':' || xmin::text, ',' ORDER BY id)) FROM public.{table}")


def has_end_dates(db):
    """The database has phase 4 (20261030120000: all_day, capabilities version 2)."""
    return value(db, "SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' "
                     "AND table_name = 'events' AND column_name = 'all_day'") == '1'


def events_but_description(db):
    """The events' values, but the description (and updatedAt)."""
    return value(db, """SELECT md5(string_agg(concat_ws('|', id, title, date, date_to, "timeFrom", "timeTo",
                                                        location, section, "maxParticipants",
                                                        "registrationDeadline"), ',' ORDER BY id))
                          FROM public.events""")


def sync_run(db, monkeypatch, world, kind, dry_run=False, **env):
    set_env(monkeypatch, INTEGRATION_MODE='layer', INTEGRATION_RUNNER='local:test',
            INTEGRATION_DRY_RUN='true' if dry_run else None, **env)
    world.install(monkeypatch)
    monkeypatch.setattr(sync, 'make_layer', lambda: Layer(Client('https://local.invalid', 'sb_secret_local', db)))
    legacy = []
    status = sync.main([kind], legacy=lambda command: legacy.append(command) or 0)
    assert legacy == [], 'the layer is here: no fallback'
    run = json.loads(value(db, "SELECT row_to_json(r)::text FROM public.integration_runs r ORDER BY id DESC LIMIT 1"))
    return status, run


def test_members_first_dry_run_is_a_no_op(db, monkeypatch, capsys):
    members = snapshot(db)
    STATE['members'] = members
    assert len(members) > 100
    before = rows_version(db, 'members')
    status, run = sync_run(db, monkeypatch, webling_from(members), 'members', dry_run=True)
    out = capsys.readouterr().out
    assert status == 0, out
    assert run['dry_run'] and run['status'] == 'ok' and run['runner'] == 'local:test'
    result = run['result']
    assert result['received'] == len(members)
    assert (result['inserted'], result['adopted'], result['updated'], result['gone'], result['former'],
            result['statuses_recomputed']) == (0, 0, 0, 0, 0, 0)
    assert result['unchanged'] == len(members)
    assert rows_version(db, 'members') == before
    assert value(db, 'SELECT count(*) FROM public.integration_records') == '0'
    for member in members[:50]:
        assert member['lastname'] not in out


def test_members_first_real_run_rewrites_nothing(db, monkeypatch, capsys):
    members = STATE['members']
    before = rows_version(db, 'members')
    status, run = sync_run(db, monkeypatch, webling_from(members), 'members')
    assert status == 0, capsys.readouterr().out
    assert not run['dry_run'] and run['status'] == 'ok' and run['trigger'] == 'manual'
    assert run['result']['unchanged'] == len(members) and run['result']['updated'] == 0
    assert rows_version(db, 'members') == before
    # Seeded groups are bound to the (fake) Webling ids now
    assert value(db, "SELECT count(*) FROM public.integration_member_groups "
                     "WHERE name = '04_Probetraining' AND external_id IS NOT NULL") == '1'
    assert run['adapter']['counters']['members'] == len(members)


def test_members_rename_and_gone(db, monkeypatch, capsys):
    members = [dict(m) for m in STATE['members']]
    renamed, gone = members[0], members[1]
    renamed['lastname'] = 'Umbenannt'
    members = [m for m in members if m is not gone]
    status, run = sync_run(db, monkeypatch, webling_from(members), 'members')
    assert status == 0, capsys.readouterr().out
    assert (run['result']['updated'], run['result']['gone']) == (1, 1)
    assert value(db, f"SELECT lastname FROM public.members WHERE id = {renamed['id']}") == 'Umbenannt'
    assert value(db, f"SELECT membership_status FROM public.members WHERE id = {gone['id']}") == 'left'
    STATE['members'] = members


def test_members_mass_gone_is_refused_then_accepted(db, monkeypatch, capsys):
    members = STATE['members']
    kept = members[60:]
    before = rows_version(db, 'members')
    status, run = sync_run(db, monkeypatch, webling_from(kept), 'members')
    out = capsys.readouterr().out
    assert status == 1
    assert run['status'] == 'refused' and run['guard']['refused'] == 'members_gone'
    assert 'run the workflow by hand with accept_gone=60' in out
    assert rows_version(db, 'members') == before

    status, run = sync_run(db, monkeypatch, webling_from(kept), 'members', WEBLING_ACCEPT_GONE='60')
    assert status == 0, capsys.readouterr().out
    assert run['accepted'] == {'gone': 60} and run['result']['gone'] == 60
    STATE['members'] = kept


EVENTS = [
    # id, calendar, title, begin, end, place, limit
    (61001, 501, 'Kyu Prüfung', '2026-11-20 18:00:00', '2026-11-20 20:00:00', 'Dojo', 12),
    (61002, 501, 'Randori', '2026-12-04 19:00:00', '2026-12-04 21:00:00', None, None),
    (61003, 501, 'Sommerfest', '2026-03-01 10:00:00', '2026-03-01 16:00:00', 'Halle', None),
    (61004, 502, 'Lehrgang', '2026-11-28 09:00:00', '2026-11-28 16:00:00', 'Dojo', 20),
    (61005, 502, 'Seminar', '2026-12-12 09:00:00', '2026-12-12 12:00:00', None, None),
]
SECTION = {501: 'Judo', 502: 'Aikido'}


def link(event_id):
    return f'https://club.webling.ch/portal#/calendar/event/{event_id}'


def events_world(confirmed):
    world = World()
    world.calendars = {501: {'title': 'Judo Agenda', 'events': [e[0] for e in EVENTS if e[1] == 501]},
                       502: {'title': 'Aikido Agenda', 'events': [e[0] for e in EVENTS if e[1] == 502] + [61099]}}
    world.events = {e[0]: {'title': f' {e[2]} ', 'begin': e[3], 'end': e[4], 'place': e[5],
                           'maxParticipants': e[6]} for e in EVENTS}
    world.events[61099] = {'title': 'Serie', 'begin': '1970-01-01 00:00:00', 'end': None}
    world.participants = {61001: [participant(9100 + i, [m], state) for i, (m, state) in enumerate(confirmed)],
                          61002: [], 61004: [], 61005: []}
    return world


def test_events_first_run_adopts_the_legacy_events(db, monkeypatch, capsys):
    members = [m['id'] for m in STATE['members'][:3]]
    STATE['participants'] = members
    # What the legacy sync wrote: the events, and two registrations of 61001
    values = ', '.join(
        f"({e[0]}, '{e[2]}', '{link(e[0])}', '{e[3][:10]}', '{e[3][11:16]}', '{e[4][11:16]}', "
        f"{repr(e[5]) if e[5] else 'NULL'}, '{SECTION[e[1]]}', {e[6] or 'NULL'})" for e in EVENTS)
    db.query(f"""INSERT INTO public.events (id, title, description, date, "timeFrom", "timeTo", location,
                                           section, "maxParticipants") VALUES {values}""")
    db.query(f"""INSERT INTO public.event_participants ("eventId", "memberId", "attendanceStatus", notes)
                 VALUES (61001, {members[0]}, 'registered', '{WEBLING_NOTE}'),
                        (61001, {members[1]}, 'registered', '{WEBLING_NOTE}'),
                        (61001, {members[2]}, 'registered', NULL)""")
    before = rows_version(db, 'events')
    before_values = events_but_description(db)
    world = events_world([(members[0], 'confirmed'), (members[1], 'confirmed')])
    status, run = sync_run(db, monkeypatch, world, 'events', dry_run=True)
    assert status == 0, capsys.readouterr().out
    assert run['dry_run'] and run['result']['adopted'] == 5

    status, run = sync_run(db, monkeypatch, events_world([(members[0], 'confirmed'), (members[1], 'confirmed')]),
                           'events')
    out = capsys.readouterr().out
    assert status == 0, out
    assert not run['dry_run']
    result = run['result']
    assert (result['adopted'], result['updated'], result['inserted'], result['gone']) == (5, 0, 0, 0)
    assert (result['registrations_adopted'], result['registrations_added'],
            result['registrations_removed']) == (2, 0, 0)
    assert result['invalid'] == 1  # the epoch event: info, the run stays ok
    assert run['scope']['calendars'] == ['501', '502'] and run['scope']['complete']
    if has_end_dates(db):
        # Phase 4: the portal link leaves the description (the link's url has it), nothing else changes
        assert events_but_description(db) == before_values
        assert value(db, "SELECT count(*) FROM public.events WHERE id BETWEEN 61001 AND 61005 "
                         "AND description IS NOT NULL") == '0'
    else:
        assert rows_version(db, 'events') == before
    assert value(db, "SELECT count(*) FROM public.event_links WHERE gone_at IS NULL") == '5'
    assert value(db, "SELECT count(*) FROM public.integration_issues WHERE code = 'invalid_event' "
                     "AND detail = 'no_date'") == '1'
    assert 'Kyu Prüfung' not in out and 'Judo Agenda' not in out


def test_events_second_run_is_unchanged_and_follows_webling(db, monkeypatch, capsys):
    members = STATE['participants']
    # The second member declined in Webling: the provider's row goes, the
    # app's row (third member) stays
    world = events_world([(members[0], 'confirmed'), (members[1], 'declined')])
    status, run = sync_run(db, monkeypatch, world, 'events')
    assert status == 0, capsys.readouterr().out
    assert (run['result']['unchanged'], run['result']['registrations_removed']) == (5, 1)
    assert value(db, 'SELECT string_agg("memberId"::text, \',\' ORDER BY "memberId") '
                     'FROM public.event_participants WHERE "eventId" = 61001') == \
        ','.join(str(m) for m in sorted([members[0], members[2]]))


def has_calendars_gone(db):
    """The database settles calendars the provider no longer has (20261101120000, capabilities 3)."""
    return value(db, "SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' "
                     "AND table_name = 'integration_calendars' AND column_name = 'gone_at'") == '1'


def holidays_world(members):
    """events_world with a holiday calendar (503) and a camp in 501."""
    world = events_world([(members[0], 'confirmed'), (members[1], 'declined')])
    world.calendars[503] = {'title': 'Ferien und Feiertage', 'events': [61201]}
    world.events[61201] = {'title': 'Weihnachten', 'begin': '2026-12-24 00:00:00', 'end': '2026-12-27 00:00:00',
                           'place': None, 'maxParticipants': None}
    world.calendars[501]['events'].append(61202)
    world.events[61202] = {'title': 'Lager', 'begin': '2026-11-13 18:00:00', 'end': '2026-11-15 14:00:00',
                           'place': None, 'maxParticipants': None}
    world.participants.update({61201: [], 61202: []})
    return world


def test_holidays_and_end_dates_from_version_2(db, monkeypatch, capsys):
    if not has_end_dates(db):
        pytest.skip('the database has no end dates yet (20261030120000)')
    members = STATE['participants']
    # A holiday the legacy sync wrote as an event before the switch
    db.query(f"""INSERT INTO public.events (id, title, description, date, "timeFrom", "timeTo", section)
                 VALUES (61201, 'Weihnachten', '{link(61201)}', '2026-12-24', '00:00', '00:00', 'General')""")
    status, run = sync_run(db, monkeypatch, holidays_world(members), 'events')
    assert status == 0, capsys.readouterr().out
    result = run['result']
    assert (result['inserted'], result['unchanged'], result['breaks_inserted'],
            result['holiday_events_deleted'], result['gone']) == (1, 5, 1, 1, 0)
    # The holiday is the training plan's now (3 days: the dojo is closed), its event is gone
    assert value(db, "SELECT concat_ws('|', title, date_from, date_to, cancels_training::text) "
                     "FROM public.training_plan_breaks WHERE external_id = '61201'") == \
        'Weihnachten|2026-12-24|2026-12-26|true'
    assert value(db, "SELECT count(*) FROM public.events WHERE id = 61201") == '0'
    # The camp ends on its last day, with its times
    assert value(db, """SELECT concat_ws('|', date, date_to, all_day::text, "timeFrom", "timeTo", description)
                          FROM public.events WHERE id = 61202""") == '2026-11-13|2026-11-15|false|18:00|14:00'


def test_a_calendar_webling_no_longer_has(db, monkeypatch, capsys):
    if not has_calendars_gone(db):
        pytest.skip('the database does not settle gone calendars yet (20261101120000)')
    members = STATE['participants']
    # Aikido Agenda (502) is deleted in Webling, with its two events and the
    # one without a date (an open issue); the other calendars stay as they are
    world = holidays_world(members)
    del world.calendars[502]
    status, run = sync_run(db, monkeypatch, world, 'events')
    out = capsys.readouterr().out
    assert status == 0, out
    assert run['scope']['calendars'] == ['501', '502', '503'] and run['scope']['calendars_gone'] == ['502']
    assert 'Calendars the provider no longer has (settled as read, without events): 502' in out
    result = run['result']
    assert (result['gone'], result['deleted'], result['unchanged'], result['breaks_deleted']) == (2, 2, 4, 0)
    assert value(db, "SELECT count(*) FROM public.events WHERE id IN (61004, 61005)") == '0'
    assert value(db, "SELECT (resolved_at IS NOT NULL)::text FROM public.integration_issues "
                     "WHERE code = 'invalid_event' AND external_id = '61099'") == 'true'
    assert value(db, "SELECT (gone_at IS NOT NULL)::text FROM public.integration_calendars "
                     "WHERE connection = 'webling' AND external_id = '502'") == 'true'

    # The next run: nothing left to settle, the calendar stays marked
    status, run = sync_run(db, monkeypatch, world, 'events')
    assert status == 0, capsys.readouterr().out
    assert (run['result']['gone'], run['result']['unchanged']) == (0, 4)
    assert value(db, "SELECT count(*) FROM public.integration_calendars "
                     "WHERE connection = 'webling' AND gone_at IS NOT NULL") == '1'


def test_a_database_without_the_layer_falls_back(monkeypatch, capsys):
    command = os.environ.get('LAYER_TEST_PSQL_NO_LAYER')
    if not command:
        pytest.skip('LAYER_TEST_PSQL_NO_LAYER is not set')
    transport = PsqlTransport(command)
    layer = Layer(Client('https://local.invalid', 'sb_secret_local', transport))
    assert layer.begin('webling', 'members', {'complete': True}) is LAYER_MISSING
    set_env(monkeypatch, INTEGRATION_MODE='layer')
    World().install(monkeypatch)
    monkeypatch.setattr(sync, 'make_layer', lambda: layer)
    legacy = []
    assert sync.main(['members'], legacy=lambda command: legacy.append(command) or 0) == 0
    assert len(legacy) == 1
    assert '::warning::The integration layer is not on this database yet' in capsys.readouterr().out
