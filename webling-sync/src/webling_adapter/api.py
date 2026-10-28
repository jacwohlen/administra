"""The Webling calls the adapter makes (the same ones as the legacy scripts).

    W1  GET  /api/1/member?format=full             all members
    W2  GET  /api/1/membergroup/<id>?format=full   a group's title
    W3  GET  /api/1/calendar                       calendar ids
    W4  GET  /api/1/calendar/<id>?format=full      title, event ids
    W5  POST /api/client/session                   login (participant API)
    W6  GET  /api/1/calendarevent/<id>?format=full one event
    W7  POST /api/client/query/participant         an event's participant ids
    W8  GET  /api/client/object/<ids>              participants in bulk

W1-W4 and W6 carry the API key as a query parameter, so no URL may reach
the log (see safe_log.py): every failure becomes a WeblingError with
method, path and status only.
"""
import requests

from safe_log import WeblingError

TIMEOUT = (10, 120)


class WeblingApi:
    def __init__(self, domain, api_key, email=None, password=None, list_call=True):
        self.base = f"https://{domain}.webling.ch"
        self.api_key = api_key
        self.email = email
        self.password = password
        # Off (WEBLING_EVENTS_LIST_CALL=false): one W6 call per event only
        self.list_call = list_call
        self.session = None

    # W1-W4, W6 ------------------------------------------------------------

    def get(self, path, **params):
        """GET /api/1/<path> with the API key; the parsed JSON. A network
        error, an HTTP error or a body that is not JSON raise WeblingError
        (without the URL)."""
        try:
            response = requests.get(f"{self.base}/api/1/{path}",
                                    params={'apikey': self.api_key, **params}, timeout=TIMEOUT)
        except requests.RequestException as err:
            raise WeblingError(f"Webling GET /api/1/{path} failed: {type(err).__name__}") from None
        if not response.ok:
            raise WeblingError(f"Webling GET /api/1/{path} failed: HTTP {response.status_code}")
        try:
            return response.json()
        except ValueError:
            raise WeblingError(f"Webling GET /api/1/{path} failed: not JSON") from None

    def members(self):
        """W1: every member object ({id, parents, properties})."""
        body = self.get('member', format='full')
        if not isinstance(body, list):
            raise WeblingError(f"Webling GET /api/1/member: unexpected answer ({type(body).__name__})")
        return body

    def group_title(self, group_id):
        """W2: a member group's title."""
        body = self.get(f"membergroup/{group_id}", format='full')
        title = (body.get('properties') or {}).get('title') if isinstance(body, dict) else None
        if not isinstance(title, str):
            raise WeblingError(f"Webling GET /api/1/membergroup/{group_id}: no title")
        return title

    def calendars(self):
        """W3: the calendar ids."""
        body = self.get('calendar')
        objects = body.get('objects') if isinstance(body, dict) else None
        if not isinstance(objects, list):
            raise WeblingError("Webling GET /api/1/calendar: unexpected answer")
        return objects

    def calendar(self, calendar_id):
        """W4: (title, event ids) of a calendar."""
        body = self.get(f"calendar/{calendar_id}", format='full')
        if not isinstance(body, dict):
            raise WeblingError(f"Webling GET /api/1/calendar/{calendar_id}: unexpected answer")
        title = (body.get('properties') or {}).get('title') or f"Calendar {calendar_id}"
        events = (body.get('children') or {}).get('calendarevent') or []
        return title, list(events)

    def event(self, event_id):
        """W6: an event's properties."""
        body = self.get(f"calendarevent/{event_id}", format='full')
        properties = body.get('properties') if isinstance(body, dict) else None
        if not isinstance(properties, dict):
            raise WeblingError(f"Webling GET /api/1/calendarevent/{event_id}: no properties")
        return properties

    def calendar_events(self, calendar_id, event_ids):
        """The properties of a calendar's events: {event id: properties},
        the ids that could not be read, and how they were read.

        One list call first (GET calendarevent filtered by the calendar),
        taken only when it answers exactly the calendar's event ids, each
        with a title and a begin; anything else (an error, another set of
        ids, missing properties) falls back to one W6 call per event, as
        the legacy sync does. Whether Webling answers the list call is not
        verified yet: the shadow nights show it ('list call' in the log,
        and 0 events updated against what the legacy sync wrote)."""
        wanted = set(event_ids)
        if wanted and self.list_call:
            listed = self._list_events(calendar_id, wanted)
            if listed is not None:
                return listed, [], 'list call'
        events, failed = {}, []
        for event_id in event_ids:
            try:
                events[event_id] = self.event(event_id)
            except WeblingError as err:
                print(f"Error: {err}")
                failed.append(event_id)
        return events, failed, 'single calls'

    def _list_events(self, calendar_id, wanted):
        try:
            body = self.get('calendarevent', format='full', filter=f'$parents.$id={calendar_id}')
        except WeblingError:
            return None
        if not isinstance(body, list):
            return None
        events = {}
        for obj in body:
            if not isinstance(obj, dict) or not isinstance(obj.get('properties'), dict):
                return None
            properties = obj['properties']
            if 'title' not in properties or 'begin' not in properties:
                return None
            events[obj.get('id')] = properties
        return events if set(events) == wanted and len(body) == len(wanted) else None

    # W5, W7, W8 -----------------------------------------------------------

    def login(self):
        """W5: a session for the participant API. False (error printed)
        when it fails: participants are then not read in this run."""
        self.session = requests.Session()
        try:
            response = self.session.post(f"{self.base}/api/client/session",
                                         data={'email': self.email, 'password': self.password},
                                         timeout=TIMEOUT)
        except requests.RequestException as err:
            print(f"Error: Webling login failed: {type(err).__name__}")
            return False
        if response.status_code in (200, 204):
            return True
        print(f"Error: Webling login failed: HTTP {response.status_code}")
        return False

    def participants(self, event_id):
        """W7 and W8: the participant objects of an event, [] when it has
        none, None (error printed) when they could not be read. None is
        never an empty list: an empty list removes registrations."""
        try:
            response = self.session.post(
                f"{self.base}/api/client/query/participant",
                data={'filter': f'$parents.$id={event_id}', 'order': '$links.member.$label asc, state desc'},
                timeout=TIMEOUT)
        except requests.RequestException as err:
            print(f"Error: participants of event {event_id}: {type(err).__name__}")
            return None
        ids = self._objects(response, f"participants of event {event_id}")
        if ids is None or not ids:
            return ids
        return self._bulk(ids, event_id)

    def _objects(self, response, what):
        if response.status_code != 200:
            print(f"Error: {what}: HTTP {response.status_code}")
            return None
        try:
            body = response.json()
        except ValueError:
            print(f"Error: {what}: not JSON")
            return None
        ids = body.get('objects') if isinstance(body, dict) else None
        if not isinstance(ids, list):
            # Never the body: it may hold participant data
            print(f"Error: {what}: unexpected answer ({type(body).__name__})")
            return None
        return ids

    def _bulk(self, ids, event_id):
        try:
            response = self.session.get(f"{self.base}/api/client/object/{','.join(map(str, ids))}",
                                        timeout=TIMEOUT)
        except requests.RequestException as err:
            print(f"Error: participants of event {event_id}: {type(err).__name__}")
            return None
        if response.status_code != 200:
            print(f"Error: participants of event {event_id}: HTTP {response.status_code}")
            return None
        try:
            body = response.json()
        except ValueError:
            print(f"Error: participants of event {event_id}: not JSON")
            return None
        if isinstance(body, list):
            return body
        # Asked for one id, Webling answers that one object, not in a list
        # and without its id
        if isinstance(body, dict) and 'properties' in body:
            return [{**body, 'id': body.get('id', ids[0])}]
        print(f"Error: participants of event {event_id}: unexpected answer ({type(body).__name__})")
        return None
