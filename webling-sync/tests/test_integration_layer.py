"""integration.client and integration.layer against a fake Supabase."""
import json

import pytest
import requests

from fake_layer import CAPABILITIES, FakeLayer
from fake_world import Response, World
from integration.client import Client, ClientError, auth_headers, classify
from integration.layer import Layer, LayerError


@pytest.mark.parametrize('status, body, kind', [
    (200, {'run': 1}, 'ok'),
    (204, None, 'ok'),
    (404, {'code': 'PGRST202', 'message': 'Could not find the function'}, 'missing'),
    (404, {'code': 'PGRST205', 'message': 'Could not find the table'}, 'missing'),
    (404, {'code': '42883', 'message': 'function does not exist'}, 'missing'),
    (404, {'code': '42P01', 'message': 'relation does not exist'}, 'missing'),
    (404, {'code': 'PGRST116', 'message': 'no rows'}, 'error'),
    (404, None, 'error'),
    (400, {'code': 'PGRST202'}, 'error'),
    (409, {'code': 'PT409', 'message': 'RUN_IN_PROGRESS'}, 'conflict'),
    (403, {'code': '42501', 'message': 'NOT_ALLOWED'}, 'error'),
    (400, {'code': 'P0001', 'message': 'UNKNOWN_CONNECTION'}, 'error'),
    (400, {'code': '22023', 'message': 'invalid kind'}, 'error'),
    (500, None, 'error'),
])
def test_classify(status, body, kind):
    assert classify(status, body) == kind


def test_auth_headers():
    # Secret keys are not JWTs: apikey only. Legacy JWTs go in both.
    assert auth_headers('sb_secret_x') == {'apikey': 'sb_secret_x'}
    assert auth_headers('eyJ.jwt') == {'apikey': 'eyJ.jwt', 'Authorization': 'Bearer eyJ.jwt'}


def transport(answers, calls=None):
    calls = calls if calls is not None else []

    def post(url, headers, body):
        calls.append((url, headers, json.loads(json.dumps(body))))
        answer = answers.pop(0)
        if isinstance(answer, Exception):
            raise answer
        return answer
    return post


def test_rpc_posts_named_arguments():
    calls = []
    client = Client('https://db.example/', 'sb_secret_x', transport([Response(200, {'run': 7})], calls))
    reply = client.rpc('integration_begin', {'p_connection': 'webling'})
    assert reply.kind == 'ok' and reply.body == {'run': 7}
    url, headers, body = calls[0]
    assert url == 'https://db.example/rest/v1/rpc/integration_begin'
    assert headers == {'apikey': 'sb_secret_x', 'Content-Type': 'application/json'}
    assert body == {'p_connection': 'webling'}


def test_network_error_has_the_type_only():
    err = requests.ConnectionError('Max retries exceeded with url: https://db.example/rest/v1/rpc/x')
    client = Client('https://db.example', 'sb_secret_x', transport([err]))
    with pytest.raises(ClientError) as raised:
        client.rpc('integration_stage', {})
    assert str(raised.value) == 'Supabase POST rpc/integration_stage: ConnectionError'
    assert raised.value.__suppress_context__


def test_error_reply_never_holds_details():
    answer = Response(400, {'code': '23514', 'message': 'new row violates check constraint',
                            'details': 'Failing row contains (Zora, Geheimname).'})
    reply = Client('https://db.example', 'k', transport([answer])).rpc('integration_apply', {})
    assert reply.kind == 'error'
    assert reply.error == 'HTTP 400 23514: new row violates check constraint'


def layer_with(world):
    return Layer(Client('https://db.example', 'sb_secret_test'))


@pytest.fixture
def world(monkeypatch):
    return World().install(monkeypatch)


def test_begin_sends_scope_and_options(world):
    fake = FakeLayer(world)
    run = layer_with(world).begin('webling', 'members', {'complete': True}, dry_run=True,
                                  trigger='schedule', runner='github:123')
    assert run.id == 41 and run.today == '2026-10-28' and run.version == 1
    assert fake.begun == [{'p_connection': 'webling', 'p_kind': 'members', 'p_options': {
        'scope': {'complete': True}, 'dry_run': True, 'trigger': 'schedule', 'runner': 'github:123'}}]


def test_begin_without_runner_leaves_it_out(world):
    fake = FakeLayer(world)
    layer_with(world).begin('webling', 'events', {'complete': False})
    assert 'runner' not in fake.begun[0]['p_options']


@pytest.mark.parametrize('code', ['PGRST202', '42883'])
def test_begin_on_a_database_without_the_layer(world, code):
    # The function is missing: an error that says so (no fallback since phase 3c)
    world.rpc.clear()
    if code == '42883':
        world.rpc['integration_begin'] = lambda body: Response(404, {'code': '42883', 'message': 'x'})
    with pytest.raises(LayerError) as raised:
        layer_with(world).begin('webling', 'members', {'complete': True})
    assert raised.value.code == code
    assert str(raised.value).startswith(
        f'integration_begin: the integration layer is not on this database (HTTP 404 {code}: ')


@pytest.mark.parametrize('answer, code', [
    (Response(403, {'code': '42501', 'message': 'NOT_ALLOWED'}), '42501'),
    (Response(409, {'code': 'PT409', 'message': 'RUN_IN_PROGRESS'}), 'PT409'),
    (Response(400, {'code': 'P0001', 'message': 'UNKNOWN_CONNECTION'}), 'P0001'),
    (Response(200, {'no': 'run'}), None),
])
def test_begin_errors_raise(world, answer, code):
    FakeLayer(world, fail={'begin': answer})
    with pytest.raises(LayerError) as raised:
        layer_with(world).begin('webling', 'members', {'complete': True})
    assert raised.value.code == code


def records(n, **extra):
    return [{'external_id': str(1000 + i), 'data': {'lastname': 'X', 'firstname': 'Y', **extra}}
            for i in range(n)]


def test_stage_chunks_500(world):
    fake = FakeLayer(world)
    run = layer_with(world).begin('webling', 'members', {'complete': True})
    totals = run.stage(records(1234))
    assert [len(c['p_records']) for c in fake.stage_calls] == [500, 500, 234]
    assert all(c['p_run'] == 41 for c in fake.stage_calls)
    assert totals == {'staged': 1234, 'invalid': 0, 'calls': 3, 'dropped_keys': []}


def test_stage_follows_a_smaller_database_limit(world):
    fake = FakeLayer(world, capabilities={**CAPABILITIES, 'max_records_per_call': 300})
    run = layer_with(world).begin('webling', 'members', {'complete': True})
    run.stage(records(700))
    assert [len(c['p_records']) for c in fake.stage_calls] == [300, 300, 100]


def test_stage_sends_only_the_keys_the_database_knows(world):
    fake = FakeLayer(world, capabilities={**CAPABILITIES, 'member_keys': ['firstname', 'lastname']})
    run = layer_with(world).begin('webling', 'members', {'complete': True})
    totals = run.stage(records(2, birthday='2001-01-01', all_day=True))
    assert fake.staged[0] == {'external_id': '1000', 'data': {'lastname': 'X', 'firstname': 'Y'}}
    assert totals['dropped_keys'] == ['all_day', 'birthday']


def test_events_use_the_event_keys(world):
    fake = FakeLayer(world)
    run = layer_with(world).begin('webling', 'events', {'complete': True, 'calendars': []})
    run.stage([{'external_id': '7', 'data': {'title': 'T', 'firstname': 'no', 'all_day': True}}])
    assert fake.staged[0]['data'] == {'title': 'T'}


def test_stage_without_capabilities_is_an_error(world):
    FakeLayer(world, capabilities={'version': 1})
    run = layer_with(world).begin('webling', 'members', {'complete': True})
    with pytest.raises(LayerError):
        run.stage(records(1))


def test_a_missing_function_mid_run_is_an_error(world):
    # Only begin calls a missing function a missing layer; later it is an
    # error like any other
    FakeLayer(world, fail={'stage': Response(404, {'code': 'PGRST202', 'message': 'gone'})})
    run = layer_with(world).begin('webling', 'members', {'complete': True})
    with pytest.raises(LayerError) as raised:
        run.stage(records(1))
    assert raised.value.code == 'PGRST202'


def test_apply_sends_only_the_overrides_set(world):
    fake = FakeLayer(world)
    run = layer_with(world).begin('webling', 'members', {'complete': True})
    run.stage(records(1))
    run.apply({'accept_gone': 60, 'accept_status_drop': None, 'accept_status_gain': True})
    assert fake.applied == [{'p_run': 41, 'p_options': {'accept_gone': 60}}]


def test_finish_sends_the_report(world):
    fake = FakeLayer(world)
    run = layer_with(world).begin('webling', 'members', {'complete': True})
    run.stage(records(1))
    run.apply()
    finished = run.finish({'errors': 0, 'counters': {'members': 1}})
    assert finished['status'] == 'ok'
    assert fake.finished == [{'p_run': 41, 'p_report': {'errors': 0, 'counters': {'members': 1}}}]
