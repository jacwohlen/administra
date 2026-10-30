"""The club's day: Europe/Zurich, not the runner's time zone (GitHub
runners use UTC). The layer itself answers today in Zurich from
integration_begin, which the adapters prefer; this clock is their
fallback when it gave none."""
from datetime import datetime
from zoneinfo import ZoneInfo

CLUB_TIMEZONE = ZoneInfo('Europe/Zurich')


def club_today():
    """Today in the club's time zone, not the runner's."""
    return datetime.now(CLUB_TIMEZONE).date()
