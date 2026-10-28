"""
Rules of the Webling sync that need no network, so they can be unit-tested
(see tests/). The scripts webling.py and events.py do the HTTP calls.
"""
from collections import Counter, namedtuple
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


def plan_gone(links, webling_range_ids, webling_ids, accept=None):
    """Which members Webling no longer has (deleted or merged there).

    links:             the 'webling' member_links ({external_id, gone_at})
    webling_range_ids: members.id of every row in the Webling id range
    webling_ids:       the member ids Webling returned in this run

    Returns (external ids of links to mark gone, member ids to record as gone
    that were never linked, whether that is too many to do unattended). A gone
    member counts as having left and is editable and deletable in Administra
    again. Marking more than a tenth of the members still in Webling (at
    least 5) at once, e.g. after a bad Webling answer, is refused instead,
    unless accept is exactly that number (someone checked Webling and
    confirmed it); an empty answer is always refused.
    """
    current = {str(i) for i in webling_ids}
    linked = {link['external_id'] for link in links}
    active = [link['external_id'] for link in links if link.get('gone_at') is None]
    to_mark = sorted((e for e in active if e not in current), key=int)
    to_adopt = sorted(i for i in webling_range_ids if str(i) not in linked and str(i) not in current)
    too_many = not current or (len(to_mark) > max(5, len(active) // 10) and accept != len(to_mark))
    return to_mark, to_adopt, too_many


# Statuses that let a member account in (member_grants_access() in
# supabase/migrations/20261027120000_member_access_requires_membership.sql)
COUNTING_STATUSES = ('active', 'passive')


def status_from_labels(labels, link):
    """members.membership_status for these labels and member link ('active',
    'gone' or None): member_status_from_labels() in
    supabase/migrations/20261025230000_membership_status_and_member_links.sql,
    rule by rule (the table in docs/INTEGRATIONS.md).

    The tests' stand-in for the database's rule. The sync itself asks the
    database (database_status_rule() in webling.py): a rule changed here
    would reach prod with the next merge to main, before the changed SQL is
    promoted, and the guard would then wave through the very drop it exists
    to stop.
    """
    labels = labels if isinstance(labels, list) else []
    if link == 'gone' or '03_Austritt' in labels:
        return 'left'
    if 'Aktiv' in labels:
        return 'active'
    if 'Passiv' in labels or 'Ehrenmitglieder' in labels:
        return 'passive'
    if 'Nicht-Mitglieder' in labels:
        return 'non_member'
    if 'probetraining' in labels:
        return 'trial'
    if 'Probetraining' in labels:
        return 'non_member'
    if link == 'active':
        return 'non_member'
    return 'active'


def has_trial_label(labels):
    """has_trial_label() in the database: probetraining in any case."""
    return isinstance(labels, list) and any(
        isinstance(label, str) and label.lower() == 'probetraining' for label in labels)


def counts(status, archived_at, labels):
    """Whether a member record lets a member account in: active or passive,
    not archived, no trial label (member_grants_access(); the sync runs
    against prod before migrations reach it, so it never calls the SQL)."""
    return status in COUNTING_STATUSES and archived_at is None and not has_trial_label(labels)


def access_status(status, labels):
    """What a member that stops counting becomes, for the log:
    member_access_status() without the archive (the sync never archives)."""
    return 'trial' if status in COUNTING_STATUSES and has_trial_label(labels) else status


StatusDrop = namedtuple('StatusDrop', 'dropping counting by_status too_many accepted predicted')


def _over_limit(dropped_from, counting_by_status):
    """Too many members stop counting at once: more than a tenth of those
    that count (at least 5), or more than half of one status (at least 5:
    a renamed Passiv group alone stays under a tenth)."""
    dropping = sum(dropped_from.values())
    counting = sum(counting_by_status.values())
    return dropping > max(5, counting // 10) or any(
        n > max(5, counting_by_status[status] // 2) for status, n in dropped_from.items())


def _known(rows):
    """Rows by id; rows without membership_status (a database before
    phase 1a, or test fakes) are left out."""
    return {row['id']: row for row in rows if row.get('membership_status')}


def _counts_row(row):
    return counts(row['membership_status'], row.get('archivedAt'), row.get('labels'))


def _counting_by_status(before):
    return Counter(row['membership_status'] for row in before.values() if _counts_row(row))


def plan_status_drop(current, rows, accept=None, predict=None):
    """Whether this run would take too many members out of the club area.

    current: the members rows in the Webling id range before the run
             ({id, membership_status, archivedAt, labels})
    rows:    the rows this run writes ({id, labels, ...})
    predict: labels -> the status the database derives for them with an
             active link. The sync passes the database's own rule
             (database_status_rule() in webling.py); status_from_labels()
             is the default for the tests.

    A member account only gets in while one of its records counts. If
    Webling renames or empties a status group, or the label mapping breaks,
    every member account would be locked out at once (staff are not). Each
    written row's new status is predicted from its labels with its link
    active (write_links revives it); members Webling no longer returns are
    plan_gone's. New members cannot stop counting.

    Returns a StatusDrop: dropping (members that count now and would not),
    counting (members that count now), by_status (Counter of what the
    dropping ones would become), too_many (over the limit, see _over_limit,
    and accept is not exactly dropping), accepted (over the limit, but
    accept is exactly dropping) and predicted ({id: status} of every
    written row).
    """
    predict = predict or (lambda labels: status_from_labels(labels, 'active'))
    before = _known(current)
    counting_by_status = _counting_by_status(before)
    predicted = {}
    dropped_from = Counter()
    by_status = Counter()
    for row in rows:
        status = predict(row.get('labels'))
        predicted[row['id']] = status
        old = before.get(row['id'])
        if old is None or not _counts_row(old):
            continue
        if not counts(status, old.get('archivedAt'), row.get('labels')):
            dropped_from[old['membership_status']] += 1
            by_status[access_status(status, row.get('labels'))] += 1
    dropping = sum(dropped_from.values())
    over = _over_limit(dropped_from, counting_by_status)
    return StatusDrop(
        dropping=dropping,
        counting=sum(counting_by_status.values()),
        by_status=by_status,
        too_many=over and accept != dropping,
        accepted=over and accept == dropping,
        predicted=predicted,
    )


def status_after_run(current, after, predicted, accept=None):
    """The statuses the database derived in this run, against the prediction.

    current:   the members rows before the run (as for plan_status_drop)
    after:     the same rows read again after the run
    predicted: {id: status} of the members written in this run

    Returns (members whose status is not the predicted one, members written
    in this run that stopped counting, whether that is more than the guard
    allows). A difference means status_from_labels() and the database's
    member_status_from_labels() no longer agree, so plan_status_drop did not
    see this run as the database did.
    """
    before = _known(current)
    now = _known(after)
    surprises = sum(
        1 for i, status in predicted.items() if i in now and now[i]['membership_status'] != status)
    dropped_from = Counter(
        before[i]['membership_status'] for i in predicted
        if i in before and i in now and _counts_row(before[i]) and not _counts_row(now[i]))
    dropped = sum(dropped_from.values())
    over = _over_limit(dropped_from, _counting_by_status(before))
    return surprises, dropped, over and accept != dropped
