"""No name, title, group, note, e-mail, phone number or key reaches the log.

The Actions log of the sync is public. The fake Webling here answers with
names, event and calendar titles, group names (leaving and billing
states), participant notes and e-mails (legacy_scenarios.SECRETS); none of
them may appear on stdout or stderr, in legacy, shadow or layer mode, also
when Webling or Supabase fail.
"""
import pytest
import requests

import sync
import webling_adapter.members
from fake_layer import FakeLayer
from fake_world import Response, run_script, set_env
from legacy_scenarios import SCENARIOS, SECRETS, SYNC_RUNS

KIND = {'webling.py': 'members', 'events.py': 'events'}


def assert_private(out):
    text = out.out + out.err
    leaked = [s for s in SECRETS if s in text]
    assert leaked == [], text


def in_process(command):
    """The legacy executor of sync.py, in this process (so the fakes apply)."""
    return run_script(command[1].rsplit('/', 1)[1], command[2:])


def setup(name, monkeypatch, mode, **layer):
    script, args, world, env = SCENARIOS[name]()
    set_env(monkeypatch, **env, INTEGRATION_MODE=mode)
    world.install(monkeypatch)
    fake = FakeLayer(world, **layer)
    return KIND[script], args, world, fake


@pytest.mark.parametrize('name', SYNC_RUNS)
def test_legacy_scripts(name, monkeypatch, capsys):
    script, args, world, env = SCENARIOS[name]()
    set_env(monkeypatch, **env)
    world.install(monkeypatch)
    run_script(script, args)
    assert_private(capsys.readouterr())


@pytest.mark.parametrize('name', SYNC_RUNS)
@pytest.mark.parametrize('mode', ['legacy', 'shadow', 'layer'])
def test_sync_modes(name, mode, monkeypatch, capsys):
    kind, args, world, fake = setup(name, monkeypatch, mode)
    sync.main([kind, *args], legacy=in_process)
    if mode != 'legacy':
        assert fake.finished, 'the layer ran'
    assert_private(capsys.readouterr())


ERROR_DETAILS = {'code': '23514', 'message': 'invalid input syntax for type date: "Zora Geheimname"',
                 'details': 'Failing row contains (1001, Zora, Geheimname, zora@example.com).',
                 'hint': 'Geheimname'}


@pytest.mark.parametrize('failure', [
    {'apply': Response(400, ERROR_DETAILS)},
    {'stage': Response(400, ERROR_DETAILS)},
    {'finish': Response(500, ERROR_DETAILS)},
    {'begin': Response(403, ERROR_DETAILS)},
    {'apply': Response(200, {'run': 41, 'status': 'failed', 'dry_run': False,
                              'error': 'Zora Geheimname', 'result': {'Zora': 'Geheimname'},
                              'guard': {'refused': 'Geheimname'}, 'hint': 'Zora'})},
    {'apply': Response(200, {'run': 41, 'status': 'refused', 'dry_run': False, 'result': {},
                              'guard': {'refused': 'status_drop',
                                        'status': {'became': {'Zora Geheimname': 3}}},
                              'hint': 'accept_status_drop=3 Zora'})},
])
@pytest.mark.parametrize('name', ['members', 'events'])
@pytest.mark.parametrize('mode', ['shadow', 'layer'])
def test_layer_errors(name, mode, failure, monkeypatch, capsys):
    kind, args, world, fake = setup(name, monkeypatch, mode, fail={
        step: (lambda body, answer=answer: answer) for step, answer in failure.items()})
    if 'apply' in failure and failure['apply'].status_code == 200:
        fake.fail = {}
        fake.apply_answer = failure['apply'].json()
    sync.main([kind, *args], legacy=in_process)
    assert_private(capsys.readouterr())


@pytest.mark.parametrize('mode', ['shadow', 'layer'])
def test_network_errors(mode, monkeypatch, capsys):
    kind, args, world, fake = setup('events', monkeypatch, mode)
    # requests puts the whole URL (with the API key) into its exceptions
    world.network_errors = {'calendarevent/7001', 'query/participant', 'rpc/integration_stage'}
    sync.main([kind, *args], legacy=in_process)
    out = capsys.readouterr()
    assert 'ConnectionError' in out.out
    assert_private(out)


@pytest.mark.parametrize('mode', ['shadow', 'layer'])
def test_adapter_crash(mode, monkeypatch, capsys):
    kind, args, world, fake = setup('members', monkeypatch, mode)

    def crash(raw, titles):
        raise ValueError(f"bad member {raw['properties'].get('Name')} zora@example.com")
    monkeypatch.setattr(webling_adapter.members, 'member_record', crash)
    sync.main([kind, *args], legacy=in_process)
    out = capsys.readouterr()
    assert 'ValueError at' in out.out
    assert fake.finished[-1]['p_report']['error'] == 'adapter_crash'
    assert_private(out)


def test_no_request_url_with_a_key_in_any_exception(monkeypatch, capsys):
    # A Webling call that fails on the network in layer mode
    kind, args, world, fake = setup('members', monkeypatch, 'layer')
    world.network_errors = {'/api/1/member'}
    status = sync.main([kind], legacy=in_process)
    out = capsys.readouterr()
    assert status == 1
    assert 'Webling GET /api/1/member failed: ConnectionError' in out.out
    assert_private(out)
    assert isinstance(requests.ConnectionError(), requests.RequestException)
