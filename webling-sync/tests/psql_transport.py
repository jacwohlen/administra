"""A transport for integration.client that calls the layer's SQL functions
through psql instead of PostgREST, as PostgREST would: one transaction per
call, role service_role, request.jwt.claims set, and PostgREST's mapping
from SQLSTATE to HTTP status (42501 -> 403, P0001 -> 400, PTnnn -> nnn,
42883 -> 404, ...). For tests against a local database only."""
import json
import re
import shlex
import subprocess

from fake_world import Response

ERROR = re.compile(r'ERROR:\s+([0-9A-Z]{5}): (.*)')


def literal(value):
    if isinstance(value, bool):
        return 'true' if value else 'false'
    if isinstance(value, int):
        return str(value)
    if isinstance(value, str):
        return "'" + value.replace("'", "''") + "'"
    return "'" + json.dumps(value).replace("'", "''") + "'::jsonb"


def http_status(code):
    """PostgREST's status for a Postgres error (Error.hs, v12)."""
    if code == '42501':
        return 403
    if code in ('42883', '42P01'):
        return 404
    if code.startswith('PT') and code[2:].isdigit():
        return int(code[2:])
    if code in ('23503', '23505'):
        return 409
    if code.startswith(('08', '53')):
        return 503
    if code.startswith(('25', '2D', '38', '39', '3B', '40', '54', '55', '57', '58', 'F0', 'HV', 'XX')) \
            or (code.startswith('P0') and code != 'P0001'):
        return 500
    return 400


class PsqlTransport:
    """command: how to start psql on the database, reading SQL from stdin
    (e.g. 'psql postgresql://postgres:postgres@127.0.0.1:54322/postgres')."""

    def __init__(self, command):
        self.command = shlex.split(command)
        self.calls = []

    def sql(self, statement, role=True):
        script = "\\set VERBOSITY verbose\nSET client_encoding = 'UTF8';\n"
        if role:
            script += ("SELECT set_config('request.jwt.claims', '{\"role\": \"service_role\"}', false);\n"
                       "SET ROLE service_role;\n")
        script += statement + "\n"
        return subprocess.run(self.command + ['-At', '-q', '-v', 'ON_ERROR_STOP=1'], input=script,
                              capture_output=True, text=True, timeout=120)

    def query(self, statement):
        """Rows of a query as the database owner (test setup and checks)."""
        done = self.sql(statement, role=False)
        if done.returncode != 0:
            raise RuntimeError(done.stderr)
        return [line for line in done.stdout.splitlines() if line]

    def __call__(self, url, headers, body):
        name = url.rsplit('/rpc/', 1)[1]
        self.calls.append(name)
        args = ', '.join(f"{key} := {literal(value)}" for key, value in body.items())
        done = self.sql(f"SELECT public.{name}({args})::text;")
        if done.returncode == 0:
            lines = [line for line in done.stdout.splitlines() if line]
            return Response(200, json.loads(lines[-1]))
        match = ERROR.search(done.stderr)
        if not match:
            return Response(500, {'code': 'XX000', 'message': 'psql failed'})
        code, message = match.groups()
        return Response(http_status(code), {'code': code, 'message': message})
