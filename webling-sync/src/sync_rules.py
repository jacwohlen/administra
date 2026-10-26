"""
Rules of the Webling sync that need no network, so they can be unit-tested
(see tests/). The scripts webling.py and events.py do the HTTP calls.
"""
from datetime import date, datetime
from zoneinfo import ZoneInfo

CLUB_TIMEZONE = ZoneInfo('Europe/Zurich')

# Start of event_participants.notes on every row the sync inserts. It is the
# only thing that tells a Webling registration apart from one added in the app.
WEBLING_NOTE_PREFIX = 'Imported from Webling'
WEBLING_NOTE = f'{WEBLING_NOTE_PREFIX} - Confirmed: confirmed'

# Webling property id of a participant's state ('confirmed', ...)
PARTICIPANT_STATE_PROPERTY = '594'


def club_today():
    """Today in the club's time zone, not the runner's (GitHub runners use UTC)."""
    return datetime.now(CLUB_TIMEZONE).date()


def member_row(member_id, properties, labels):
    """The members row for one Webling member.

    A missing property raises KeyError: a field renamed in Webling must fail
    the member, not overwrite every name with an empty value. An empty last
    name fails the member too (ValueError); an empty first name becomes ''.
    """
    firstname = (properties['Vorname'] or '').strip()
    lastname = (properties['Name'] or '').strip()
    if not lastname:
        raise ValueError('member without a last name')
    row = {
        'id': member_id,
        'firstname': firstname,
        'lastname': lastname,
        'birthday': properties['Geburtstag'],
        'mobile': properties['Mobile'],
        'labels': labels,
    }
    # Members sign in to Administra with this address (see
    # docs/MEMBER_SIGN_IN.md). Only send it when Webling has one, so an
    # address entered in the app is not wiped by an empty Webling field.
    email = (properties.get('E-Mail') or '').strip()
    if email:
        row['email'] = email
    return row


def confirmed_member_ids(participants):
    """Member ids of the confirmed participants in a Webling participant list.

    Returns (member ids, number of participants skipped as not confirmed or
    without a member).
    """
    member_ids = set()
    skipped = 0
    for participant in participants:
        state = (participant.get('properties') or {}).get(PARTICIPANT_STATE_PROPERTY)
        member = (participant.get('links') or {}).get('member')
        # The member link is a list of ids, or a single id
        if isinstance(member, list):
            member = member[0] if member else None
        if state != 'confirmed' or not member:
            skipped += 1
            continue
        member_ids.add(int(member))
    return member_ids, skipped


def is_webling_registration(row):
    return (row.get('notes') or '').startswith(WEBLING_NOTE_PREFIX)


def plan_participants(existing, confirmed, attended):
    """What to change in an event's event_participants to match Webling.

    existing:  current rows of the event ({memberId, attendanceStatus, notes})
    confirmed: member ids confirmed in Webling
    attended:  member ids with an event_logs row for the event

    Returns (member ids to insert, member ids to remove). Only rows the sync
    inserted itself and that are still plain registrations are removed, so
    registrations and walk-ins added in the app, attendance and every status
    set in the app survive. Rows that exist already are never touched, which
    keeps their attendanceStatus and registeredAt.
    """
    existing_ids = {row['memberId'] for row in existing}
    to_insert = sorted(confirmed - existing_ids)
    to_remove = sorted(
        row['memberId']
        for row in existing
        if row['memberId'] not in confirmed
        and row['memberId'] not in attended
        and is_webling_registration(row)
        and row.get('attendanceStatus') == 'registered'
    )
    return to_insert, to_remove


def registrations_open(event_date, today):
    """Whether the sync still manages the event's registrations: events from
    today on. Registrations of past events, and of events whose date cannot
    be read, are left as they are."""
    try:
        return date.fromisoformat(event_date) >= today
    except (TypeError, ValueError):
        return False


def missing_table(status_code, body):
    """PostgREST's answer for a table that does not exist (yet).

    The sync runs from main against prod before a migration is promoted to
    prod, so a new table can be missing there for a while.
    """
    code = body.get('code') if isinstance(body, dict) else None
    return status_code == 404 and code in ('PGRST205', '42P01')


# Members.id range of Webling members: app ids are below 1'000 or from
# 10'000'001 on (supabase/migrations/20261025220000_fence_member_event_ids.sql)
WEBLING_ID_MIN = 1000
WEBLING_ID_MAX = 10000000


def plan_gone(links, webling_range_ids, webling_ids):
    """Which members Webling no longer has (deleted or merged there).

    links:             the 'webling' member_links ({external_id, gone_at})
    webling_range_ids: members.id of every row in the Webling id range
    webling_ids:       the member ids Webling returned in this run

    Returns (external ids of links to mark gone, member ids to record as gone
    that were never linked, whether that is too many to do unattended). A gone
    member counts as having left and is editable and deletable in Administra
    again. Marking more than a tenth of the members still in Webling (at
    least 5) at once, e.g. after a bad Webling answer, is refused instead;
    an empty answer records nothing.
    """
    current = {str(i) for i in webling_ids}
    linked = {link['external_id'] for link in links}
    active = [link['external_id'] for link in links if link.get('gone_at') is None]
    to_mark = sorted((e for e in active if e not in current), key=int)
    to_adopt = sorted(i for i in webling_range_ids if str(i) not in linked and str(i) not in current)
    too_many = not current or len(to_mark) > max(5, len(active) // 10)
    return to_mark, to_adopt, too_many
