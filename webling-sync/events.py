#!/bin/python
"""
Webling Events Sync Script

This script syncs calendar events and their participants from Webling to Administra.
It fetches events from specified calendars and creates attendance logs based on 
participant data from the Webling API.

Features:
- Syncs events from Webling calendars to Supabase
- Fetches participants for each event using the Webling participant query API
- Creates attendance logs based on participant states
- Supports filtering by calendar ID or name
- Skips events from previous years

Environment Variables Required:
- WEBLING_API_KEY: API key for Webling API access
- WEBLING_DOMAIN: Domain name for your Webling instance
- WEBLING_EMAIL: Email for Webling login (needed for participant API)
- WEBLING_PASSWORD: Password for Webling login (needed for participant API)
- SUPABASE_URL: Supabase project URL
- SUPABASE_ANON_KEY: Supabase anonymous key
"""
import os
import sys
import json
from datetime import datetime, date

# Webling
import requests
WEBLING_API_KEY=os.environ.get('WEBLING_API_KEY')
WEBLING_DOMAIN=os.environ.get('WEBLING_DOMAIN')
WEBLING_EMAIL=os.environ.get('WEBLING_EMAIL')
WEBLING_PASSWORD=os.environ.get('WEBLING_PASSWORD')

# Session for maintaining cookies
session = requests.Session()

SUPABASE_URL=os.environ.get('SUPABASE_URL')
SUPABASE_ANON_KEY=os.environ.get('SUPABASE_ANON_KEY')


if not WEBLING_DOMAIN:
  print('Please export WEBLING_DOMAIN')
  sys.exit()

if not WEBLING_API_KEY:
  print('Please export WEBLING_API_KEY')
  sys.exit()

if not WEBLING_EMAIL:
  print('Please export WEBLING_EMAIL (for participant API authentication)')
  sys.exit()

if not WEBLING_PASSWORD:
  print('Please export WEBLING_PASSWORD (for participant API authentication)')
  sys.exit()

if not SUPABASE_URL:
  print('Please export SUPABASE_URL')
  sys.exit()

if not SUPABASE_ANON_KEY:
  print('Please export SUPABASE_ANON_KEY')
  sys.exit()


# initialize client (supabase)
HEADERS = {
    'apikey': SUPABASE_ANON_KEY,
    'Authorization': f"Bearer {SUPABASE_ANON_KEY}",
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
    
    response = session.post(login_url, data=login_data)
    
    # Check if login was successful (204 is also success for session creation)
    if response.status_code in [200, 204]:
        print("Successfully authenticated with Webling")
        return True
    else:
        print(f"Authentication failed: {response.status_code} - {response.text}")
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
    api_url = f"https://{WEBLING_DOMAIN}.webling.ch/api/1/calendar?apikey={WEBLING_API_KEY}"
    response = requests.get(api_url)
    
    if response.status_code == 200:
        return response.json().get("objects", [])
    else:
        print(f"Error fetching calendars: {response.status_code} - {response.text}")
        return []

def get_calendar_details(calendar_id):
    """Fetch details for a specific calendar"""
    api_url = f"https://{WEBLING_DOMAIN}.webling.ch/api/1/calendar/{calendar_id}?apikey={WEBLING_API_KEY}&format=full"
    response = requests.get(api_url)
    
    if response.status_code == 200:
        return response.json()
    else:
        print(f"Error fetching calendar {calendar_id}: {response.status_code} - {response.text}")
        return None

def get_calendar_event(event_id):
    """Fetch a specific calendar event"""
    api_url = f"https://{WEBLING_DOMAIN}.webling.ch/api/1/calendarevent/{event_id}?apikey={WEBLING_API_KEY}&format=full"
    response = requests.get(api_url)
    
    if response.status_code == 200:
        return response.json()
    else:
        print(f"Error fetching event {event_id}: {response.status_code} - {response.text}")
        return None

def get_event_participants(event_id):
    """Fetch participants for a specific event using the query API"""
    api_url = f"https://{WEBLING_DOMAIN}.webling.ch/api/client/query/participant"
    
    # Form data as specified in the API
    form_data = {
        'filter': f'$parents.$id={event_id}',
        'order': '$links.member.$label asc, state desc'
    }
    
    response = session.post(api_url, data=form_data)
    
    if response.status_code == 200:
        try:
            data = response.json()
            participant_ids = data.get('objects', [])
            print(f"      Found {len(participant_ids)} participant IDs")
            
            if not participant_ids:
                return []
            
            # Fetch all participants in bulk using the object endpoint
            participants_data = get_participants_bulk(participant_ids)
            return participants_data
            
        except Exception as e:
            print(f"      Error parsing participant response: {e}")
            print(f"      Raw response: {response.text}")
            return []
    else:
        print(f"Error fetching participants for event {event_id}: {response.status_code} - {response.text}")
        return []

def get_participants_bulk(participant_ids):
    """Fetch detailed information for multiple participants in bulk"""
    if not participant_ids:
        return []
    
    # Convert list of IDs to comma-separated string
    ids_string = ','.join(map(str, participant_ids))
    api_url = f"https://{WEBLING_DOMAIN}.webling.ch/api/client/object/{ids_string}"
    
    response = session.get(api_url)
    
    if response.status_code == 200:
        try:
            data = response.json()
            # The bulk API returns a list of participant objects
            if isinstance(data, list):
                return data
            else:
                print(f"        Unexpected bulk response format: {type(data)}")
                return []
        except Exception as e:
            print(f"        Error parsing bulk participant response: {e}")
            return []
    else:
        print(f"        Error fetching bulk participants: {response.status_code} - {response.text}")
        return []

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
    except:
        return datetime_str, None

def sync_events(selected_calendars=None):
    """Sync calendar events from Webling to Administra
    
    Args:
        selected_calendars: List of calendar IDs or names to sync. If None, sync all calendars.
    """
    # Authenticate for participant API access
    print("Authenticating with Webling...")
    if not authenticate_webling():
        print("Failed to authenticate. Participant sync will be skipped.")
        # Continue with event sync only
    
    print("Fetching calendars from Webling...")
    all_calendar_ids = get_calendars()
    
    if not all_calendar_ids:
        print("No calendars found")
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
                    current_year = date.today().year
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
                    
                    # Fetch and sync participant registrations for this event
                    print(f"    Fetching participants for event {event_id}...")
                    participants = get_event_participants(event_id)
                    
                    if participants and len(participants) > 0:
                        participants_synced = sync_event_participants(event_id, participants)
                        print(f"    Synced {participants_synced} participant registrations")
                    else:
                        print(f"    No participants found for event {event_id}")
                    
            except Exception as e:
                print(f"Error processing event {event_id}: {e}")
                continue
    
    print(f"\nSync completed! Synced {synced_count} events total.")

def sync_event_participants(event_id, participants):
    """Sync participant registrations for a specific event"""
    synced_count = 0
    
    for participant in participants:
        try:
            # Extract participant information
            participant_id = participant.get('id')
            member_id_raw = participant.get('links', {}).get('member')
            state = participant.get('properties', {}).get('state', 'unknown')
            
            # Debug: print the participant structure
            print(f"        Participant {participant_id}: member_id_raw = {member_id_raw} (type: {type(member_id_raw)})")
            
            # Handle member_id - it might be an array or single value
            if isinstance(member_id_raw, list):
                if len(member_id_raw) > 0:
                    member_id = member_id_raw[0]  # Take first member ID
                else:
                    member_id = None
            else:
                member_id = member_id_raw
            
            if not participant_id or not member_id:
                print(f"      Skipping participant with missing ID or member ID (participant_id={participant_id}, member_id={member_id})")
                continue
            
            # Create event participant registration
            participant_data = {
                "eventId": event_id,
                "memberId": member_id,
                "attendanceStatus": "registered",  # Default status for imported participants
                "notes": f"Imported from Webling - State: {state}"
            }
            
            # Remove None values
            participant_data = {k: v for k, v in participant_data.items() if v is not None}
            
            if upsert('event_participants', participant_data):
                synced_count += 1
                
        except Exception as e:
            print(f"      Error processing participant {participant.get('id', 'unknown')}: {e}")
            continue
    
    return synced_count

def upsert(table_name, data):
    """Insert or update data in Supabase table"""
    headers = {
        'apikey': SUPABASE_ANON_KEY,
        'Authorization': f"Bearer {SUPABASE_ANON_KEY}",
        'Content-Type': 'application/json',
        'Prefer': 'resolution=merge-duplicates'
    }
    response = requests.post(f"{SUPABASE_URL}/rest/v1/{table_name}", headers=headers, data=json.dumps(data))
    if response.status_code in [200, 201]:
        return True
    else:
        print(f"    ✗ Error: {response.status_code} - {response.text}")
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
    print("  - Fetches participants for each event and creates attendance logs")
    print("  - Skips events from previous years (current year and future only)")
    print("  - Maps participant states to attendance status")
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
            print(f"Starting Webling calendar events sync for selected calendars...")
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
