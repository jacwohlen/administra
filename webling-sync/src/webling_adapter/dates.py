"""Webling's date-times: 'YYYY-MM-DD HH:MM:SS' in the club's local time,
taken as they are (never converted between time zones)."""
from collections import namedtuple
from datetime import datetime

# Webling keeps an unset date as the epoch (1970-01-01 00:00): such an
# event has no date. The layer counts it as seen and notes it as info.
FIRST_REAL_YEAR = 1971

When = namedtuple('When', 'date time problem')


def split(value):
    """(date 'YYYY-MM-DD', time 'HH:MM', problem): problem 'no_date' for an
    unset date (missing, empty, before 1971), 'invalid_date' for one that
    cannot be read. End dates (ends_on, all-day) follow in phase 4, sent
    only to a database whose capabilities have version 2."""
    if value is None or value == '':
        return When(None, None, 'no_date')
    try:
        moment = datetime.fromisoformat(value)
    except (TypeError, ValueError):
        return When(None, None, 'invalid_date')
    if moment.year < FIRST_REAL_YEAR:
        return When(None, None, 'no_date')
    return When(moment.strftime('%Y-%m-%d'), moment.strftime('%H:%M'), None)
