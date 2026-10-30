"""Scenarios for sync.py through the adapter and a fake layer, shared by
the adapter tests and the log-privacy test. Each returns (kind, args, World,
extra environment). The Webling data carries names, titles, group names,
notes and e-mails the public log must never show (SECRETS)."""
from fake_world import World, participant, webling_member

# Strings that must never reach stdout or stderr (see test_log_privacy.py)
SECRETS = [
    'Zora', 'Geheimname', 'Xaver', 'Verborgen', 'Yvonne', 'Privat', 'Quirin', 'Diskret',
    'zora@example.com', '079 000 00 00', 'secret note',
    '03_Austritt', '04_Probetraining', 'Aktiv', 'Passiv', 'Vorstand Geheim', 'Rechnung Geheim',
    'Kyu Prüfung Max Geheim', 'Geburtstag von Zora', 'Lehrgang Diskret', 'Dojo Geheimweg',
    'Kalender Geheim', 'Aikido Verborgen',
    'webling-key-123', 'secret', 'sb_secret_test',
]

GROUPS = {10: 'Aktiv', 11: 'Passiv', 12: '03_Austritt', 13: '04_Probetraining',
          14: 'Vorstand Geheim', 15: '02_Rechnung Geheim'}


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
    return 'members', [], world, {}


def members_anonymized_world():
    _, _, world, _ = members_world()
    world.members = world.members[:2]
    return 'members', [], world, {'ANONYMIZE': 'true'}


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
    return 'events', [], world, {}


def events_by_name_world():
    _, _, world, env = events_world()
    return 'events', ['--calendar', 'aikido'], world, env


def events_by_id_world():
    _, _, world, env = events_world()
    return 'events', ['--calendar', '501'], world, env


def events_login_failed_world():
    _, _, world, env = events_world()
    world.login_status = 401
    return 'events', [], world, env


# Every scenario's log is public in GitHub Actions ('list' prints calendar
# titles on purpose and is run by hand, so it is not one of them)
SCENARIOS = {
    'members': members_world,
    'members_anonymized': members_anonymized_world,
    'events': events_world,
    'events_by_name': events_by_name_world,
    'events_by_id': events_by_id_world,
    'events_login_failed': events_login_failed_world,
}
