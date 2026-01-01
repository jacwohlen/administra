# Webling Sync Tools for Administra

This folder contains scripts to sync data from Webling API with Administra's Supabase database.

## Scripts

### 1. Member Sync (`webling.py`)

Fetches all members from Webling and syncs them to Administra.

**Data Fields:**

- Member Id
- Firstname
- Lastname
- Birthday
- Groups (as labels)
- Cell Phone

### 2. Events Sync (`events.py`)

Fetches calendar events from Webling calendars and syncs them to Administra. Only syncs events from the current year onwards (skips past events). Supports syncing all calendars or filtering by specific calendar IDs or names.

**Data Fields:**

- Event Id
- Title
- Description (Webling portal link for event details)
- Date
- Start Time
- End Time
- Location
- Section (derived from calendar name)
- Max Participants

**Calendar Filtering:**

- Sync all calendars (default)
- Sync specific calendars by ID: `python events.py --calendar 22333 21780`
- Sync calendars by name matching: `python events.py --calendar judo aikido`
- List available calendars: `python events.py list`

**Date Filtering:**

- Only events from the current year (2025) and future years are synced
- Past events are automatically skipped to keep the database current

### 3. Duplicate Management (`duplicates.py`)

Tools to search for and merge duplicate members.

**Usage:**

```bash
python duplicates.py search <lastname>  # Search for members by lastname
python duplicates.py merge              # Merge duplicate members interactively
```

## Setup

1. Get Webling API Token (readonly)
2. Install dependencies and set environment variables:

```bash
pip install requests

export WEBLING_API_KEY=<your webling key>
export WEBLING_DOMAIN=<your webling domain>  # e.g. jacwohlen

export SUPABASE_URL=<your supabase url>
export SUPABASE_ANON_KEY=<your supabase anon key>
```

## Usage

```bash
# Sync members
python webling.py

# Sync all events from all calendars
python events.py

# List available calendars
python events.py list

# Sync events from specific calendars by ID
python events.py --calendar 22333 21780

# Sync events from calendars matching name patterns
python events.py --calendar judo aikido club

# Search for duplicate members
python duplicates.py search Smith

# Merge duplicate members
python duplicates.py merge
```
