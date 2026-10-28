"""Webling adapter for the integration layer (integrations phase 3).

Fetches members and calendar events from Webling and translates them into
layer records (members.py, events.py); everything else (identity, labels,
statuses, sections, guards, writes) is the layer's. The calls are the
legacy scripts' (api.py).
"""
from collections import namedtuple

from integration.runner import FetchFailed, UsageError
from safe_log import WeblingError
from webling_adapter import events, members
from webling_adapter.api import WeblingApi

Plan = namedtuple('Plan', 'kind scope calendars')


class WeblingAdapter:
    connection = 'webling'

    def __init__(self, domain, api_key, email=None, password=None, selectors=(), list_call=True):
        self.domain = domain
        self.api = WeblingApi(domain, api_key, email, password, list_call=list_call)
        self.selectors = list(selectors)
        self.errors = 0
        self.counters = {}

    def empty_scope(self, kind):
        return {'complete': False}

    def plan(self, kind):
        """What the run covers. Members: every member (complete). Events:
        the calendars read completely (W3, W4) before the run opens, so a
        calendar Webling did not answer is never in the scope and none of
        its events can go."""
        if kind == 'members':
            return Plan(kind, {'complete': True}, [])
        try:
            chosen, errors = events.calendars(self.api, self.selectors, self.counters)
        except WeblingError as err:
            raise FetchFailed(str(err)) from None
        self.errors += errors
        if not self.counters.get('calendars'):
            raise FetchFailed('Webling has no calendars')
        if self.selectors and not chosen:
            raise UsageError('no calendar matched --calendar (sync.py list shows the ids)')
        return Plan(kind, {'complete': True, 'calendars': [str(c.id) for c in chosen]}, chosen)

    def records(self, plan, run):
        try:
            if plan.kind == 'members':
                records, errors = members.member_records(self.api, self.counters)
            else:
                records, errors = events.event_records(self.api, plan.calendars, run, self.domain,
                                                       self.counters)
        except WeblingError as err:
            raise FetchFailed(str(err)) from None
        self.errors += errors
        return records

    def list_calendars(self):
        """Calendar ids and titles, to find an id for --calendar (by hand;
        titles are not for the sync's log)."""
        chosen, errors = events.calendars(self.api, [], {})
        for calendar in chosen:
            print(f"  - {calendar.id}: {calendar.title}")
        return 1 if errors else 0
