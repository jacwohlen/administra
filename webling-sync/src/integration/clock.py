"""The club's day: Europe/Zurich, not the runner's time zone (GitHub
runners use UTC). Re-exported from the legacy rules so both paths agree
on "today" until the legacy scripts go (PR 3c); the layer itself answers
today in Zurich from integration_begin, which the adapters prefer."""
from sync_rules import CLUB_TIMEZONE, club_today

__all__ = ['CLUB_TIMEZONE', 'club_today']
