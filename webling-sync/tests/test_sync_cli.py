"""sync.py: options, the environment, and the real process."""
import os
import subprocess
import sys

import pytest

import sync
from fake_layer import FakeLayer
from fake_world import ENV, SRC, World, set_env
from integration.anonymize import anonymize


@pytest.fixture
def world(monkeypatch):
    set_env(monkeypatch, INTEGRATION_DRY_RUN=None, INTEGRATION_TRIGGER=None, INTEGRATION_RUNNER=None)
    return World().install(monkeypatch)


def test_run_options_from_the_environment(world, monkeypatch):
    fake = FakeLayer(world)
    set_env(monkeypatch, INTEGRATION_DRY_RUN='true',
            INTEGRATION_TRIGGER='schedule', INTEGRATION_RUNNER='github:4242',
            WEBLING_ACCEPT_GONE='60', WEBLING_ACCEPT_STATUS_DROP=' ', WEBLING_ACCEPT_STATUS_GAIN='7',
            WEBLING_ACCEPT_EVENTS_GONE='9')
    sync.main(['members'])
    assert fake.begun[0]['p_options'] == {'scope': {'complete': True}, 'dry_run': True,
                                          'trigger': 'schedule', 'runner': 'github:4242'}
    assert fake.applied[0]['p_options'] == {'accept_gone': 60, 'accept_status_gain': 7}
    world.calendars = {501: {'title': 'Judo Agenda', 'events': []}}
    sync.main(['events'])
    assert fake.applied[1]['p_options'] == {'accept_events_gone': 9}


def test_trigger_defaults_to_manual(world, monkeypatch):
    fake = FakeLayer(world)
    set_env(monkeypatch, INTEGRATION_TRIGGER='app')
    sync.main(['members'])
    assert fake.begun[0]['p_options']['trigger'] == 'manual'
    assert 'runner' not in fake.begun[0]['p_options']


def test_anonymize_is_required_for_members(world, monkeypatch, capsys):
    FakeLayer(world)
    set_env(monkeypatch, ANONYMIZE=None)
    assert sync.main(['members']) == 1
    assert 'Please export ANONYMIZE' in capsys.readouterr().out


def test_dev_gets_fake_members(world, monkeypatch):
    fake = FakeLayer(world)
    world.groups = {10: 'Aktiv'}
    world.members = [{'id': 1001, 'parents': [10], 'properties': {
        'Vorname': 'Zora', 'Name': 'Geheimname', 'Geburtstag': '1990-05-06', 'Mobile': '079',
        'E-Mail': 'zora@example.com'}}]
    set_env(monkeypatch, ANONYMIZE='true')
    sync.main(['members'])
    data = fake.staged[0]['data']
    assert data['email'] == 'member-1001@example.invalid' and 'Zora' not in str(data)


@pytest.mark.parametrize('member_id, birthday, fake', [
    ('4711', '2010-04-01', ('Clara', 'Ersatz 4711', '2010-05-03')),
    ('1001', '1.2.1990', ('Felix', 'Skizze 1001', '1990-09-15')),
    ('1001', None, ('Felix', 'Skizze 1001', None)),
    ('99999', 'unbekannt', ('Ben', 'Beispiel 99999', None)),
])
def test_fake_members_stay_the_same(member_id, birthday, fake):
    # The values dev's fake members already have: a change would rename them all
    data = {'firstname': 'Zora', 'lastname': 'Geheimname', 'birthday': birthday, 'mobile': '079',
            'email': 'zora@example.com', 'groups': [{'id': '10', 'name': 'Aktiv'}]}
    assert anonymize(member_id, data) == {
        'firstname': fake[0], 'lastname': fake[1], 'birthday': fake[2], 'mobile': None,
        'email': f'member-{member_id}@example.invalid', 'groups': [{'id': '10', 'name': 'Aktiv'}]}


def test_missing_settings_stop_the_layer(world, monkeypatch, capsys):
    set_env(monkeypatch, WEBLING_EMAIL=None)
    assert sync.main(['events']) == 1
    assert 'Please export WEBLING_EMAIL' in capsys.readouterr().out


def test_list_shows_calendar_ids(world, capsys):
    world.calendars = {501: {'title': 'Judo Agenda', 'events': []}}
    assert sync.main(['list']) == 0
    assert '  - 501: Judo Agenda' in capsys.readouterr().out


def test_calendar_is_for_events_only(world):
    assert sync.main(['members', '--calendar', '1']) == 2


def test_real_process(world):
    # python src/sync.py as the workflow runs it (no network: the run stops
    # at the missing setting, before any call)
    env = {k: v for k, v in {**os.environ, **ENV}.items() if k != 'WEBLING_DOMAIN'}
    done = subprocess.run([sys.executable, 'src/sync.py', 'members'], env=env, capture_output=True,
                          text=True, cwd=SRC.parent, timeout=60)
    assert done.returncode == 1
    assert done.stdout.splitlines() == ['Layer members', 'Error: Please export WEBLING_DOMAIN']
    assert done.stderr == ''
