from datetime import date

import pytest

from sync_rules import (
    WEBLING_NOTE,
    club_today,
    confirmed_member_ids,
    counts,
    member_row,
    missing_table,
    plan_participants,
    plan_gone,
    plan_status_drop,
    registrations_open,
    status_after_run,
    status_from_labels,
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


def test_plan_gone_accepts_the_exact_confirmed_count():
    active = links(*range(1001, 1101))
    assert not plan_gone(active, [], range(1001, 1050), accept=51)[2]
    assert plan_gone(active, [], range(1001, 1050), accept=50)[2]
    assert plan_gone(active, [], [], accept=100)[2]  # an empty answer never


# The table in docs/INTEGRATIONS.md, rule by rule, in the SQL's order
@pytest.mark.parametrize('labels, link, status', [
    (['Aktiv'], 'gone', 'left'),
    (['Aktiv', '03_Austritt'], 'active', 'left'),
    (['Aktiv', 'Vorstand'], 'active', 'active'),
    (['Passiv'], 'active', 'passive'),
    (['Ehrenmitglieder'], 'active', 'passive'),
    (['Passiv', 'Nicht-Mitglieder'], 'active', 'passive'),
    (['Nicht-Mitglieder'], 'active', 'non_member'),
    (['probetraining'], None, 'trial'),
    (['Probetraining'], 'active', 'non_member'),
    (['Vorstand'], 'active', 'non_member'),  # from Webling without a status group
    ([], None, 'active'),  # created in Administra
    (['aktiv'], 'active', 'non_member'),  # exact spelling only
    (None, 'active', 'non_member'),
    ({'Aktiv': True}, None, 'active'),  # not a list: no labels
])
def test_status_from_labels_follows_the_database(labels, link, status):
    assert status_from_labels(labels, link) == status


def test_counts_like_member_grants_access():
    assert counts('active', None, ['Aktiv'])
    assert counts('passive', None, [])
    assert not counts('non_member', None, [])
    assert not counts('active', '2026-01-01T00:00:00+00:00', ['Aktiv'])  # archived
    assert not counts('active', None, ['Aktiv', 'PROBETRAINING'])  # trial label, any case
    assert not counts(None, None, [])


def db(member_id, status, labels=None, archived=None):
    return {'id': member_id, 'membership_status': status, 'archivedAt': archived,
            'labels': labels if labels is not None else []}


def club(active, passive=0):
    """Rows of a club with that many active (ids from 1001) and passive members."""
    rows = [db(1001 + i, 'active', ['Aktiv']) for i in range(active)]
    return rows + [db(1001 + active + i, 'passive', ['Passiv']) for i in range(passive)]


def webling(rows, labels):
    return [{'id': row['id'], 'labels': labels} for row in rows]


def test_status_drop_within_a_tenth_goes_ahead():
    current = club(269, 30)  # prod, October 2026: 299 count, so up to 29 may go at once
    leaving = webling(current[:29], ['03_Austritt'])
    plan = plan_status_drop(current, leaving + webling(current[29:], ['Aktiv']))
    assert (plan.dropping, plan.counting, plan.too_many, plan.accepted) == (29, 299, False, False)
    assert plan.by_status == {'left': 29}


def test_status_drop_of_more_than_a_tenth_is_refused():
    current = club(269, 30)
    plan = plan_status_drop(current, webling(current[:30], ['03_Austritt']))
    assert (plan.dropping, plan.too_many) == (30, True)


def test_renamed_aktiv_group_is_refused():
    current = club(269, 30)
    plan = plan_status_drop(current, webling(current[:269], ['Aktive Mitglieder']))
    assert plan.too_many
    assert plan.by_status == {'non_member': 269}


def test_renamed_passiv_group_alone_is_refused():
    # 20 of 30 passive members drop: under a tenth of 299, but more than half of the passive
    current = club(269, 30)
    plan = plan_status_drop(current, webling(current[269:289], ['Passivmitglieder']))
    assert (plan.dropping, plan.too_many) == (20, True)
    assert not plan_status_drop(current, webling(current[269:284], ['Passivmitglieder'])).too_many


def test_small_clubs_may_lose_five_at_once():
    current = club(10)
    assert not plan_status_drop(current, webling(current[:5], ['03_Austritt'])).too_many
    assert plan_status_drop(current, webling(current[:6], ['03_Austritt'])).too_many


def test_status_drop_goes_ahead_with_the_exact_accepted_count():
    current = club(269, 30)
    renamed = webling(current[:269], ['Aktive Mitglieder'])
    plan = plan_status_drop(current, renamed, accept=269)
    assert (plan.too_many, plan.accepted) == (False, True)
    plan = plan_status_drop(current, renamed, accept=268)
    assert (plan.too_many, plan.accepted) == (True, False)


def test_an_accepted_count_under_the_limit_is_not_needed():
    current = club(269, 30)
    plan = plan_status_drop(current, webling(current[:3], ['03_Austritt']), accept=3)
    assert (plan.dropping, plan.too_many, plan.accepted) == (3, False, False)


def test_members_that_do_not_count_now_cannot_drop():
    current = [
        db(1001, 'active', ['Aktiv'], archived='2026-01-01T00:00:00+00:00'),
        db(1002, 'active', ['Aktiv', 'Probetraining']),
        db(1003, 'non_member', ['Nicht-Mitglieder']),
        db(1004, 'left', ['03_Austritt']),
        {'id': 1005, 'labels': ['Aktiv']},  # no membership_status: ignored
    ]
    plan = plan_status_drop(current, webling(current, ['03_Austritt']) + [{'id': 2000, 'labels': []}])
    assert (plan.dropping, plan.counting, plan.too_many) == (0, 0, False)
    assert plan.predicted[2000] == 'non_member'  # new from Webling, without a status group


def test_a_trial_label_takes_a_member_out():
    current = club(3)
    plan = plan_status_drop(current, webling(current[:1], ['Aktiv', 'probetraining']))
    assert plan.dropping == 1
    assert plan.by_status == {'trial': 1}


def test_status_after_run_compares_with_the_database():
    current = club(40)
    plan = plan_status_drop(current, webling(current, ['Aktiv']))
    assert status_after_run(current, current, plan.predicted) == (0, 0, False)
    # The database took 10 out although the rules here predicted no change
    after = [db(r['id'], 'non_member', r['labels']) for r in current[:10]] + current[10:]
    assert status_after_run(current, after, plan.predicted) == (10, 10, True)
    assert status_after_run(current, after, plan.predicted, accept=10) == (10, 10, False)
