"""sync.py: mode, options, the legacy commands, and the real process."""
import os
import subprocess
import sys

import pytest

import sync
from fake_layer import FakeLayer
from fake_world import ENV, SRC, World, set_env
from integration.anonymize import anonymize


class Legacy:
    def __init__(self, status=0):
        self.status = status
        self.commands = []

    def __call__(self, command):
        self.commands.append(command[1:])
        return self.status


@pytest.fixture
def world(monkeypatch):
    set_env(monkeypatch, INTEGRATION_MODE=None, INTEGRATION_DRY_RUN=None, INTEGRATION_TRIGGER=None,
            INTEGRATION_RUNNER=None)
    return World().install(monkeypatch)


@pytest.mark.parametrize('value', [None, '', '  '])
def test_unset_or_empty_mode_is_legacy(world, monkeypatch, value):
    if value is not None:
        monkeypatch.setenv('INTEGRATION_MODE', value)
    legacy = Legacy(5)
    assert sync.main(['members'], legacy=legacy) == 5
    assert legacy.commands == [[str(SRC / 'webling.py')]]
    assert world.calls == []


@pytest.mark.parametrize('argv, command', [
    (['members'], ['webling.py']),
    (['events'], ['events.py']),
    (['events', '--calendar', '22333', 'judo'], ['events.py', '--calendar', '22333', 'judo']),
    (['list'], ['events.py', 'list']),
])
def test_legacy_commands(world, argv, command):
    legacy = Legacy()
    sync.main(argv, legacy=legacy)
    assert legacy.commands == [[str(SRC / command[0]), *command[1:]]]


def test_legacy_runs_with_the_same_interpreter():
    assert sync.legacy_command('members', [])[0] == sys.executable


def test_mode_from_the_environment_and_the_flag(world, monkeypatch):
    FakeLayer(world)
    monkeypatch.setenv('INTEGRATION_MODE', 'layer')
    legacy = Legacy()
    assert sync.main(['members'], legacy=legacy) == 0
    assert legacy.commands == []
    # --mode wins over the variable
    assert sync.main(['members', '--mode', 'legacy'], legacy=legacy) == 0
    assert legacy.commands == [[str(SRC / 'webling.py')]]


def test_unknown_mode_stops(world, monkeypatch, capsys):
    monkeypatch.setenv('INTEGRATION_MODE', 'layr')
    legacy = Legacy()
    assert sync.main(['members'], legacy=legacy) == 2
    assert legacy.commands == []


def test_run_options_from_the_environment(world, monkeypatch):
    fake = FakeLayer(world)
    set_env(monkeypatch, INTEGRATION_MODE='layer', INTEGRATION_DRY_RUN='true',
            INTEGRATION_TRIGGER='schedule', INTEGRATION_RUNNER='github:4242',
            WEBLING_ACCEPT_GONE='60', WEBLING_ACCEPT_STATUS_DROP=' ', WEBLING_ACCEPT_STATUS_GAIN='7',
            WEBLING_ACCEPT_EVENTS_GONE='9')
    sync.main(['members'], legacy=Legacy())
    assert fake.begun[0]['p_options'] == {'scope': {'complete': True}, 'dry_run': True,
                                          'trigger': 'schedule', 'runner': 'github:4242'}
    assert fake.applied[0]['p_options'] == {'accept_gone': 60, 'accept_status_gain': 7}
    world.calendars = {501: {'title': 'Judo Agenda', 'events': []}}
    sync.main(['events'], legacy=Legacy())
    assert fake.applied[1]['p_options'] == {'accept_events_gone': 9}


def test_trigger_defaults_to_manual(world, monkeypatch):
    fake = FakeLayer(world)
    set_env(monkeypatch, INTEGRATION_MODE='layer', INTEGRATION_TRIGGER='app')
    sync.main(['members'], legacy=Legacy())
    assert fake.begun[0]['p_options']['trigger'] == 'manual'
    assert 'runner' not in fake.begun[0]['p_options']


def test_anonymize_is_required_for_members(world, monkeypatch, capsys):
    FakeLayer(world)
    set_env(monkeypatch, INTEGRATION_MODE='layer', ANONYMIZE=None)
    assert sync.main(['members'], legacy=Legacy()) == 1
    assert 'Please export ANONYMIZE' in capsys.readouterr().out


def test_dev_gets_fake_members(world, monkeypatch):
    fake = FakeLayer(world)
    world.groups = {10: 'Aktiv'}
    world.members = [{'id': 1001, 'parents': [10], 'properties': {
        'Vorname': 'Zora', 'Name': 'Geheimname', 'Geburtstag': '1990-05-06', 'Mobile': '079',
        'E-Mail': 'zora@example.com'}}]
    set_env(monkeypatch, INTEGRATION_MODE='layer', ANONYMIZE='true')
    sync.main(['members'], legacy=Legacy())
    data = fake.staged[0]['data']
    assert data['email'] == 'member-1001@example.invalid' and 'Zora' not in str(data)


def test_missing_settings_stop_the_layer(world, monkeypatch, capsys):
    set_env(monkeypatch, INTEGRATION_MODE='layer', WEBLING_EMAIL=None)
    assert sync.main(['events'], legacy=Legacy()) == 1
    assert 'Please export WEBLING_EMAIL' in capsys.readouterr().out


def test_list_in_layer_mode(world, monkeypatch, capsys):
    world.calendars = {501: {'title': 'Judo Agenda', 'events': []}}
    monkeypatch.setenv('INTEGRATION_MODE', 'layer')
    assert sync.main(['list'], legacy=Legacy()) == 0
    assert '  - 501: Judo Agenda' in capsys.readouterr().out


def test_calendar_is_for_events_only(world):
    assert sync.main(['members', '--calendar', '1'], legacy=Legacy()) == 2


def run_process(args, env):
    return subprocess.run([sys.executable, *args], env=env, capture_output=True, text=True,
                          cwd=SRC.parent, timeout=60)


@pytest.mark.parametrize('script, kind, missing', [
    ('webling.py', 'members', 'WEBLING_DOMAIN'),
    ('webling.py', 'members', 'ANONYMIZE'),
    ('events.py', 'events', 'WEBLING_PASSWORD'),
])
def test_legacy_mode_keeps_the_exit_status_and_errors(script, kind, missing):
    # A real process each: sync.py in legacy mode runs the script itself,
    # so a missing setting stops it exactly as before (no network: the
    # scripts stop before any call)
    env = {k: v for k, v in {**os.environ, **ENV}.items() if k != missing}
    env.pop('INTEGRATION_MODE', None)
    direct = run_process([f'src/{script}'], env)
    wrapped = run_process(['src/sync.py', kind], env)
    assert direct.returncode == wrapped.returncode == 1
    assert direct.stderr == wrapped.stderr
    assert f'Please export {missing}' in wrapped.stderr
    assert wrapped.stdout == 'Mode: legacy\n' + direct.stdout


def test_anonymize_is_the_legacy_one(monkeypatch):
    set_env(monkeypatch)
    sys.modules.pop('webling', None)
    import webling
    for member_id in [1000, 1001, 4711, 99999, 9999999]:
        for birthday in ['2010-04-01', None, '', 'unbekannt', '1.2.1990']:
            data = {'id': member_id, 'firstname': 'Zora', 'lastname': 'Geheimname',
                    'birthday': birthday, 'mobile': '079', 'labels': ['Aktiv'], 'email': 'z@x.ch'}
            legacy = webling.anonymize(member_id, dict(data))
            assert anonymize(str(member_id), data) == legacy
