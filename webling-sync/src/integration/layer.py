"""The four calls of the integration layer (docs/INTEGRATIONS.md, phase 2).

    begin(connection, kind, scope, ...) -> Run
    Run.stage(records)    chunks of 500, keys filtered to the capabilities
    Run.apply(accept)     identity, mapping, guards, writes (one transaction)
    Run.finish(report)    closes the run, deletes the staged records

Arguments only ever grow inside the jsonb options (never new parameters),
and records only carry the keys integration_begin lists in its
capabilities, so a newer adapter never sends what an older database would
not understand.
"""
from integration.client import ClientError

# Records per integration_stage call: the database takes up to 1000
# (capabilities.max_records_per_call); half keeps each request small
CHUNK = 500

CAPABILITY_KEYS = {'members': 'member_keys', 'events': 'event_keys'}


class LayerError(Exception):
    """A call the layer refused or failed (code and message only)."""

    def __init__(self, step, detail, code=None):
        super().__init__(f"integration_{step}: {detail}")
        self.step = step
        self.code = code


def _call(client, step, args):
    try:
        reply = client.rpc(f'integration_{step}', args)
    except ClientError as err:
        raise LayerError(step, str(err), 'network') from None
    if reply.kind != 'ok':
        raise LayerError(step, reply.error, reply.code)
    if not isinstance(reply.body, dict):
        raise LayerError(step, 'unexpected answer')
    return reply.body


class Layer:
    def __init__(self, client):
        self.client = client

    def begin(self, connection, kind, scope, dry_run=False, trigger='manual', runner=None):
        """Opens a run and returns it. Anything else raises LayerError:
        NOT_ALLOWED, RUN_IN_PROGRESS, ..., and a database without
        integration_begin (404 PGRST202 or 42883), which has no layer to
        sync through (no fallback since phase 3c)."""
        options = {'scope': scope, 'dry_run': bool(dry_run), 'trigger': trigger}
        if runner:
            options['runner'] = runner
        args = {'p_connection': connection, 'p_kind': kind, 'p_options': options}
        try:
            reply = self.client.rpc('integration_begin', args)
        except ClientError as err:
            raise LayerError('begin', str(err), 'network') from None
        if reply.kind == 'missing':
            # Status, code and the function's name only: log-safe
            raise LayerError('begin', f"the integration layer is not on this database ({reply.error})",
                             reply.code)
        if reply.kind != 'ok':
            raise LayerError('begin', reply.error, reply.code)
        if not isinstance(reply.body, dict) or not isinstance(reply.body.get('run'), int):
            raise LayerError('begin', 'unexpected answer')
        return Run(self.client, reply.body)


class Run:
    """An open run (integration_begin's answer)."""

    def __init__(self, client, begun):
        self.client = client
        self.id = begun['run']
        self.kind = begun.get('kind')
        self.scope = begun.get('scope') or {}
        self.today = begun.get('today')
        self.settings = begun.get('settings') or {}
        self.capabilities = begun.get('capabilities') or {}
        self.dry_run = None

    @property
    def version(self):
        version = self.capabilities.get('version')
        return version if isinstance(version, int) else 0

    def allowed_keys(self):
        keys = self.capabilities.get(CAPABILITY_KEYS.get(self.kind, ''))
        return {k for k in keys if isinstance(k, str)} if isinstance(keys, list) else set()

    def chunk_size(self):
        limit = self.capabilities.get('max_records_per_call')
        return min(CHUNK, limit) if isinstance(limit, int) and limit > 0 else CHUNK

    def prepare(self, records):
        """The records as staged: external_id and data, with only the data
        keys this database understands. Returns (records, dropped key
        names)."""
        allowed = self.allowed_keys()
        if not allowed:
            raise LayerError('stage', f'no record keys for {self.kind} in the capabilities')
        dropped = set()
        out = []
        for record in records:
            data = record.get('data') or {}
            dropped.update(k for k in data if k not in allowed)
            out.append({'external_id': record['external_id'],
                        'data': {k: v for k, v in data.items() if k in allowed}})
        return out, sorted(dropped)

    def stage(self, records):
        """Stages every record, CHUNK per call. Returns {staged, invalid,
        calls, dropped_keys}."""
        prepared, dropped = self.prepare(records)
        size = self.chunk_size()
        totals = {'staged': 0, 'invalid': 0, 'calls': 0, 'dropped_keys': dropped}
        for start in range(0, len(prepared), size):
            body = _call(self.client, 'stage',
                         {'p_run': self.id, 'p_records': prepared[start:start + size]})
            totals['calls'] += 1
            for key in ('staged', 'invalid'):
                if isinstance(body.get(key), int):
                    totals[key] += body[key]
        return totals

    def apply(self, accept=None):
        """Applies the staged records. accept: {accept_gone, ...} with the
        exact numbers of an earlier refusal; unset ones are not sent."""
        options = {k: v for k, v in (accept or {}).items() if isinstance(v, int) and not isinstance(v, bool)}
        body = _call(self.client, 'apply', {'p_run': self.id, 'p_options': options})
        self.dry_run = body.get('dry_run')
        return body

    def finish(self, report):
        """Closes the run with the adapter's report {errors, counters,
        error}. Returns {run, status: ok|warning|refused|failed, ...}."""
        return _call(self.client, 'finish', {'p_run': self.id, 'p_report': report})
