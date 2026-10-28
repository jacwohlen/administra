"""Log helpers of the layer path (the rules are in src/safe_log.py).

The logs are public (GitHub Actions of a public repository): counts, ids
and codes only, never a response body, a name, a title or a URL with a key.
postgrest_error() is re-exported from the legacy helper, so both paths
shorten PostgREST errors the same way until the legacy scripts go (PR 3c).
"""
import traceback

from safe_log import postgrest_error

__all__ = ['postgrest_error', 'crash_line']


def crash_line(err):
    """An unexpected exception without its message (it may quote a value):
    its type and where it was raised, e.g. 'KeyError at members.py:41'."""
    frames = traceback.extract_tb(err.__traceback__)
    if not frames:
        return type(err).__name__
    last = frames[-1]
    return f"{type(err).__name__} at {last.filename.rsplit('/', 1)[-1]}:{last.lineno}"
