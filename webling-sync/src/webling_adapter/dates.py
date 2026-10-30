"""Webling's date-times: 'YYYY-MM-DD HH:MM:SS' in the club's local time,
taken as they are (never converted between time zones)."""
from collections import namedtuple
from datetime import date, datetime, timedelta

# Webling keeps an unset date as the epoch (1970-01-01 00:00): such an
# event has no date. The layer counts it as seen and notes it as info.
FIRST_REAL_YEAR = 1971

# Webling's all-day flag of a calendar event, when it sends one (a JSON
# boolean); without it an entry from 00:00 to 00:00 (or without an end) is
# all day, which is how the sync wrote Webling's all-day entries before the
# layer.
ALL_DAY_PROPERTY = 'isAllDay'


When = namedtuple('When', 'date time problem')
Span = namedtuple('Span', 'ends_on all_day')


def split(value):
    """(date 'YYYY-MM-DD', time 'HH:MM', problem): problem 'no_date' for an
    unset date (missing, empty, before 1971), 'invalid_date' for one that
    cannot be read."""
    if value is None or value == '':
        return When(None, None, 'no_date')
    try:
        moment = datetime.fromisoformat(value)
    except (TypeError, ValueError):
        return When(None, None, 'invalid_date')
    if moment.year < FIRST_REAL_YEAR:
        return When(None, None, 'no_date')
    return When(moment.strftime('%Y-%m-%d'), moment.strftime('%H:%M'), None)


def span(properties, begin, end):
    """(ends_on, all_day) of an event whose begin could be read (split):
    ends_on is the last day when it is after the first, else None (one
    day, also for an end that is unset, unreadable or before the begin).
    An end at midnight belongs to the day before: Webling ends an all-day
    entry at 00:00 of the day after its last day (Karfreitag 03.04. ends on
    '2026-04-04 00:00:00', seen on the first layer run against Webling),
    and a timed event until midnight (19:00 to 00:00) at 00:00 too."""
    flag = properties.get(ALL_DAY_PROPERTY)
    if isinstance(flag, bool):
        all_day = flag
    else:
        all_day = begin.time == '00:00' and (end.problem is not None or end.time == '00:00')
    if end.problem:
        return Span(None, all_day)
    last = end.date
    if end.time == '00:00':
        last = (date.fromisoformat(end.date) - timedelta(days=1)).isoformat()
    return Span(last if last > begin.date else None, all_day)
