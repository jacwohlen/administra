"""Scenarios for the legacy scripts (webling.py, events.py), shared by the
golden test and the log-privacy test. Each returns (script, args, World,
extra environment). The Webling data carries names, titles, group names,
notes and e-mails the public log must never show (SECRETS)."""
from fake_world import Response, World, participant, status_rows, webling_member
from sync_rules import WEBLING_NOTE, status_from_labels

# Strings that must never reach stdout or stderr (see test_log_privacy.py)
SECRETS = [
    'Zora', 'Geheimname', 'Xaver', 'Verborgen', 'Yvonne', 'Privat', 'Quirin', 'Diskret',
    'zora@example.com', '079 000 00 00', 'secret note',
    '03_Austritt', '04_Probetraining', 'Aktiv', 'Passiv', 'Vorstand Geheim', 'Rechnung Geheim',
    'Kyu Prüfung Max Geheim', 'Geburtstag von Zora', 'Lehrgang Diskret', 'Dojo Geheimweg',
    'Kalender Geheim', 'Aikido Verborgen',
    'webling-key-123', 'pw-456', 'sb_secret_test',
]

GROUPS = {10: 'Aktiv', 11: 'Passiv', 12: '03_Austritt', 13: '04_Probetraining',
          14: 'Vorstand Geheim', 15: '02_Rechnung Geheim'}


def status_rule(body):
    return Response(200, status_from_labels(body['p_labels'], body['p_link']))


def members_world():
    world = World()
    world.groups = dict(GROUPS)
    world.members = [
        webling_member(1001, ' Zora ', 'Geheimname ', [10, 14], email=' zora@example.com '),
        webling_member(1002, 'Xaver', 'Verborgen', [11]),
        {'id': 1003, 'parents': [10], 'properties': {'Vorname': 'Yvonne', 'Geburtstag': None,
                                                     'Mobile': None}},
        webling_member(1004, 'Quirin', 'Diskret', [99]),
        webling_member(1005, 'Yvonne', '  ', [10]),
        webling_member(1006, 'Xaver', 'Privat', [12, 15], birthday=None, mobile=None),
        webling_member(1007, 'Zora', 'Privat', [13], email=''),
    ]
    world.failing = {'membergroup/99'}
    world.rpc['member_status_from_labels'] = status_rule
    world.tables['members'] = status_rows([
        (1001, 'active', ['Aktiv']), (1002, 'passive', ['Passiv']), (1006, 'active', ['Aktiv']),
        (1008, 'active', ['Aktiv']), (1010, 'non_member', []),
    ])
    world.tables['member_links'] = [
        {'external_id': str(i), 'member_id': i, 'gone_at': None} for i in (1001, 1002, 1003, 1008)
    ] + [{'external_id': '1009', 'member_id': 1009, 'gone_at': '2026-01-01T00:00:00+00:00'}]
    return 'webling.py', [], world, {}


def members_anonymized_world():
    _, _, world, _ = members_world()
    world.members = world.members[:2]
    return 'webling.py', [], world, {'ANONYMIZE': 'true'}


def members_mass_drop_world():
    world = World()
    world.groups = {20: 'Aktive Mitglieder'}
    world.members = [webling_member(i, 'Zora', 'Geheimname', [20]) for i in range(1001, 1009)]
    world.rpc['member_status_from_labels'] = status_rule
    world.tables['members'] = status_rows([(i, 'active', ['Aktiv']) for i in range(1001, 1009)])
    world.tables['member_links'] = []
    return 'webling.py', [], world, {}


def members_accept_gone_world():
    world = World()
    world.groups = {10: 'Aktiv'}
    world.members = [webling_member(1001, 'Zora', 'Geheimname', [10])]
    world.rpc['member_status_from_labels'] = status_rule
    world.tables['members'] = status_rows([(i, 'active', ['Aktiv']) for i in range(1001, 1011)])
    world.tables['member_links'] = [
        {'external_id': str(i), 'member_id': i, 'gone_at': None} for i in range(1001, 1011)]
    return 'webling.py', [], world, {'WEBLING_ACCEPT_GONE': '9', 'WEBLING_ACCEPT_STATUS_DROP': '9'}


def event(title, begin, end=None, place=None, limit=None):
    props = {'title': title, 'begin': begin, 'end': end, 'place': place}
    if limit is not None:
        props['maxParticipants'] = limit
    return props


def events_world():
    world = World()
    world.calendars = {
        501: {'title': 'Kalender Geheim Judo', 'events': [7001, 7002, 7003, 7004, 7005, 7006]},
        502: {'title': 'Aikido Verborgen', 'events': [7101, 7102]},
    }
    world.events = {
        7001: event(' Kyu Prüfung Max Geheim ', '2026-11-05 18:00:00', '2026-11-05 20:00:00',
                    ' Dojo Geheimweg ', '12'),
        7002: event('Geburtstag von Zora', '2026-10-28 00:00:00', '2026-10-28 00:00:00'),
        7003: event('Geburtstag von Zora', '2026-03-01 10:00:00', '2026-03-01 12:00:00'),
        7004: event('Geburtstag von Zora', '2025-12-01 10:00:00', '2025-12-01 12:00:00'),
        7006: {'title': 'Geburtstag von Zora'},
        7101: event('Lehrgang Diskret', '1970-01-01 00:00:00', '1970-01-01 00:00:00'),
        7102: event('Lehrgang Diskret', '2026-12-12 09:00:00', '2026-12-12 16:00:00'),
    }
    world.participants = {
        7001: [participant(9001, [1001]), participant(9002, [1002], 'declined'),
               participant(9003, 1003), participant(9004, [])],
        7002: [participant(9005, [1006])],
        7102: [],
    }
    world.tables['event_participants'] = [
        {'memberId': 1001, 'attendanceStatus': 'registered', 'notes': WEBLING_NOTE},
        {'memberId': 1005, 'attendanceStatus': 'registered', 'notes': WEBLING_NOTE},
        {'memberId': 1006, 'attendanceStatus': 'attended', 'notes': WEBLING_NOTE},
        {'memberId': 1007, 'attendanceStatus': 'registered', 'notes': None},
    ]
    world.tables['event_logs'] = [{'memberId': 1009}]
    return 'events.py', [], world, {}


def events_by_name_world():
    _, _, world, env = events_world()
    return 'events.py', ['--calendar', 'aikido'], world, env


def events_by_id_world():
    _, _, world, env = events_world()
    return 'events.py', ['--calendar', '501'], world, env


def events_no_match_world():
    _, _, world, env = events_world()
    return 'events.py', ['--calendar', '999'], world, env


def events_list_world():
    _, _, world, env = events_world()
    return 'events.py', ['list'], world, env


def events_login_failed_world():
    _, _, world, env = events_world()
    world.login_status = 401
    return 'events.py', [], world, env


SCENARIOS = {
    'members': members_world,
    'members_anonymized': members_anonymized_world,
    'members_mass_drop': members_mass_drop_world,
    'members_accept_gone': members_accept_gone_world,
    'events': events_world,
    'events_by_name': events_by_name_world,
    'events_by_id': events_by_id_world,
    'events_no_match': events_no_match_world,
    'events_list': events_list_world,
    'events_login_failed': events_login_failed_world,
}

# Scenarios whose log is public in GitHub Actions (list and a calendar
# selection that matches nothing print calendar titles on purpose: they
# are run by hand, to find a calendar's id)
SYNC_RUNS = [name for name in SCENARIOS if name not in ('events_list', 'events_no_match')]
