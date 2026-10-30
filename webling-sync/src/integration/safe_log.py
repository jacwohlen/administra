"""Helpers that keep personal data and secrets out of the sync's logs.

The logs are public: the repository is public, and so are its GitHub
Actions logs. Counts, ids and codes only, never a name, a title, or:

- a response body. Webling answers with member data, and PostgREST puts
  the whole row into constraint errors ("Failing row contains (...)"), so
  failed layer calls are shortened by postgrest_error().
- a Webling URL: the API key is a query parameter. Exceptions from
  requests (HTTPError, ConnectionError, ...) contain the full URL, so
  Webling calls raise WeblingError without it (webling_adapter/api.py).
- the message of an unexpected exception (it may quote a value):
  crash_line() prints its type and where it was raised.
"""
import re
import traceback

__all__ = ['postgrest_error', 'crash_line']


def crash_line(err):
    """An unexpected exception without its message (it may quote a value):
    its type and where it was raised, e.g. 'KeyError at members.py:41'."""
    frames = traceback.extract_tb(err.__traceback__)
    if not frames:
        return type(err).__name__
    last = frames[-1]
    return f"{type(err).__name__} at {last.filename.rsplit('/', 1)[-1]}:{last.lineno}"


# A PostgreSQL message may quote a rejected value, e.g.
# 'invalid input syntax for type date: "1.2.1990"'
QUOTED_VALUE = re.compile(r'(invalid input (?:syntax|value) for [^:]*): .*', re.IGNORECASE)
FAILING_ROW = re.compile(r'\s*Failing row contains .*', re.IGNORECASE | re.DOTALL)


def postgrest_error(response):
    """Status, error code and message of a failed PostgREST call.

    PostgREST answers {"code", "message", "details", "hint"}. "details" holds
    the row or key values ("Failing row contains (...)", "Key (email)=(...)
    already exists"), so only code and message are kept.
    """
    try:
        body = response.json()
    except ValueError:
        body = None
    if not isinstance(body, dict):
        return f"HTTP {response.status_code}"
    code = body.get('code') or '-'
    message = str(body.get('message') or '')
    message = FAILING_ROW.sub('', message)
    message = QUOTED_VALUE.sub(r'\1: [value]', message)
    return f"HTTP {response.status_code} {code}: {message}".rstrip(': ')
