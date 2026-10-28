"""integration.report: counts-only lines and exit codes."""
import pytest

from integration import report


@pytest.mark.parametrize('final, status', [
    ('ok', 0), ('warning', 1), ('refused', 1), ('failed', 1), ('?', 1), (None, 1)])
def test_exit_code(final, status):
    assert report.exit_code(final) == status


def test_apply_lines_members():
    lines = report.apply_lines('members', 41, {
        'status': 'applied', 'dry_run': True,
        'result': {'received': 538, 'inserted': 0, 'updated': 2, 'unchanged': 536, 'gone': 0,
                   'issues': {'noted': 3, 'resolved': 1, 'open': 4}},
        'guard': {'new_catalog_rows': 1,
                  'members': {'complete': True, 'staged': 538, 'active_links': 538, 'to_gone': 0,
                              'former': 0, 'limit': 53},
                  'status': {'counting': 450, 'dropping': 2, 'gaining': 0, 'limit': 45,
                             'became': {'left': 2}}},
        'accepted': {}})
    assert lines == [
        'Layer members run 41: applied (dry run: nothing written)',
        '  received 538, inserted 0, updated 2, unchanged 536, gone 0',
        '  gone: 0 of 538 live links, former 0 (limit 53, complete snapshot)',
        '  status: 2 of 450 counting stop, 0 start (limit 45); they become left: 2',
        '  issues: noted 3, resolved 1, open 4',
    ]


def test_apply_lines_print_numbers_and_codes_only():
    lines = report.apply_lines('events', 9, {
        'status': 'Zora Geheimname', 'result': {'received': 3, 'title': 'Geheim', 'Zora': 1},
        'guard': {'status': {'became': {'Zora': 1}, 'dropping': 'x'}}})
    text = '\n'.join(lines)
    assert 'Geheim' not in text
    assert 'Layer events run 9: ?' in text


@pytest.mark.parametrize('guard, hint, expected', [
    ({'refused': 'empty_snapshot'}, None,
     'refused (empty_snapshot): the provider answered no records at all; check the provider and '
     'its API key; nothing written.'),
    ({'refused': 'status_drop', 'status': {'counting': 450, 'dropping': 60, 'limit': 45,
                                           'became': {'non_member': 60}}},
     'accept_status_drop=60',
     'refused (status_drop): 60 of 450 members would lose their active or passive membership '
     '(they would become non_member: 60); nothing written. Check the provider; if the change is '
     'intended, run the workflow by hand with accept_status_drop=60'),
    ({'refused': 'status_gain', 'status': {'gaining': 70, 'limit': 45}}, 'accept_status_gain=70',
     'refused (status_gain): 70 members would start to count as active or passive at once and be '
     'let in (limit 45); nothing written. Check the provider; if the change is intended, run the '
     'workflow by hand with accept_status_gain=70'),
    ({'refused': 'events_gone', 'events': {'to_gone': 12, 'limit': 8}}, 'accept_events_gone=12',
     'refused (events_gone): 12 events or holidays would be gone at once (limit 8); nothing '
     'written. Check the provider; if the change is intended, run the workflow by hand with '
     'accept_events_gone=12'),
])
def test_refusal_lines(guard, hint, expected):
    kind = 'events' if guard['refused'] == 'events_gone' else 'members'
    assert report.refusal_line(kind, 5, guard, hint) == f"Error: layer {kind} run 5 {expected}"


def test_a_dry_run_only_says_what_a_real_run_would_meet():
    line = report.refusal_line('members', 5, {'refused': 'members_gone', 'members': {
        'to_gone': 60, 'former': 0, 'limit': 53}}, 'accept_gone=60', dry=True)
    assert line == ('Dry run: layer members run 5 would be refused (members_gone): 60 members would '
                    'be marked gone at once (limit 53). A real run would need accept_gone=60')


def test_a_hint_that_is_not_an_override_is_not_printed():
    line = report.refusal_line('members', 5, {'refused': 'members_gone'}, 'accept_gone=60; Zora')
    assert 'Zora' not in line and 'run the workflow' not in line


def test_final_lines():
    assert report.final_lines('members', 5, {'status': 'applied'}, {'status': 'ok'}) == ['Final: ok']
    assert report.final_lines('members', 5, None, {'status': 'failed', 'error': 'adapter_crash'}) == [
        'Error: layer members run 5 failed (adapter_crash)', 'Final: failed']
    assert report.final_lines('members', 5, {'status': 'failed', 'error': '23514 members_check'},
                              {'status': 'failed'}) == [
        'Error: layer members run 5 failed (23514 members_check)', 'Final: failed']
    # finish itself failed
    assert report.final_lines('events', 5, None, None)[-1] == 'Final: failed'
    # The apply committed, closing the run failed: never "not applied"
    lines = report.final_lines('members', 41, {'status': 'applied', 'error': None}, None)
    assert lines == [
        'Error: layer members run 41 was applied but could not be closed; it closes itself '
        'after an hour (a re-run gets RUN_IN_PROGRESS until then)',
        'Final: failed']
    assert 'not applied' not in report.final_lines('members', 41, {'status': 'refused'}, None)[0]


def test_warning_lines():
    applied = {'result': {'invalid': 2, 'held': 1, 'issues': {'noted': 3, 'open': 5}},
               'guard': {'new_catalog_rows': 2}}
    lines = report.warning_lines('members', 7, applied, {'status': 'warning'}, 1)
    assert lines == [
        '::warning::Layer members run 7 ended with a warning: 3 records not written (held: 1, '
        'invalid: 2), 1 fetch errors. See integration_issues (Integrations page)',
        '::warning::2 new groups or calendars to review (integration_member_groups, '
        'integration_calendars)',
        '::warning::3 members issues seen in this run (5 open in all). See integration_issues',
    ]
    # An event without date is info: not counted as not written
    events = report.warning_lines('events', 7, {'result': {'invalid': 4}}, {'status': 'warning'}, 1)
    assert events[0].startswith('::warning::Layer events run 7 ended with a warning: 0 records')
    assert report.warning_lines('members', 7, {'result': {}}, {'status': 'ok'}, 0) == []
