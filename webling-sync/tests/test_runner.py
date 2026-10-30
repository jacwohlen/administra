"""integration.runner: a database without the layer, finish in finally, exit codes."""
import pytest

from fake_layer import CAPABILITIES, FakeLayer
from fake_world import Response, World
from integration.client import Client
from integration.layer import Layer
from integration.runner import ConfigError, FetchFailed, Options, UsageError, run


class Plan:
    def __init__(self, scope):
        self.scope = scope


class FakeAdapter:
    """Two member records; `fail` raises in plan() or records()."""
    connection = 'webling'

    def __init__(self, plan_error=None, records_error=None, records=None, errors=0):
        self.plan_error = plan_error
        self.records_error = records_error
        self._records = records
        self.errors = errors
        self.counters = {'members': 2}

    def empty_scope(self, kind):
        return {'complete': False}

    def plan(self, kind):
        if self.plan_error:
            raise self.plan_error
        return Plan({'complete': True})

    def records(self, plan, run):
        if self.records_error:
            raise self.records_error
        return self._records or [
            {'external_id': '1001', 'data': {'firstname': 'Zora', 'lastname': 'Geheimname',
                                             'birthday': '1990-05-06', 'mobile': '079',
                                             'email': 'zora@example.com', 'groups': []}},
            {'external_id': '1002', 'data': {'problem': 'missing_field'}},
        ]


@pytest.fixture
def world(monkeypatch):
    return World().install(monkeypatch)


def go(world, adapter=None, **options):
    adapter = adapter or FakeAdapter()
    return run(Options(kind=options.pop('kind', 'members'), **options),
               adapter=lambda: adapter, layer=lambda: Layer(Client('https://db.example', 'sb_secret_test')))


@pytest.mark.parametrize('dry_run', [False, True])
def test_a_database_without_the_layer_fails(world, capsys, dry_run):
    # No integration_* function on this database: an error, and nothing
    # else is called (no other way to write since phase 3c)
    status = go(world, dry_run=dry_run)
    assert status == 1
    assert [call['url'].rsplit('/', 1)[1] for call in world.calls] == ['integration_begin']
    assert ('Error: integration_begin: the integration layer is not on this database '
            '(HTTP 404 PGRST202: Could not find the function integration_begin)') in capsys.readouterr().out


def test_layer_ok_exits_0(world, capsys):
    fake = FakeLayer(world)
    status = go(world)
    assert status == 0
    assert len(fake.finished) == 1
    out = capsys.readouterr().out
    assert 'Final: ok' in out


def test_calendars_the_provider_no_longer_has_are_logged_by_id(world, capsys):
    # The database answers with the catalog's calendars missing from provider_calendars
    FakeLayer(world)
    adapter = FakeAdapter()
    adapter.plan = lambda kind: Plan({'complete': True, 'calendars': ['501'], 'calendars_gone': ['502', '503']})
    status = go(world, adapter=adapter, kind='events')
    assert status == 0
    assert 'Calendars the provider no longer has (settled as read, without events): 502, 503' \
        in capsys.readouterr().out


def test_keys_the_database_does_not_know_are_left_out_and_named(world, capsys):
    # A database whose capabilities lack ends_on and all_day (before phase
    # 4): the events go up without them, no special case in the adapter
    keys = [k for k in CAPABILITIES['event_keys'] if k not in ('ends_on', 'all_day')]
    fake = FakeLayer(world, capabilities={**CAPABILITIES, 'event_keys': keys})
    adapter = FakeAdapter(records=[{'external_id': '7001', 'data': {
        'title': 'T', 'starts_on': '2026-11-05', 'ends_on': None, 'all_day': False}}])
    adapter.plan = lambda kind: Plan({'complete': True, 'calendars': ['501']})
    assert go(world, adapter=adapter, kind='events') == 0
    assert fake.staged == [{'external_id': '7001', 'data': {'title': 'T', 'starts_on': '2026-11-05'}}]
    assert 'Not sent (unknown to this database): all_day, ends_on' in capsys.readouterr().out


@pytest.mark.parametrize('answer', [
    Response(403, {'code': '42501', 'message': 'NOT_ALLOWED'}),
    Response(409, {'code': 'PT409', 'message': 'RUN_IN_PROGRESS'}),
    Response(500, None),
])
def test_other_begin_errors_fail(world, capsys, answer):
    fake = FakeLayer(world, fail={'begin': answer})
    status = go(world)
    assert status == 1
    assert fake.finished == []  # no run was opened
    assert 'Error: integration_begin' in capsys.readouterr().out


def test_a_disabled_connection_is_skipped(world, capsys):
    # Switched off on the Integrations page: nothing synced, not an error
    fake = FakeLayer(world, fail={'begin': Response(423, {'code': 'PT423', 'message': 'CONNECTION_DISABLED'})})
    assert go(world) == 0
    assert fake.finished == []
    assert 'switched off on the Integrations page' in capsys.readouterr().out


@pytest.mark.parametrize('step', ['stage', 'apply'])
def test_a_404_mid_run_fails_the_run(world, capsys, step):
    fake = FakeLayer(world, fail={step: Response(404, {'code': 'PGRST202', 'message': 'gone'})})
    status = go(world)
    assert status == 1
    assert fake.finished[0]['p_report']['error'] == 'layer_error'
    assert 'Final: failed' in capsys.readouterr().out


def test_crash_in_records_still_finishes(world, capsys):
    fake = FakeLayer(world)
    status = go(world, adapter=FakeAdapter(records_error=RuntimeError('Zora Geheimname')))
    assert status == 1
    assert fake.applied == []
    assert fake.finished == [{'p_run': 41, 'p_report': {
        'errors': 0, 'counters': {'members': 2}, 'error': 'adapter_crash'}}]
    out = capsys.readouterr().out
    assert 'RuntimeError at test_runner.py' in out
    assert 'Zora' not in out
    assert 'Final: failed' in out


def test_interrupt_still_finishes(world):
    fake = FakeLayer(world)
    with pytest.raises(KeyboardInterrupt):
        go(world, adapter=FakeAdapter(records_error=KeyboardInterrupt()))
    assert fake.finished[0]['p_report']['error'] == 'adapter_crash'


def test_crash_in_plan_opens_and_fails_the_run(world, capsys):
    fake = FakeLayer(world)
    status = go(world, adapter=FakeAdapter(plan_error=KeyError('Zora')))
    assert status == 1
    assert fake.begun[0]['p_options']['scope'] == {'complete': False}
    assert fake.stage_calls == []
    assert fake.finished[0]['p_report']['error'] == 'adapter_crash'
    assert 'Zora' not in capsys.readouterr().out


def test_fetch_failure_fails_the_run(world, capsys):
    fake = FakeLayer(world)
    status = go(world, adapter=FakeAdapter(records_error=FetchFailed('Webling GET /api/1/member failed: HTTP 500')))
    assert status == 1
    assert fake.applied == []
    assert fake.finished[0]['p_report']['error'] == 'fetch_failed'
    assert 'Webling GET /api/1/member failed: HTTP 500' in capsys.readouterr().out


def test_usage_error_opens_no_run(world):
    fake = FakeLayer(world)
    status = go(world, adapter=FakeAdapter(plan_error=UsageError('no calendar matched')))
    assert status == 2 and fake.begun == []


def test_config_error(world, capsys):
    def adapter():
        raise ConfigError('Please export WEBLING_DOMAIN')
    status = run(Options(kind='members'), adapter=adapter,
                 layer=lambda: Layer(Client('https://db.example', 'k')))
    assert status == 1
    assert 'Please export WEBLING_DOMAIN' in capsys.readouterr().out


def test_fetch_errors_make_a_warning_and_exit_1(world, capsys):
    FakeLayer(world)
    status = go(world, adapter=FakeAdapter(errors=2))
    assert status == 1
    out = capsys.readouterr().out
    assert '::warning::Layer members run 41 ended with a warning' in out
    assert 'Final: warning' in out


def test_refusal_prints_the_override_and_exits_1(world, capsys):
    FakeLayer(world, apply_answer={
        'status': 'refused', 'hint': 'accept_gone=60',
        'guard': {'new_catalog_rows': 0, 'refused': 'members_gone', 'members': {
            'complete': True, 'staged': 478, 'active_links': 538, 'to_gone': 58, 'former': 2,
            'limit': 53}}})
    status = go(world)
    assert status == 1
    out = capsys.readouterr().out
    assert ('Error: layer members run 41 refused (members_gone): 60 members would be marked gone '
            'at once (limit 53); nothing written. Check the provider; if the change is intended, '
            'run the workflow by hand with accept_gone=60') in out
    assert 'Final: refused' in out


def test_accept_and_options_reach_the_layer(world):
    fake = FakeLayer(world)
    go(world, accept={'accept_gone': 60}, trigger='schedule', runner='github:99', dry_run=True)
    assert fake.begun[0]['p_options'] == {'scope': {'complete': True}, 'dry_run': True,
                                          'trigger': 'schedule', 'runner': 'github:99'}
    assert fake.applied[0]['p_options'] == {'accept_gone': 60}


def test_anonymize_before_staging(world):
    fake = FakeLayer(world)
    go(world, anonymize=True)
    data = fake.staged[0]['data']
    assert data['email'] == 'member-1001@example.invalid'
    assert data['lastname'].endswith(' 1001') and 'Geheimname' not in data['lastname']
    assert data['birthday'].startswith('1990-') and data['mobile'] is None
    # A problem record carries no personal data and stays as it is
    assert fake.staged[1] == {'external_id': '1002', 'data': {'problem': 'missing_field'}}
