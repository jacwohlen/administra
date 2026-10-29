"""integration.runner: modes, fallback, finish in finally, exit codes."""
import pytest

from fake_layer import FakeLayer
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


class Legacy:
    def __init__(self, status=0):
        self.status = status
        self.calls = 0

    def __call__(self):
        self.calls += 1
        return self.status


def go(world, mode='layer', adapter=None, legacy=None, **options):
    legacy = legacy or Legacy()
    adapter = adapter or FakeAdapter()
    status = run(Options(kind=options.pop('kind', 'members'), mode=mode, **options), legacy=legacy,
                 adapter=lambda: adapter, layer=lambda: Layer(Client('https://db.example', 'sb_secret_test')))
    return status, legacy


def test_legacy_mode_runs_only_legacy(world):
    def unused():
        raise AssertionError('the layer path must not be built in legacy mode')
    legacy = Legacy(3)
    status = run(Options(kind='members'), legacy=legacy, adapter=unused, layer=unused)
    assert status == 3 and legacy.calls == 1
    assert world.calls == []


def test_legacy_mode_has_no_dry_run(world, capsys):
    status, legacy = go(world, mode='legacy', dry_run=True)
    assert status == 2 and legacy.calls == 0
    assert 'no dry run' in capsys.readouterr().out


def test_unknown_mode(world):
    status, legacy = go(world, mode='layr')
    assert status == 2 and legacy.calls == 0


def test_layer_ok_exits_0(world, capsys):
    fake = FakeLayer(world)
    status, legacy = go(world)
    assert status == 0 and legacy.calls == 0
    assert len(fake.finished) == 1
    out = capsys.readouterr().out
    assert 'Final: ok' in out


def test_calendars_the_provider_no_longer_has_are_logged_by_id(world, capsys):
    # The database answers with the catalog's calendars missing from provider_calendars
    FakeLayer(world)
    adapter = FakeAdapter()
    adapter.plan = lambda kind: Plan({'complete': True, 'calendars': ['501'], 'calendars_gone': ['502', '503']})
    status, _ = go(world, adapter=adapter, kind='events')
    assert status == 0
    assert 'Calendars the provider no longer has (settled as read, without events): 502, 503' \
        in capsys.readouterr().out


def test_layer_missing_falls_back_to_legacy(world, capsys):
    # No integration_* function on this database (Promotion 1 not done)
    status, legacy = go(world, legacy=Legacy(0))
    assert status == 0 and legacy.calls == 1
    assert '::warning::The integration layer is not on this database yet' in capsys.readouterr().out


def test_layer_missing_on_a_dry_run_never_runs_legacy(world, capsys):
    status, legacy = go(world, dry_run=True)
    assert status == 1 and legacy.calls == 0
    assert 'nothing to dry-run against' in capsys.readouterr().out


@pytest.mark.parametrize('answer', [
    Response(403, {'code': '42501', 'message': 'NOT_ALLOWED'}),
    Response(409, {'code': 'PT409', 'message': 'RUN_IN_PROGRESS'}),
    Response(500, None),
])
def test_other_begin_errors_fail_without_fallback(world, capsys, answer):
    fake = FakeLayer(world, fail={'begin': answer})
    status, legacy = go(world)
    assert status == 1 and legacy.calls == 0
    assert fake.finished == []  # no run was opened
    assert 'Error: integration_begin' in capsys.readouterr().out


@pytest.mark.parametrize('step', ['stage', 'apply'])
def test_a_404_mid_run_fails_the_run(world, capsys, step):
    fake = FakeLayer(world, fail={step: Response(404, {'code': 'PGRST202', 'message': 'gone'})})
    status, legacy = go(world)
    assert status == 1 and legacy.calls == 0
    assert fake.finished[0]['p_report']['error'] == 'layer_error'
    assert 'Final: failed' in capsys.readouterr().out


def test_crash_in_records_still_finishes(world, capsys):
    fake = FakeLayer(world)
    status, legacy = go(world, adapter=FakeAdapter(records_error=RuntimeError('Zora Geheimname')))
    assert status == 1 and legacy.calls == 0
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
    status, _ = go(world, adapter=FakeAdapter(plan_error=KeyError('Zora')))
    assert status == 1
    assert fake.begun[0]['p_options']['scope'] == {'complete': False}
    assert fake.stage_calls == []
    assert fake.finished[0]['p_report']['error'] == 'adapter_crash'
    assert 'Zora' not in capsys.readouterr().out


def test_fetch_failure_fails_the_run(world, capsys):
    fake = FakeLayer(world)
    status, _ = go(world, adapter=FakeAdapter(records_error=FetchFailed('Webling GET /api/1/member failed: HTTP 500')))
    assert status == 1
    assert fake.applied == []
    assert fake.finished[0]['p_report']['error'] == 'fetch_failed'
    assert 'Webling GET /api/1/member failed: HTTP 500' in capsys.readouterr().out


def test_usage_error_opens_no_run(world):
    fake = FakeLayer(world)
    status, legacy = go(world, adapter=FakeAdapter(plan_error=UsageError('no calendar matched')))
    assert status == 2 and legacy.calls == 0 and fake.begun == []


def test_config_error(world, capsys):
    def adapter():
        raise ConfigError('Please export WEBLING_DOMAIN')
    status = run(Options(kind='members', mode='layer'), legacy=Legacy(), adapter=adapter,
                 layer=lambda: Layer(Client('https://db.example', 'k')))
    assert status == 1
    assert 'Please export WEBLING_DOMAIN' in capsys.readouterr().out


def test_fetch_errors_make_a_warning_and_exit_1(world, capsys):
    FakeLayer(world)
    status, _ = go(world, adapter=FakeAdapter(errors=2))
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
    status, _ = go(world)
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


def test_shadow_runs_legacy_then_a_dry_run(world, capsys):
    fake = FakeLayer(world)
    status, legacy = go(world, mode='shadow', legacy=Legacy(0))
    assert status == 0 and legacy.calls == 1
    assert fake.begun[0]['p_options']['dry_run'] is True
    assert len(fake.finished) == 1


@pytest.mark.parametrize('legacy_status', [0, 1])
def test_shadow_keeps_the_legacy_exit_status(world, capsys, legacy_status):
    FakeLayer(world, apply_answer={'status': 'refused', 'hint': 'accept_gone=60',
                                   'guard': {'refused': 'members_gone'}})
    status, _ = go(world, mode='shadow', legacy=Legacy(legacy_status))
    assert status == legacy_status
    assert '::warning::Shadow: the layer would have ended refused' in capsys.readouterr().out


def test_shadow_without_the_layer_warns(world, capsys):
    status, legacy = go(world, mode='shadow', legacy=Legacy(0))
    assert status == 0 and legacy.calls == 1
    assert '::warning::Shadow run skipped' in capsys.readouterr().out


def test_shadow_survives_a_layer_error(world, capsys):
    FakeLayer(world, fail={'begin': Response(403, {'code': '42501', 'message': 'NOT_ALLOWED'})})
    status, legacy = go(world, mode='shadow', legacy=Legacy(0))
    assert status == 0
    assert '::warning::Shadow run of the layer failed: integration_begin: HTTP 403 42501: NOT_ALLOWED' in \
        capsys.readouterr().out


def test_shadow_dry_run_skips_legacy(world):
    fake = FakeLayer(world)
    status, legacy = go(world, mode='shadow', dry_run=True)
    assert status == 0 and legacy.calls == 0
    assert fake.begun[0]['p_options']['dry_run'] is True
