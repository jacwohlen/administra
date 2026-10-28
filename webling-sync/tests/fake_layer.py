"""A fake integration layer: integration_begin/stage/apply/finish as RPC
handlers of fake_world.World, with the answers of the real functions'
contract (C3 in the phase 2 plan, supabase/migrations/20261029120000_*)."""
import copy

from fake_world import Response

CAPABILITIES = {
    'version': 1,
    'member_keys': ['firstname', 'lastname', 'birthday', 'mobile', 'email', 'groups', 'link_to',
                    'problem'],
    'event_keys': ['calendar', 'title', 'starts_on', 'ends_on', 'time_from', 'time_to', 'location',
                   'max_participants', 'description', 'url', 'cancelled', 'participants', 'problem'],
    'calendar_targets': ['event', 'break', 'ignore'],
    'max_records_per_call': 1000,
}

MEMBER_RESULT = {'received': 0, 'inserted': 0, 'adopted': 0, 'revived': 0, 'updated': 0,
                 'unchanged': 0, 'invalid': 0, 'conflicts': 0, 'held': 0, 'write_failed': 0,
                 'gone': 0, 'former': 0, 'statuses_recomputed': 0,
                 'issues': {'noted': 0, 'resolved': 0, 'open': 0}}


class FakeLayer:
    """apply answers `apply_answer` (status applied unless set otherwise);
    a step in `fail` answers that Response instead."""

    def __init__(self, world, run_id=41, today='2026-10-28', apply_answer=None, fail=None,
                 capabilities=None):
        self.run_id = run_id
        self.today = today
        self.apply_answer = apply_answer or {}
        self.fail = fail or {}
        self.capabilities = capabilities or CAPABILITIES
        self.begun = []
        self.staged = []
        self.stage_calls = []
        self.applied = []
        self.finished = []
        for step in ('begin', 'stage', 'apply', 'finish'):
            world.rpc[f'integration_{step}'] = getattr(self, step)

    def answer(self, step, body):
        if step in self.fail:
            failure = self.fail[step]
            return failure(body) if callable(failure) else failure
        return None

    def begin(self, body):
        self.begun.append(body)
        failed = self.answer('begin', body)
        if failed:
            return failed
        scope = dict(body['p_options']['scope'])
        if body['p_kind'] == 'events':
            scope.setdefault('from', self.today[:4] + '-01-01')
            scope.setdefault('calendars', [])
        self.kind = body['p_kind']
        self.dry_run = body['p_options'].get('dry_run', False)
        self.status, self.result, self.staged = 'running', {}, []
        return Response(200, {'run': self.run_id, 'kind': body['p_kind'], 'scope': scope,
                              'today': self.today,
                              'settings': {'participant_state_property': '594',
                                           'participant_note': 'Imported from Webling - Confirmed: confirmed'},
                              'capabilities': copy.deepcopy(self.capabilities)})

    def stage(self, body):
        self.stage_calls.append(body)
        failed = self.answer('stage', body)
        if failed:
            return failed
        records = body['p_records']
        self.staged.extend(records)
        return Response(200, {'staged': len(records),
                              'invalid': sum(1 for r in records if 'problem' in r['data'])})

    def apply(self, body):
        self.applied.append(body)
        failed = self.answer('apply', body)
        if failed:
            return failed
        result = dict(MEMBER_RESULT, received=len(self.staged), unchanged=len(self.staged))
        answer = {'run': self.run_id, 'status': 'applied', 'dry_run': self.dry_run, 'result': result,
                  'guard': {'new_catalog_rows': 0}, 'accepted': {}, 'error': None, 'hint': None}
        answer.update(copy.deepcopy(self.apply_answer))
        self.status = answer['status']
        self.result = answer['result']
        return Response(200, answer)

    def finish(self, body):
        self.finished.append(body)
        failed = self.answer('finish', body)
        if failed:
            return failed
        report = body['p_report']
        status = getattr(self, 'status', 'running')
        result = getattr(self, 'result', {})
        problems = sum(result.get(k, 0) for k in ('conflicts', 'held', 'write_failed'))
        if self.kind == 'members':
            problems += result.get('invalid', 0)
        if status == 'applied':
            final = 'warning' if report.get('errors') or problems or report.get('error') else 'ok'
        elif status == 'refused':
            final = 'refused'
        else:
            final = 'failed'
        return Response(200, {'run': self.run_id, 'status': final, 'dry_run': self.dry_run,
                              'error': report.get('error')})
