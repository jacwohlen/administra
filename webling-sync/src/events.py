#!/bin/python
"""
Webling Events Sync Script

This script syncs calendar events and their participants from Webling to Administra.
It fetches events from specified calendars and the confirmed registrations of
each event (event_participants) from the Webling API.

Features:
- Syncs events from Webling calendars to Supabase
- Fetches participants for each event using the Webling participant query API
- Only syncs participants with "confirmed" state (property 594 = "confirmed")
- For events today/future (Europe/Zurich): adds members confirmed in Webling and
  removes registrations the sync added earlier once Webling no longer lists
  them; registrations, walk-ins and attendance entered in the app are kept
- For past events: preserves historical data, skips participant sync
- Supports filtering by calendar ID or name
- Skips events from previous years

Environment Variables Required:
- WEBLING_API_KEY: API key for Webling API access
- WEBLING_DOMAIN: Domain name for your Webling instance
- WEBLING_EMAIL: Email for Webling login (needed for participant API)
- WEBLING_PASSWORD: Password for Webling login (needed for participant API)
- SUPABASE_URL: Supabase project URL
- SUPABASE_SERVICE_ROLE_KEY: Supabase service_role key (bypasses RLS; the anon key has no write access)
"""
import os
import sys
import json
from datetime import datetime

# Webling
import requests
from urllib.parse import quote
from safe_log import postgrest_error, webling_get
from sync_rules import (
    WEBLING_NOTE,
    WEBLING_NOTE_PREFIX,
    club_today,
    confirmed_member_ids,
    plan_participants,
    registrations_open,
)
WEBLING_API_KEY=os.environ.get('WEBLING_API_KEY')
WEBLING_DOMAIN=os.environ.get('WEBLING_DOMAIN')
WEBLING_EMAIL=os.environ.get('WEBLING_EMAIL')
WEBLING_PASSWORD=os.environ.get('WEBLING_PASSWORD')

# Session for maintaining cookies
session = requests.Session()

SUPABASE_URL=os.environ.get('SUPABASE_URL')
SUPABASE_SERVICE_ROLE_KEY=os.environ.get('SUPABASE_SERVICE_ROLE_KEY')


if not WEBLING_DOMAIN:
  sys.exit('Please export WEBLING_DOMAIN')

if not WEBLING_API_KEY:
  sys.exit('Please export WEBLING_API_KEY')

if not WEBLING_EMAIL:
  sys.exit('Please export WEBLING_EMAIL (for participant API authentication)')

if not WEBLING_PASSWORD:
  sys.exit('Please export WEBLING_PASSWORD (for participant API authentication)')

if not SUPABASE_URL:
  sys.exit('Please export SUPABASE_URL')

if not SUPABASE_SERVICE_ROLE_KEY:
  sys.exit('Please export SUPABASE_SERVICE_ROLE_KEY (the service_role key; RLS blocks the anon key)')


# Every failure is counted so main() can exit non-zero and the scheduler
# (GitHub Actions / systemd) reports the run as failed
errors = []

def record_error(message):
    print(message)
    errors.append(message)

# New secret keys (sb_secret_...) are not JWTs: Supabase rejects them in the
# Authorization header, so they only go in apikey. Legacy service_role JWTs
# (valid until end of 2026) are sent in both, as before.
AUTH_HEADERS = {'apikey': SUPABASE_SERVICE_ROLE_KEY}
if not SUPABASE_SERVICE_ROLE_KEY.startswith('sb_'):
  AUTH_HEADERS['Authorization'] = f"Bearer {SUPABASE_SERVICE_ROLE_KEY}"

# initialize client (supabase)
HEADERS = {
    **AUTH_HEADERS,
    'Content-Type': 'application/json'
}

def authenticate_webling():
    """Authenticate with Webling to get session cookie for client API calls"""
    login_url = f"https://{WEBLING_DOMAIN}.webling.ch/api/client/session"
    
    # Login with credentials as form data
    login_data = {
        'email': WEBLING_EMAIL,
        'password': WEBLING_PASSWORD
    }
    
    try:
        response = session.post(login_url, data=login_data)
    except requests.RequestException as e:
        record_error(f"Authentication failed: {type(e).__name__}")
        return False

    # Check if login was successful (204 is also success for session creation)
    if response.status_code in [200, 204]:
        print("Successfully authenticated with Webling")
        return True
    else:
        record_error(f"Authentication failed: HTTP {response.status_code}")
        return False

def transform_section(calendar_title):
    """Transform Webling calendar title to Administra section"""
    if not calendar_title:
        return "General"
    
    # Map calendar names to sections
    title_lower = calendar_title.lower()
    if "judo" in title_lower:
        return "Judo"
    elif "aikido" in title_lower:
        return "Aikido"
    elif "club" in title_lower or "verein" in title_lower:
        return "Club"
    else:
        return "General"

def get_calendars():
    """Fetch list of calendars from Webling"""
    response = webling_get(WEBLING_DOMAIN, WEBLING_API_KEY, "calendar")
    
    if response.status_code == 200:
        return response.json().get("objects", [])
    else:
        record_error(f"Error fetching calendars: HTTP {response.status_code}")
        return []

def get_calendar_details(calendar_id):
    """Fetch details for a specific calendar"""
    response = webling_get(WEBLING_DOMAIN, WEBLING_API_KEY, f"calendar/{calendar_id}", format='full')
    
    if response.status_code == 200:
        return response.json()
    else:
        record_error(f"Error fetching calendar {calendar_id}: HTTP {response.status_code}")
        return None

def get_calendar_event(event_id):
    """Fetch a specific calendar event"""
    response = webling_get(WEBLING_DOMAIN, WEBLING_API_KEY, f"calendarevent/{event_id}", format='full')
    
    if response.status_code == 200:
        return response.json()
    else:
        record_error(f"Error fetching event {event_id}: HTTP {response.status_code}")
        return None

def get_event_participants(event_id):
    """Fetch participants for a specific event using the query API

    Returns the participant objects, [] when the event has none, or None when
    they could not be read. None must never be treated like an empty list:
    an empty list removes the event's Webling registrations.
    """
    api_url = f"https://{WEBLING_DOMAIN}.webling.ch/api/client/query/participant"

    # Form data as specified in the API
    form_data = {
        'filter': f'$parents.$id={event_id}',
        'order': '$links.member.$label asc, state desc'
    }

    try:
        response = session.post(api_url, data=form_data)
    except requests.RequestException as e:
        record_error(f"Error fetching participants for event {event_id}: {type(e).__name__}")
        return None

    if response.status_code != 200:
        record_error(f"Error fetching participants for event {event_id}: HTTP {response.status_code}")
        return None

    try:
        participant_ids = response.json().get('objects', [])
    except Exception as e:
        # Never the raw response: it holds participant data
        record_error(f"      Error parsing participant response for event {event_id}: {type(e).__name__}")
        return None
    print(f"      Found {len(participant_ids)} participant IDs")

    if not participant_ids:
        return []

    # Fetch all participants in bulk using the object endpoint
    return get_participants_bulk(participant_ids)

def get_participants_bulk(participant_ids):
    """Fetch detailed information for multiple participants in bulk

    Returns the participant objects, or None when they could not be read.
    """
    # Convert list of IDs to comma-separated string
    ids_string = ','.join(map(str, participant_ids))
    api_url = f"https://{WEBLING_DOMAIN}.webling.ch/api/client/object/{ids_string}"

    try:
        response = session.get(api_url)
    except requests.RequestException as e:
        record_error(f"        Error fetching bulk participants: {type(e).__name__}")
        return None

    if response.status_code != 200:
        record_error(f"        Error fetching bulk participants: HTTP {response.status_code}")
        return None

    try:
        data = response.json()
    except Exception as e:
        record_error(f"        Error parsing bulk participant response: {type(e).__name__}")
        return None
    # The bulk API returns a list of participant objects, but a
    # single object (not wrapped in a list) when only one id is asked for
    if isinstance(data, list):
        return data
    if isinstance(data, dict) and 'properties' in data:
        # That single object carries no id; it is the one we asked for
        data.setdefault('id', participant_ids[0])
        return [data]
    # Keys only: the values may hold personal data
    keys = sorted(data.keys()) if isinstance(data, dict) else None
    record_error(f"        Unexpected bulk response format: {type(data)} {keys}")
    return None

def parse_webling_datetime(datetime_str):
    """Parse Webling datetime format to date and time components"""
    if not datetime_str:
        return None, None
    
    try:
        # Webling format: "2023-03-31 19:00:00"
        dt = datetime.fromisoformat(datetime_str)
        date_str = dt.strftime("%Y-%m-%d")
        time_str = dt.strftime("%H:%M")
        return date_str, time_str
    except (TypeError, ValueError):
        return datetime_str, None

def sync_events(selected_calendars=None):
    """Sync calendar events from Webling to Administra
    
    Args:
        selected_calendars: List of calendar IDs or names to sync. If None, sync all calendars.
    """
    # Authenticate for participant API access
    print("Authenticating with Webling...")
    participants_available = authenticate_webling()
    if not participants_available:
        print("Failed to authenticate. Participant sync will be skipped.")
        # Continue with event sync only

    # One date for the whole run, in the club's time zone (the runner uses UTC)
    today = club_today()
    
    print("Fetching calendars from Webling...")
    all_calendar_ids = get_calendars()
    
    if not all_calendar_ids:
        record_error("No calendars found")
        return
    
    # Filter calendars if selection is specified
    calendar_ids_to_process = []
    
    if selected_calendars:
        print(f"Filtering for selected calendars: {selected_calendars}")
        
        # First, get all calendar details to match by name
        calendar_details_map = {}
        for cal_id in all_calendar_ids:
            details = get_calendar_details(cal_id)
            if details:
                calendar_details_map[cal_id] = details["properties"].get("title", f"Calendar {cal_id}")
        
        # Filter by ID or name
        for selector in selected_calendars:
            # Try as ID first (if it's a number)
            try:
                selector_as_id = int(selector)
                if selector_as_id in all_calendar_ids:
                    calendar_ids_to_process.append(selector_as_id)
                    continue
            except ValueError:
                pass
            
            # Try as name match
            for cal_id, cal_name in calendar_details_map.items():
                if selector.lower() in cal_name.lower():
                    if cal_id not in calendar_ids_to_process:
                        calendar_ids_to_process.append(cal_id)
        
        if not calendar_ids_to_process:
            print("No calendars matched the selection criteria")
            print("Available calendars:")
            for cal_id, cal_name in calendar_details_map.items():
                print(f"  - {cal_id}: {cal_name}")
            return
    else:
        calendar_ids_to_process = all_calendar_ids
    
    print(f"Processing {len(calendar_ids_to_process)} calendar(s)")
    synced_count = 0
    
    for calendar_id in calendar_ids_to_process:
        print(f"\nProcessing calendar {calendar_id}...")
        
        # Get calendar details
        calendar_details = get_calendar_details(calendar_id)
        if not calendar_details:
            continue
            
        calendar_title = calendar_details["properties"].get("title", f"Calendar {calendar_id}")
        print(f"Calendar: {calendar_title}")
        
        # Get calendar events from children
        calendar_events = calendar_details.get("children", {}).get("calendarevent", [])
        
        if not calendar_events:
            print(f"No events found for calendar {calendar_id}")
            continue
            
        print(f"Found {len(calendar_events)} events in {calendar_title}")
        
        section = transform_section(calendar_title)
        
        for event_id in calendar_events:
            try:
                # Get detailed event information
                event_details = get_calendar_event(event_id)
                if not event_details:
                    continue
                
                props = event_details["properties"]
                
                # Extract event information
                title = props.get("title", "Untitled Event")
                # Create Webling portal link instead of using description
                webling_link = f"https://{WEBLING_DOMAIN}.webling.ch/portal#/calendar/event/{event_id}"
                location = props.get("place", "")
                
                # Parse datetime
                begin_date, begin_time = parse_webling_datetime(props.get("begin"))
                end_date, end_time = parse_webling_datetime(props.get("end"))
                
                # Handle max participants
                max_participants = props.get("maxParticipants")
                if max_participants is not None:
                    max_participants = int(max_participants)
                
                # Skip if no valid date
                if not begin_date:
                    continue
                
                # Skip events from previous years (only sync current year and future)
                try:
                    event_year = int(begin_date.split('-')[0])
                    current_year = today.year
                    if event_year < current_year:
                        print(f"    Skipping past event: {title} ({begin_date})")
                        continue
                except (ValueError, IndexError):
                    # If we can't parse the year, skip the event
                    print(f"    Skipping event with invalid date format: {title} ({begin_date})")
                    continue
                
                event_data = {
                    "id": event_id,
                    "title": title.strip(),
                    "description": webling_link,
                    "date": begin_date,
                    "timeFrom": begin_time,
                    "timeTo": end_time,
                    "location": location.strip() if location else None,
                    "section": section,
                    "maxParticipants": max_participants
                }
                
                # Remove None values
                event_data = {k: v for k, v in event_data.items() if v is not None}
                
                print(f"  - {event_data['title']} on {event_data['date']}")
                
                if upsert('events', event_data):
                    synced_count += 1

                    # Registrations of past events are history and stay as they are
                    if not participants_available or not registrations_open(begin_date, today):
                        continue

                    print(f"    Fetching participants for event {event_id}...")
                    participants = get_event_participants(event_id)
                    # None: Webling could not be read (error recorded), so the
                    # registrations stay as they are. [] is a real empty list.
                    if participants is not None:
                        sync_event_participants(event_id, participants)

            except Exception as e:
                record_error(f"Error processing event {event_id}: {e}")
                continue
    
    print(f"\nSync completed! Synced {synced_count} events total.")

def rest_url(path, filters):
    """PostgREST URL with the filter values percent-encoded (a space becomes %20, never '+')"""
    query = '&'.join(f"{key}={quote(str(value), safe='.,()*')}" for key, value in filters.items())
    return f"{SUPABASE_URL}/rest/v1/{path}?{query}"

def get_rows(path, filters):
    """Rows from Supabase, or None (error recorded) when they could not be read"""
    response = requests.get(rest_url(path, filters), headers=HEADERS)
    if response.status_code == 200:
        return response.json()
    record_error(f"      Error reading {path}: {postgrest_error(response)}")
    return None

def sync_event_participants(event_id, participants):
    """Bring the Webling registrations of an event (today or later) in line with Webling

    - Members confirmed in Webling without a row get one ('registered').
    - Rows the sync inserted earlier are removed when the member is no longer
      confirmed in Webling, unless the app changed them since (attendance,
      another status, an event_logs row).
    - Everything else stays: registrations and walk-ins added in the app, and
      attendanceStatus and registeredAt of existing rows.
    """
    confirmed, skipped = confirmed_member_ids(participants)
    existing = get_rows('event_participants', {
        'eventId': f'eq.{event_id}',
        'select': 'memberId,attendanceStatus,notes',
    })
    attended = get_rows('event_logs', {'eventId': f'eq.{event_id}', 'select': 'memberId'})
    if existing is None or attended is None:
        return

    to_insert, to_remove = plan_participants(
        existing, confirmed, {row['memberId'] for row in attended}
    )

    removed = 0
    if to_remove:
        # The conditions are checked again here, in case the app changed a
        # row since it was read
        response = requests.delete(rest_url('event_participants', {
            'eventId': f'eq.{event_id}',
            'memberId': f"in.({','.join(map(str, to_remove))})",
            'attendanceStatus': 'eq.registered',
            'notes': f'like.{WEBLING_NOTE_PREFIX}*',
        }), headers=HEADERS)
        if response.status_code in [200, 204]:
            removed = len(to_remove)
        else:
            record_error(f"      Error removing registrations of event {event_id}: {postgrest_error(response)}")

    added = 0
    for member_id in to_insert:
        if insert_ignoring_duplicates('event_participants', {
            "eventId": event_id,
            "memberId": member_id,
            "attendanceStatus": "registered",
            "notes": WEBLING_NOTE,
        }):
            added += 1

    # Counts only: logs end up in GitHub Actions, which must not hold personal data
    print(f"    Registrations: {len(confirmed)} confirmed in Webling ({skipped} skipped), "
          f"{added} added, {removed} removed")

def insert_ignoring_duplicates(table_name, data):
    """Insert a row; a row that exists already (e.g. added in the app meanwhile) is left as it is"""
    headers = {
        **AUTH_HEADERS,
        'Content-Type': 'application/json',
        'Prefer': 'resolution=ignore-duplicates,return=minimal'
    }
    response = requests.post(f"{SUPABASE_URL}/rest/v1/{table_name}", headers=headers, data=json.dumps(data))
    if response.status_code in [200, 201, 204]:
        return True
    # Never the response body: constraint errors contain the whole row
    record_error(f"    ✗ Error: {table_name}: {postgrest_error(response)}")
    return False

def upsert(table_name, data):
    """Insert or update data in Supabase table"""
    headers = {
        **AUTH_HEADERS,
        'Content-Type': 'application/json',
        'Prefer': 'resolution=merge-duplicates'
    }
    response = requests.post(f"{SUPABASE_URL}/rest/v1/{table_name}", headers=headers, data=json.dumps(data))
    if response.status_code in [200, 201]:
        return True
    else:
        # Never the response body: constraint errors contain the whole row
        record_error(f"    ✗ Error: {table_name}: {postgrest_error(response)}")
        return False

def list_calendars():
    """List all available calendars"""
    print("Available calendars:")
    calendar_ids = get_calendars()
    
    if not calendar_ids:
        print("No calendars found")
        return
    
    for cal_id in calendar_ids:
        details = get_calendar_details(cal_id)
        if details:
            title = details["properties"].get("title", f"Calendar {cal_id}")
            print(f"  - {cal_id}: {title}")

def print_usage():
    """Print usage information"""
    print("Usage:")
    print("  python events.py                           # Sync all calendars with events and participants")
    print("  python events.py list                      # List available calendars")
    print("  python events.py --calendar 22333          # Sync specific calendar by ID")
    print("  python events.py --calendar judo           # Sync calendars matching 'judo' in name")
    print("  python events.py --calendar 22333 aikido   # Sync multiple calendars")
    print()
    print("Features:")
    print("  - Syncs events from Webling calendars to Administra")
    print("  - Fetches participants for each event and syncs their registrations")
    print("  - Only syncs participants with 'confirmed' state")
    print("  - For events today/future: adds confirmed registrations, removes the ones Webling dropped")
    print("    (registrations and attendance entered in Administra are kept)")
    print("  - For past events: preserves historical data")
    print("  - Skips events from previous years (current year and future only)")
    print()
    print("Examples:")
    print("  python events.py --calendar 22333 21780    # Sync Club and Aikido calendars")
    print("  python events.py --calendar judo aikido    # Sync all calendars with 'judo' or 'aikido' in name")

def main():
    """Main function to run the event sync"""
    if len(sys.argv) > 1:
        if sys.argv[1] == "list":
            list_calendars()
            return
        elif sys.argv[1] == "--calendar" and len(sys.argv) > 2:
            selected_calendars = sys.argv[2:]
            print("Starting Webling calendar events sync for selected calendars...")
            sync_events(selected_calendars)
        elif sys.argv[1] in ["-h", "--help", "help"]:
            print_usage()
        else:
            print("Invalid arguments!")
            print_usage()
    else:
        print("Starting Webling calendar events sync for all calendars...")
        sync_events()

if __name__ == "__main__":
    main()
    if errors:
        sys.exit(f"Sync finished with {len(errors)} error(s)")
