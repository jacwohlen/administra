"""
Helpers that keep personal data and secrets out of the sync's logs.

The logs are public: the repository is public, and so are its GitHub Actions
logs. Local runs write them to logs/*.log, where GitHub's secret masking does
not apply either. So:

- Never log a response body. Webling answers with member data, and PostgREST
  puts the whole row into constraint errors ("Failing row contains (...)").
- Never log a Webling URL: the API key is a query parameter. Exceptions from
  requests (HTTPError, ConnectionError, ...) contain the full URL, so Webling
  calls go through webling_get(), which raises WeblingError without it.
"""
import re

import requests


class WeblingError(Exception):
    """A failed Webling call; the message holds method, path and status only."""


def webling_get(domain, api_key, path, **params):
    """GET https://<domain>.webling.ch/api/1/<path> with the API key.

    Returns the response like requests.get(). A network error is raised as
    WeblingError without the URL (and so without the API key).
    """
    url = f"https://{domain}.webling.ch/api/1/{path}"
    try:
        return requests.get(url, params={'apikey': api_key, **params})
    except requests.RequestException as e:
        # "from None": the original exception (with the URL) is not printed
        raise WeblingError(f"Webling GET /api/1/{path} failed: {type(e).__name__}") from None


def webling_check(response, path):
    """Like response.raise_for_status(), but without the URL in the message."""
    if not response.ok:
        raise WeblingError(f"Webling GET /api/1/{path} failed: HTTP {response.status_code}")


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
