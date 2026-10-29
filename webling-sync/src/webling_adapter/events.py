"""Webling calendar events as layer records (integration_stage, kind 'events').

The values: title trimmed ('Untitled Event' when empty), date and start
time from begin, end time from end, place trimmed, the limit, and the
Webling portal link as the link's url. The calendar goes up with its id
and title; the layer's catalog gives the section (or makes the
calendar's entries holidays).

A database whose capabilities have version 2 (phase 4) also gets the last
day (ends_on, see dates.span) and all_day (an all-day event goes up without
times), and no description: the portal link is the link's url, the
description the app's. Version 1 gets the link as description, and
neither of the two.

Registrations: an event not over by today carries its participants as
[{member, state}] (member = the Webling member id, state as Webling has
it); the layer keeps the confirmed ones. participants stays None (the key
is left out: registrations untouched) for past events and whenever the
list could not be read; [] means nobody, and removes the provider's rows.
"""
from collections import namedtuple

from integration.clock import club_today
from webling_adapter import dates
from webling_adapter.api import WeblingError

# Webling property of a participant's state when the connection's settings
# do not name one (participant_state_property, instance-specific)
DEFAULT_STATE_PROPERTY = '594'

Calendar = namedtuple('Calendar', 'id title event_ids')


def portal_link(domain, event_id):
    return f"https://{domain}.webling.ch/portal#/calendar/event/{event_id}"


def calendar_ref(calendar):
    return {'id': str(calendar.id), 'name': calendar.title}


def limit(value):
    """maxParticipants as a number when it is one; anything else goes up as
    it is and the layer notes it as an invalid value (the limit stays)."""
    if isinstance(value, int) and not isinstance(value, bool):
        return value
    if isinstance(value, str) and value.strip().isdigit():
        return int(value.strip())
    return value


def participant_list(objects, state_property):
    """W8 participant objects -> [{member, state}]; participants without a
    member are left out."""
    out = []
    for participant in objects:
        member = (participant.get('links') or {}).get('member')
        if isinstance(member, list):
            member = member[0] if member else None
        if isinstance(member, bool) or not isinstance(member, (int, str)) or not str(member).strip():
            continue
        state = (participant.get('properties') or {}).get(state_property)
        out.append({'member': str(member).strip(), 'state': state if isinstance(state, str) else ''})
    return out


def event_record(event_id, properties, calendar, domain, participants=None, version=1):
    """One W6 event as a record for a database of capabilities `version`.
    A begin Webling left unset ('no_date') or that cannot be read
    ('invalid_date') makes a problem record: seen (so the event is never
    taken as gone), not written."""
    begin = dates.split(properties.get('begin'))
    if begin.problem:
        return {'external_id': str(event_id),
                'data': {'calendar': calendar_ref(calendar), 'problem': begin.problem}}
    end = dates.split(properties.get('end'))
    link = portal_link(domain, event_id)
    title = properties.get('title')
    place = properties.get('place')
    data = {
        'calendar': calendar_ref(calendar),
        'title': (title.strip() if isinstance(title, str) else '') or 'Untitled Event',
        'starts_on': begin.date,
        'time_from': begin.time,
        'time_to': end.time,
        'location': (place.strip() if isinstance(place, str) else None) or None,
        'max_participants': limit(properties.get('maxParticipants')),
        'description': link,
        'url': link,
    }
    if version >= 2:
        ends_on, all_day = dates.span(properties, begin, end)
        data['ends_on'] = ends_on
        data['all_day'] = all_day
        if all_day:
            data['time_from'] = data['time_to'] = None
        del data['description']
    if participants is not None:
        data['participants'] = participants
    return {'external_id': str(event_id), 'data': data}


def problem_record(event_id, calendar, problem):
    return {'external_id': str(event_id), 'data': {'calendar': calendar_ref(calendar), 'problem': problem}}


def calendars(api, selectors, counters):
    """W3 and W4: the calendars this run reads, the fetch errors, and the
    ids of every calendar Webling has (W3).

    selectors: ids or parts of names (case-insensitive), from --calendar;
    none means every calendar. A calendar whose W4 fails is not read, so
    it is left out of the scope (its events cannot go)."""
    ids = api.calendars()
    listed = [str(calendar_id) for calendar_id in ids]
    found, errors = [], 0
    for calendar_id in ids:
        try:
            title, event_ids = api.calendar(calendar_id)
        except WeblingError as err:
            print(f"Error: {err}")
            errors += 1
            continue
        found.append(Calendar(calendar_id, title, event_ids))
    counters['calendars'] = len(ids)
    counters['calendars_read'] = len(found)
    if not selectors:
        return found, errors, listed
    chosen = []
    for selector in selectors:
        for calendar in found:
            if calendar in chosen:
                continue
            if str(calendar.id) == selector.strip() or selector.lower() in calendar.title.lower():
                chosen.append(calendar)
    return chosen, errors, listed


def last_day(properties, begin, version):
    """The day an event ends, for the window and the registrations: its
    last day from version 2 on (a multi-day event under way still counts),
    else its first."""
    if version >= 2:
        return dates.span(properties, begin, dates.split(properties.get('end'))).ends_on or begin.date
    return begin.date


def event_records(api, chosen, run, domain, counters):
    """W6 (or one list call per calendar), W5, W7 and W8: the records of
    the chosen calendars. Events over before the run's window (scope.from,
    January 1 of this year by default) are not sent. Returns (records,
    fetch errors)."""
    # The database's day (Zurich); the runner's clock only if it said none
    today = run.today or club_today().isoformat()
    window = (run.scope or {}).get('from') or f"{today[:4]}-01-01"
    state_property = (run.settings or {}).get('participant_state_property') or DEFAULT_STATE_PROPERTY
    records, errors = [], 0
    logged_in = None
    for key in ('events', 'fetch_failed', 'no_date', 'invalid_date', 'before_window',
                'participant_lists', 'participant_lists_failed', 'list_calls'):
        counters.setdefault(key, 0)
    for calendar in chosen:
        properties, failed, how = api.calendar_events(calendar.id, calendar.event_ids)
        counters['list_calls'] += how == 'list call'
        print(f"Calendar {calendar.id}: {len(calendar.event_ids)} events ({how}, "
              f"{len(failed)} could not be read)")
        errors += len(failed)
        for event_id in calendar.event_ids:
            counters['events'] += 1
            if event_id in failed:
                counters['fetch_failed'] += 1
                records.append(problem_record(event_id, calendar, 'fetch_failed'))
                continue
            props = properties[event_id]
            begin = dates.split(props.get('begin'))
            if begin.problem:
                counters[begin.problem] += 1
                records.append(problem_record(event_id, calendar, begin.problem))
                continue
            last = last_day(props, begin, run.version)
            if last < window:
                counters['before_window'] += 1
                continue
            participants = None
            if last >= today:
                if logged_in is None:
                    logged_in = api.login()
                    if not logged_in:
                        errors += 1
                        counters['login_failed'] = 1
                if logged_in:
                    objects = api.participants(event_id)
                    if objects is None:
                        errors += 1
                        counters['participant_lists_failed'] += 1
                    else:
                        counters['participant_lists'] += 1
                        participants = participant_list(objects, state_property)
            records.append(event_record(event_id, props, calendar, domain, participants, run.version))
    print(f"Webling: {counters['events']} events, {counters['before_window']} before this year "
          f"(not sent), {counters['no_date']} without date, {counters['fetch_failed']} could not be read, "
          f"{counters['participant_lists']} participant lists read")
    return records, errors
