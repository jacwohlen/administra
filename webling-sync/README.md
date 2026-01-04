# Webling Sync Tools for Administra

This folder contains scripts to sync data from Webling API with Administra's Supabase database.

## Scripts

### 1. Member Sync (`src/webling.py`)

Fetches all members from Webling and syncs them to Administra.

**Data Fields:**

- Member Id
- Firstname
- Lastname
- Birthday
- Groups (as labels)
- Cell Phone

**Runtime:** Fast (~1-2 seconds)

### 2. Events Sync (`src/events.py`)

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
- Participant registrations (member ID, status, notes)

**Calendar Filtering:**

- Sync all calendars (default)
- Sync specific calendars by ID: `python events.py --calendar 22333 21780`
- Sync calendars by name matching: `python events.py --calendar judo aikido`
- List available calendars: `python events.py list`

**Date Filtering:**

- Only events from the current year (2025) and future years are synced
- Past events are automatically skipped to keep the database current

**Runtime:** Slower (~1-2 minutes, fetches participants for each event)

### 3. Duplicate Management (`src/duplicates.py`)

Tools to search for and merge duplicate members.

**Usage:**

```bash
python src/duplicates.py search <lastname>  # Search for members by lastname
python src/duplicates.py merge              # Merge duplicate members interactively
```

## Initial Setup

### 1. Clone/Download this repository

### 2. Create Python virtual environment and install dependencies

```bash
cd ~/work/jacwohlen.ch/administra/webling-sync
python -m venv .env
source .env/bin/activate
pip install requests
```

### 3. Configure environment variables

Create environment-specific configuration files:

**Production (`.env.prod`):**

```bash
export WEBLING_API_KEY=<your webling api key>
export WEBLING_DOMAIN=<your webling domain>  # e.g. jacwohlen

# Supabase production configuration
export SUPABASE_URL=<your production supabase url>
export SUPABASE_ANON_KEY=<your production supabase anon key>

# Required for events.py (participant sync)
export WEBLING_EMAIL=<your webling email>
export WEBLING_PASSWORD=<your webling password>
```

**Staging (`.env.staging`):**

```bash
export WEBLING_API_KEY=<your webling api key>
export WEBLING_DOMAIN=<your webling domain>  # e.g. jacwohlen

# Supabase staging configuration
export SUPABASE_URL=<your staging supabase url>
export SUPABASE_ANON_KEY=<your staging supabase anon key>

# Required for events.py (participant sync)
export WEBLING_EMAIL=<your webling email>
export WEBLING_PASSWORD=<your webling password>
```

**Important:** These files contain sensitive credentials. Do not commit them to version control.

### 4. Set up automated scheduling with systemd timers

The `systemd/` directory contains service and timer files for automated daily sync.

**Schedule:**

- Events sync: Daily at 23:58
- Members sync: Daily at 23:59

**Install systemd services:**

```bash
# Run the install script
./install-systemd.sh

# The script will copy service files to ~/.config/systemd/user/
# By default, services use production environment (ENV=prod)

# Optional: Edit service files to use staging environment
# Edit ~/.config/systemd/user/webling-sync-events.service
# Edit ~/.config/systemd/user/webling-sync-members.service
# Change: Environment="ENV=prod" to Environment="ENV=staging"

# Reload systemd
systemctl --user daemon-reload

# Enable and start timers
systemctl --user enable webling-sync-events.timer
systemctl --user enable webling-sync-members.timer
systemctl --user start webling-sync-events.timer
systemctl --user start webling-sync-members.timer

# Enable lingering (allows services to run when not logged in)
loginctl enable-linger $USER
```

**Verify timers are active:**

```bash
systemctl --user list-timers
```

You should see both `webling-sync-events.timer` and `webling-sync-members.timer` scheduled for 23:58 and 23:59 respectively.

## Manual Usage

### Using Wrapper Scripts (Recommended)

```bash
# Production (default)
./run-members.sh        # Sync members to production
./run-events.sh         # Sync events to production

# Staging
ENV=staging ./run-members.sh     # Sync members to staging
ENV=staging ./run-events.sh      # Sync events to staging
```

### Direct Python Execution

```bash
# Activate virtual environment
source .env/bin/activate

# Source environment variables (choose one)
source .env.prod      # For production
source .env.staging   # For staging

# Sync members
python src/webling.py

# Sync all events from all calendars
python src/events.py

# List available calendars
python src/events.py list

# Sync events from specific calendars by ID
python src/events.py --calendar 22333 21780

# Sync events from calendars matching name patterns
python src/events.py --calendar judo aikido club

# Search for duplicate members
python src/duplicates.py search Smith

# Merge duplicate members
python src/duplicates.py merge
```

## Systemd Service Management

### View logs

```bash
# Via systemd journal
journalctl --user -u webling-sync-events.service -f
journalctl --user -u webling-sync-members.service -f

# Via log files
tail -f logs/events.log
tail -f logs/members.log
```

### Manual service execution

```bash
systemctl --user start webling-sync-events.service
systemctl --user start webling-sync-members.service
```

### Check service status

```bash
systemctl --user status webling-sync-events.service
systemctl --user status webling-sync-members.service
```

### Check timer status

```bash
systemctl --user status webling-sync-events.timer
systemctl --user status webling-sync-members.timer
```

### Stop/disable timers

```bash
# Stop timers (temporary)
systemctl --user stop webling-sync-events.timer
systemctl --user stop webling-sync-members.timer

# Disable timers (prevents auto-start on boot)
systemctl --user disable webling-sync-events.timer
systemctl --user disable webling-sync-members.timer
```

### Restart timers after configuration changes

```bash
systemctl --user daemon-reload
systemctl --user restart webling-sync-events.timer
systemctl --user restart webling-sync-members.timer
```

## Project Structure

```
webling-sync/
├── README.md                 # This file
├── .env.prod                # Production environment variables (not in git)
├── .env.staging             # Staging environment variables (not in git)
├── install-systemd.sh       # Install script for systemd services
├── run-events.sh            # Events sync wrapper (uses $ENV, defaults to prod)
├── run-members.sh           # Members sync wrapper (uses $ENV, defaults to prod)
├── src/                     # Python source files
│   ├── webling.py           # Member sync script
│   ├── events.py            # Events & participants sync script
│   └── duplicates.py        # Duplicate management tool
├── .env/                    # Python virtual environment
├── logs/                    # Log files
│   ├── events.log
│   └── members.log
└── systemd/                 # Systemd service/timer templates
    ├── webling-sync-events.service
    ├── webling-sync-events.timer
    ├── webling-sync-members.service
    └── webling-sync-members.timer
```

## Troubleshooting

### Services fail with "Please export WEBLING_DOMAIN" error

The environment file is not being sourced correctly. Make sure:

- The `.env.prod` (or `.env.staging`) file exists and contains `export` statements
- The wrapper scripts are executable: `chmod +x run-events.sh run-members.sh`
- The ENV variable matches your environment file name (without the .env. prefix)

### Timers don't run when logged out

Enable lingering for your user:

```bash
loginctl enable-linger $USER
```

### Check if lingering is enabled

```bash
loginctl show-user $USER | grep Linger
```

Should output: `Linger=yes`

### View recent service failures

```bash
journalctl --user -u webling-sync-events.service --since "1 hour ago"
journalctl --user -u webling-sync-members.service --since "1 hour ago"
```
