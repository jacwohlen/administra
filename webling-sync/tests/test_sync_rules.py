from datetime import date

import pytest

from sync_rules import (
    WEBLING_NOTE,
    club_today,
    confirmed_member_ids,
    member_row,
    missing_table,
    plan_participants,
    plan_gone,
    registrations_open,
)

PROPERTIES = {
    'Vorname': ' Anna ',
    'Name': 'Muster ',
    'Geburtstag': '2010-04-01',
    'Mobile': '0790000000',
    'E-Mail': ' anna@example.com ',
}


def test_member_row_maps_and_trims():
    assert member_row(4711, PROPERTIES, ['Aktiv']) == {
        'id': 4711,
        'firstname': 'Anna',
        'lastname': 'Muster',
        'birthday': '2010-04-01',
        'mobile': '0790000000',
        'labels': ['Aktiv'],
        'email': 'anna@example.com',
    }


@pytest.mark.parametrize('email', [None, '', '   '])
def test_member_row_leaves_email_out_when_webling_has_none(email):
    assert 'email' not in member_row(1, {**PROPERTIES, 'E-Mail': email}, [])


def test_member_row_empty_first_name():
    row = member_row(1, {**PROPERTIES, 'Vorname': None, 'Name': 'Muster'}, [])
    assert row['firstname'] == ''
    assert row['lastname'] == 'Muster'


@pytest.mark.parametrize('lastname', [None, '', '   '])
def test_member_row_empty_last_name_raises(lastname):
    # Would blank the member's name in Administra
    with pytest.raises(ValueError):
        member_row(1, {**PROPERTIES, 'Name': lastname}, [])


def test_member_row_missing_property_raises():
    # A field renamed in Webling must fail the member, not blank every name
    properties = {k: v for k, v in PROPERTIES.items() if k != 'Vorname'}
    with pytest.raises(KeyError):
        member_row(1, properties, [])


def participant(member, state='confirmed'):
    return {'properties': {'594': state}, 'links': {'member': member}}


def test_confirmed_member_ids():
    ids, skipped = confirmed_member_ids([
        participant([11]),
        participant(12),
        participant('13'),
        participant([14], state='pending'),
        participant([]),
        participant(None),
        {},
    ])
    assert ids == {11, 12, 13}
    assert skipped == 4


def row(member_id, status='registered', notes=WEBLING_NOTE):
    return {'memberId': member_id, 'attendanceStatus': status, 'notes': notes}


def test_plan_inserts_new_confirmed_members_only():
    to_insert, to_remove = plan_participants([row(1)], {1, 2, 3}, set())
    assert to_insert == [2, 3]
    assert to_remove == []


def test_plan_keeps_existing_rows_untouched():
    # An existing row is neither re-inserted nor reset to 'registered'
    existing = [row(1, status='attended'), row(2, notes=None)]
    assert plan_participants(existing, {1, 2}, set()) == ([], [])


def test_plan_removes_dropped_webling_registrations():
    assert plan_participants([row(1), row(2)], {2}, set()) == ([], [1])


def test_plan_keeps_registrations_added_in_the_app():
    for notes in (None, '', 'Kommt später'):
        assert plan_participants([row(1, notes=notes)], set(), set()) == ([], [])


def test_plan_keeps_rows_with_another_status():
    for status in ('attended', 'absent', 'cancelled'):
        assert plan_participants([row(1, status=status)], set(), set()) == ([], [])


def test_plan_keeps_rows_with_attendance():
    assert plan_participants([row(1)], set(), {1}) == ([], [])


def test_plan_empty_webling_list_removes_only_webling_rows():
    existing = [row(1), row(2, notes=None), row(3, status='attended')]
    assert plan_participants(existing, set(), set()) == ([], [1])


@pytest.mark.parametrize('event_date, expected', [
    ('2026-10-25', True),
    ('2026-12-31', True),
    ('2026-10-24', False),
    ('25.10.2026', False),
    ('', False),
    (None, False),
])
def test_registrations_open(event_date, expected):
    assert registrations_open(event_date, date(2026, 10, 25)) is expected


def test_club_today_is_a_date():
    assert isinstance(club_today(), date)


def test_missing_table():
    assert missing_table(404, {'code': 'PGRST205', 'message': 'Could not find the table'})
    assert missing_table(404, {'code': '42P01'})
    assert not missing_table(404, {'code': 'PGRST116'})
    assert not missing_table(400, {'code': 'PGRST205'})
    assert not missing_table(404, None)


def links(*ids, gone=()):
    return [{'external_id': str(i), 'gone_at': '2026-10-01' if i in gone else None} for i in ids]


def test_plan_gone_marks_members_webling_dropped():
    to_mark, to_adopt, too_many = plan_gone(links(*range(1001, 1101)), range(1001, 1101), range(1003, 1101))
    assert to_mark == ['1001', '1002']
    assert to_adopt == []
    assert not too_many


def test_plan_gone_records_never_linked_rows():
    # First run: Webling returned 1001-1003, the database also has 1004-1006
    to_mark, to_adopt, too_many = plan_gone(links(1001, 1002, 1003), range(1001, 1007), [1001, 1002, 1003])
    assert to_mark == []
    assert to_adopt == [1004, 1005, 1006]
    assert not too_many


def test_plan_gone_leaves_gone_links_alone():
    to_mark, to_adopt, _ = plan_gone(links(1001, 1002, gone=(1002,)), [1001, 1002], [1001])
    assert to_mark == []
    assert to_adopt == []


def test_plan_gone_refuses_mass_marking():
    active = links(*range(1001, 1101))
    assert plan_gone(active, [], range(1001, 1050))[2]  # 51 of 100 gone at once
    assert plan_gone(active, [], [])[2]  # Webling returned nobody
    assert not plan_gone(links(1001, 1002, 1003), [], [1001])[2]  # up to 5 at once
