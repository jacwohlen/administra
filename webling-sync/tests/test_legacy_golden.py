"""The legacy scripts make exactly the calls they made before the layer.

tests/golden/legacy_calls.json was recorded on the scripts as they were
before phase 3 (commit 2dc1e7d): every HTTP call (method, URL, parameters,
body, headers) and the exit status of each scenario in legacy_scenarios.py,
and the log of the member sync (webling.py is unchanged). events.py only
lost event and calendar titles in its log, so its calls must be the same.

Recording again (only when a legacy script is meant to change):
    UPDATE_GOLDEN=1 pytest tests/test_legacy_golden.py
"""
import json
import os
from pathlib import Path

import pytest

from fake_world import run_script, set_env
from legacy_scenarios import SCENARIOS

GOLDEN = Path(__file__).resolve().parent / 'golden' / 'legacy_calls.json'


def run(name, monkeypatch, capsys):
    script, args, world, env = SCENARIOS[name]()
    set_env(monkeypatch, **env)
    world.install(monkeypatch)
    code = run_script(script, args)
    out = capsys.readouterr()
    return {'exit': code, 'calls': world.calls,
            'stdout': out.out if script == 'webling.py' else None}


@pytest.fixture(scope='module')
def golden():
    if os.environ.get('UPDATE_GOLDEN'):
        return {}
    return json.loads(GOLDEN.read_text())


@pytest.mark.parametrize('name', list(SCENARIOS))
def test_legacy_calls_are_unchanged(name, monkeypatch, capsys, golden):
    got = json.loads(json.dumps(run(name, monkeypatch, capsys)))
    if os.environ.get('UPDATE_GOLDEN'):
        recorded = json.loads(GOLDEN.read_text()) if GOLDEN.exists() else {}
        recorded[name] = got
        GOLDEN.parent.mkdir(exist_ok=True)
        GOLDEN.write_text(json.dumps(recorded, indent=1, ensure_ascii=False, sort_keys=True) + '\n')
        return
    expected = golden[name]
    assert got['exit'] == expected['exit']
    assert len(got['calls']) == len(expected['calls'])
    for i, (call, want) in enumerate(zip(got['calls'], expected['calls'])):
        assert call == want, f'call {i}'
    assert got['stdout'] == expected['stdout']


def test_every_scenario_is_recorded(golden):
    if os.environ.get('UPDATE_GOLDEN'):
        pytest.skip('recording')
    assert set(golden) == set(SCENARIOS)
