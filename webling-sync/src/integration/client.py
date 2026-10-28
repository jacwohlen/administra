"""Supabase REST for the integration layer: rpc() with the service role key.

PostgREST answers POST /rest/v1/rpc/<function> with the function's JSON
result, or an error {code, message, details, hint} with an HTTP status
(42501 -> 403, P0001/22023 -> 400, PT409 -> 409, a missing function ->
404 PGRST202). The transport is swappable, so a test can call the SQL
functions directly (tests/psql_transport.py).
"""
import json

import requests

from integration.safe_log import postgrest_error

# A function or table this database does not have (yet): PostgREST's schema
# cache misses (PGRST202 function, PGRST205 table) and Postgres' own codes.
# Only integration_begin acts on it (the layer is not here: fall back);
# anywhere later in a run it is an error like any other.
MISSING_CODES = ('PGRST202', 'PGRST205', '42883', '42P01')


def auth_headers(key):
    """New secret keys (sb_secret_...) are not JWTs: Supabase rejects them
    in the Authorization header, so they only go in apikey. Legacy
    service_role JWTs are sent in both (as the legacy scripts do)."""
    headers = {'apikey': key}
    if not key.startswith('sb_'):
        headers['Authorization'] = f"Bearer {key}"
    return headers


def classify(status_code, body):
    """'ok', 'missing' (the function or table is not on this database),
    'conflict' (409, e.g. RUN_IN_PROGRESS) or 'error'."""
    if 200 <= status_code < 300:
        return 'ok'
    code = body.get('code') if isinstance(body, dict) else None
    if status_code == 404 and code in MISSING_CODES:
        return 'missing'
    if status_code == 409:
        return 'conflict'
    return 'error'


class ClientError(Exception):
    """A call that got no answer; the message holds the call and the
    exception's type only (its text holds the URL)."""


class Reply:
    """An answer: kind (see classify), the JSON body, and a log-safe
    description (status, code and message, never details or values)."""

    def __init__(self, response):
        self.status_code = response.status_code
        try:
            self.body = response.json()
        except ValueError:
            self.body = None
        self.kind = classify(self.status_code, self.body)
        self.code = self.body.get('code') if isinstance(self.body, dict) else None
        self.error = None if self.kind == 'ok' else postgrest_error(response)


def requests_transport(timeout=(10, 300)):
    """The real transport: one POST per call. The apply of a whole club
    takes about a second; the read timeout only stops a hung connection."""
    def post(url, headers, body):
        return requests.post(url, headers=headers, data=json.dumps(body), timeout=timeout)
    return post


class Client:
    def __init__(self, url, key, transport=None):
        self.url = url.rstrip('/')
        self.headers = {**auth_headers(key), 'Content-Type': 'application/json'}
        self.transport = transport or requests_transport()

    def rpc(self, name, args):
        """POST rpc/<name> with named arguments. Returns a Reply; a network
        error raises ClientError (type only, see safe_log.py)."""
        try:
            response = self.transport(f"{self.url}/rest/v1/rpc/{name}", self.headers, args)
        except requests.RequestException as err:
            raise ClientError(f"Supabase POST rpc/{name}: {type(err).__name__}") from None
        return Reply(response)
