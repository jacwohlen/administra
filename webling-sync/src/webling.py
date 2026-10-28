#!/bin/python
import os
import sys
import json
import hashlib
import re

# Webling
import requests
from safe_log import WeblingError, postgrest_error, webling_check, webling_get
from datetime import datetime, timezone
from sync_rules import (
    WEBLING_ID_MAX,
    WEBLING_ID_MIN,
    member_row,
    missing_table,
    plan_gone,
    plan_status_drop,
    status_after_run,
)
WEBLING_API_KEY=os.environ.get('WEBLING_API_KEY')
WEBLING_DOMAIN=os.environ.get('WEBLING_DOMAIN')

SUPABASE_URL=os.environ.get('SUPABASE_URL')
SUPABASE_SERVICE_ROLE_KEY=os.environ.get('SUPABASE_SERVICE_ROLE_KEY')

# A run that would mark more members as gone than the mass guard allows does
# so only if this is exactly that number: set by hand (workflow input
# accept_gone) after checking the deletions in Webling.
ACCEPT_GONE = os.environ.get('WEBLING_ACCEPT_GONE', '').strip()
ACCEPT_GONE = int(ACCEPT_GONE) if ACCEPT_GONE.isdigit() else None

# The same for members that would lose their active or passive membership
# (workflow input accept_status_drop, see plan_status_drop in sync_rules.py)
ACCEPT_STATUS_DROP = os.environ.get('WEBLING_ACCEPT_STATUS_DROP', '').strip()
ACCEPT_STATUS_DROP = int(ACCEPT_STATUS_DROP) if ACCEPT_STATUS_DROP.isdigit() else None

# Status, archive date and labels of the members in the Webling id range: the
# columns exist on prod since phase 1a, so the guard needs no newer migration
MEMBER_STATUS_QUERY = (f"members?select=id,membership_status,archivedAt,labels"
                       f"&id=gte.{WEBLING_ID_MIN}&id=lt.{WEBLING_ID_MAX}&order=id")

# Every target except prod must get anonymized members. No default on purpose:
# a forgotten setting must stop the run, not leak real data or overwrite prod.
ANONYMIZE=os.environ.get('ANONYMIZE')


if not WEBLING_DOMAIN:
  sys.exit('Please export WEBLING_DOMAIN')

if not WEBLING_API_KEY:
  sys.exit('Please export WEBLING_API_KEY')

if not SUPABASE_URL:
  sys.exit('Please export SUPABASE_URL')

if not SUPABASE_SERVICE_ROLE_KEY:
  sys.exit('Please export SUPABASE_SERVICE_ROLE_KEY (the service_role key; RLS blocks the anon key)')

if ANONYMIZE not in ('true', 'false'):
  sys.exit('Please export ANONYMIZE=true (dev/staging) or ANONYMIZE=false (prod only)')
ANONYMIZE = ANONYMIZE == 'true'


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

# Read data from the table
def get_data(table_name):
    response = requests.get(f"{SUPABASE_URL}/rest/v1/{table_name}", headers=HEADERS)
    if response.status_code == 200:
        return response.json()
    else:
        print("Error:", postgrest_error(response))
        return None

def transform_label(label):
  if label == "04_Probetraining":
    return "Probetraining"
  return label

# Most members share a handful of groups, so fetch each group title only once
group_titles = {}

def get_label(membergroup_ids):
  labels = []
  for id in membergroup_ids:
    if id not in group_titles:
      path = f"membergroup/{id}"
      response = webling_get(WEBLING_DOMAIN, WEBLING_API_KEY, path, format='full')
      webling_check(response, path)
      group_titles[id] = transform_label(response.json()['properties']['title'])
    labels.append(group_titles[id])
  return labels


FAKE_FIRSTNAMES = ["Anna", "Ben", "Clara", "David", "Elena", "Felix", "Gina", "Hugo", "Ines", "Jonas",
                   "Katja", "Luca", "Mia", "Noah", "Olivia", "Paul", "Rosa", "Simon", "Tara", "Yann"]
FAKE_LASTNAMES = ["Muster", "Beispiel", "Probst", "Tester", "Demo", "Sample", "Platzhalter", "Fiktiv",
                  "Dummy", "Ersatz", "Modell", "Vorlage", "Entwurf", "Skizze", "Kopie", "Schema"]

def anonymize(member_id, data):
  """Replace personal fields with fake values derived from the Webling id.

  Deterministic, so every run writes the same fake member and ids, labels and
  attendance stay consistent. Nothing is derived from the real values except
  the birth year, so age-based features (age groups, badges) still work.
  """
  h = int(hashlib.sha256(str(member_id).encode()).hexdigest(), 16)
  data[u"firstname"] = FAKE_FIRSTNAMES[h % len(FAKE_FIRSTNAMES)]
  data[u"lastname"] = f"{FAKE_LASTNAMES[(h >> 8) % len(FAKE_LASTNAMES)]} {member_id}"
  year = re.search(r"\d{4}", data.get(u"birthday") or "")
  data[u"birthday"] = f"{year.group()}-{(h >> 16) % 12 + 1:02d}-{(h >> 24) % 28 + 1:02d}" if year else None
  data[u"mobile"] = None
  # Always set, so a real address left over in the target is overwritten too.
  # .invalid never resolves, so the app cannot mail (or sign in) real people
  data[u"email"] = f"member-{member_id}@example.invalid"
  return data


""" Create member in firebase for every webling """
def sync_members():
  print(f"fetching webling (anonymize: {ANONYMIZE})")
  response = webling_get(WEBLING_DOMAIN, WEBLING_API_KEY, "member", format='full')
  webling_check(response, "member")

  members = response.json()
  failed = 0
  rows = []
  for e in members:
    # One broken member must not stop the others, so each one fails on its own.
    # Logs only show ids and counts: they end up in GitHub Actions, which must
    # not hold personal data (group titles include leaving and billing states)
    try:
      labels = get_label(e["parents"]) # membergroups -> titles
      data = member_row(e['id'], e["properties"], labels)
    except KeyError as err:
      print(f"Error: member {e.get('id')}: missing property {err}")
      failed += 1
      continue
    except WeblingError as err:
      # Method, path and status only, see safe_log.py
      print(f"Error: member {e.get('id')}: {err}")
      failed += 1
      continue
    except Exception as err:
      print(f"Error: member {e.get('id')}: {type(err).__name__}")
      failed += 1
      continue
    if ANONYMIZE:
      data = anonymize(e['id'], data)
    rows.append(data)

  # Nothing is written before the guard: a run that would take too many
  # members out of the club area at once writes no member, link or gone mark
  current, state = get_all(MEMBER_STATUS_QUERY)
  if state != 'ok':
    print("Error: the current membership statuses could not be read; no member written")
    return failed + 1
  rule = database_status_rule(rows)
  if rule is None:
    print("Error: the database's membership status rule could not be asked; no member written")
    return failed + 1
  plan = plan_status_drop(current, rows, ACCEPT_STATUS_DROP, rule)
  if plan.too_many:
    print(status_drop_error(plan))
    return failed + 1
  if plan.dropping:
    # A record of the nightly churn, so a drift over several nights shows
    print(status_drop_info(plan))

  synced_ids = []
  for data in rows:
    if upsert('members', data):
      synced_ids.append(data['id'])
    else:
      failed += 1
  print(f"Synced {len(members) - failed} of {len(members)} members")
  now = datetime.now(timezone.utc).isoformat()
  if not write_links(synced_ids, now):
    failed += 1
  else:
    # Every id Webling returned counts as still there, also members that failed above
    if not mark_gone({e['id'] for e in members}, now):
      failed += 1
    if not check_statuses(current, plan, synced_ids):
      failed += 1
  return failed

def database_status_rule(rows):
  """The status the database derives for each label set this run writes,
  with an active link, as the guard's predict function; None (error
  printed) when the database could not be asked.

  member_status_from_labels() is on prod since phase 1a, so the guard
  always predicts with the rule the trigger will run, also while a changed
  rule waits on main for its promotion. One call per distinct label set
  (a few dozen); the labels never reach the log.
  """
  statuses = {}
  for row in rows:
    key = json.dumps(row.get('labels'))
    if key in statuses:
      continue
    response = supabase('post', 'rpc/member_status_from_labels', headers=HEADERS,
                        data=json.dumps({'p_labels': row.get('labels'), 'p_link': 'active'}))
    if response is None:
      return None
    if response.status_code != 200 or not isinstance(response.json(), str):
      print(f"Error: membership status rule: {postgrest_error(response)}")
      return None
    statuses[key] = response.json()
  return lambda labels: statuses[json.dumps(labels)]

def became(plan):
  """What the members that stop counting become, e.g. 'left: 2, non_member: 1'.
  Counts and status names only: the log is public, and labels (leaving and
  billing states) or ids would tell who left."""
  return ', '.join(f"{status}: {n}" for status, n in sorted(plan.by_status.items()))

def status_drop_error(plan):
  """The refusal line (counts only, see became())."""
  return (f"Error: {plan.dropping} of {plan.counting} members with an active or passive "
          f"membership would lose it in this run (now {became(plan)}); nothing written. Their "
          "member accounts would be locked out. Check the membership groups in Webling "
          "(renamed or emptied?); if the changes are intended, run the workflow by hand "
          f"with accept_status_drop={plan.dropping}")

def status_drop_info(plan):
  """The line of a run that goes ahead while members stop counting (counts
  only, see became())."""
  accepted = "; accepted with accept_status_drop" if plan.accepted else ""
  return (f"{plan.dropping} of {plan.counting} members lose their active or passive "
          f"membership in this run ({became(plan)}{accepted})")

def check_statuses(current, plan, synced_ids):
  """After the run: the statuses the database derived, against the guard's
  prediction (the database's own rule, with an active link). A difference
  means the trigger saw more than labels and link (or the rule changed
  during the run): a warning, and an error if more members stopped counting
  than the guard allows."""
  after, state = get_all(MEMBER_STATUS_QUERY)
  if state != 'ok':
    print("Warning: membership statuses not checked after the run (could not be read)")
    return True
  predicted = {i: plan.predicted[i] for i in synced_ids}
  surprises, dropped, too_many = status_after_run(current, after, predicted, ACCEPT_STATUS_DROP)
  if surprises:
    print(f"::warning::{surprises} members got another membership status than the sync "
          "predicted from the database's member_status_from_labels(); check "
          "trigger_set_membership_status()")
  if too_many:
    print(f"Error: {dropped} members lost their active or passive membership in this run, "
          "more than the guard allows (it predicted fewer). Check Webling and the status rules")
    return False
  return True

def write_links(member_ids, now):
  """Record that these members come from Webling (member_links).

  Administra shows their name, birthday, contact and groups as maintained in
  Webling and keeps them read-only. One request for all members; a member
  that was gone and is back in Webling is revived.
  """
  if not member_ids:
    return True
  rows = [
      {'connection': 'webling', 'external_id': str(i), 'member_id': i,
       'last_seen_at': now, 'gone_at': None}
      for i in member_ids
  ]
  headers = {
      **AUTH_HEADERS,
      'Content-Type': 'application/json',
      'Prefer': 'resolution=merge-duplicates,return=minimal'
  }
  response = supabase('post', "member_links", headers=headers, data=json.dumps(rows))
  if response is None:
    return False
  if response.status_code in [200, 201, 204]:
    print(f"Linked {len(rows)} members to Webling")
    return True
  if is_missing_table(response):
    # Not an error: the migration with member_links has not reached this database yet
    print("Warning: member_links does not exist here yet, links skipped")
    return True
  print(f"Error: member links: {postgrest_error(response)}")
  return False

def supabase(method, path, **kwargs):
  """A Supabase REST call; None (error printed) on a network error.

  Only the exception's type is printed: its text holds the URL, which may
  hold member ids, and the log is public.
  """
  try:
    return getattr(requests, method)(f"{SUPABASE_URL}/rest/v1/{path}", **kwargs)
  except requests.RequestException as err:
    print(f"Error: Supabase {method.upper()} {path.split('?')[0]}: {type(err).__name__}")
    return None

def is_missing_table(response):
  try:
    body = response.json()
  except ValueError:
    body = None
  return missing_table(response.status_code, body)

def get_all(path):
  """Every row of a PostgREST query, page by page.

  Returns (rows, state): state 'ok', 'missing' (table not there yet) or
  'error' (printed).
  """
  rows = []
  page = 1000
  while True:
    response = supabase('get', f"{path}&limit={page}&offset={len(rows)}", headers=HEADERS)
    if response is None:
      return None, 'error'
    if response.status_code != 200:
      if is_missing_table(response):
        return None, 'missing'
      print(f"Error: reading {path.split('?')[0]}: {postgrest_error(response)}")
      return None, 'error'
    batch = response.json()
    rows.extend(batch)
    if len(batch) < page:
      return rows, 'ok'

def mark_gone(webling_ids, now):
  """Record which members Webling no longer has: they have left (membership_status
  'left') and are editable and deletable in Administra again."""
  links, state = get_all("member_links?connection=eq.webling&select=external_id,member_id,gone_at&order=external_id")
  if state != 'ok':
    # A missing table (migration not here yet) is not an error
    return state == 'missing'
  in_range, state = get_all(f"members?select=id&id=gte.{WEBLING_ID_MIN}&id=lt.{WEBLING_ID_MAX}&order=id")
  if state != 'ok':
    return False
  to_mark, to_adopt, too_many = plan_gone(links, [m['id'] for m in in_range], webling_ids, ACCEPT_GONE)
  if too_many:
    # Counts only: ids of people who left are not for the public log
    active = sum(1 for link in links if link.get('gone_at') is None)
    print(f"Error: {len(to_mark)} of {active} members still in Webling would be "
          "marked as gone; too many at once. Check Webling; if the deletions are "
          f"intended, run the workflow by hand with accept_gone={len(to_mark)}")
    return False
  ok = True
  # Ids go in the body, never in the URL (see supabase())
  headers = {**AUTH_HEADERS, 'Content-Type': 'application/json',
             'Prefer': 'resolution=merge-duplicates,return=minimal'}
  if to_mark:
    member_ids = {link['external_id']: link['member_id'] for link in links}
    rows = [{'connection': 'webling', 'external_id': e, 'member_id': member_ids[e], 'gone_at': now}
            for e in to_mark]
    response = supabase('post', "member_links", headers=headers, data=json.dumps(rows))
    if response is not None and response.status_code in [200, 201, 204]:
      print(f"{len(to_mark)} members are no longer in Webling")
    else:
      if response is not None:
        print(f"Error: marking members as gone: {postgrest_error(response)}")
      ok = False
  if to_adopt:
    rows = [{'connection': 'webling', 'external_id': str(i), 'member_id': i, 'gone_at': now}
            for i in to_adopt]
    # Never overwrites a link that exists by now
    response = supabase('post', "member_links", data=json.dumps(rows), headers={
        **headers, 'Prefer': 'resolution=ignore-duplicates,return=minimal'})
    if response is not None and response.status_code in [200, 201, 204]:
      print(f"{len(to_adopt)} former Webling members recorded as gone")
    else:
      if response is not None:
        print(f"Error: recording former Webling members: {postgrest_error(response)}")
      ok = False
  return ok

def upsert(table_name, data):
    headers = {
        **AUTH_HEADERS,
        'Content-Type': 'application/json',
        'Prefer': 'resolution=merge-duplicates'
    }
    response = requests.post(f"{SUPABASE_URL}/rest/v1/{table_name}", headers=headers, data=json.dumps(data))
    if response.status_code in [200, 201, 204]:
        return f"Updated: {data}"
    else:
        # Never the response body: constraint errors contain the whole row
        print(f"Error: member {data.get('id')}: {postgrest_error(response)}")
        return None

if __name__ == "__main__":
  failed = sync_members()
  if failed:
    # Non-zero exit so the scheduler (GitHub Actions / systemd) reports the run as failed
    sys.exit(f"{failed} member(s) failed to sync")

# print("Now in Firebase: ")
# members = db.collection(u'members').stream()
# for m in members:
#   print(f'{m.id} => {m.to_dict()}')




# print("get image")
# api_url = f"https://{WEBLING_DOMAIN}.webling.ch/api/1/member/3452/image/Mitgliederbild.png?apikey={WEBLING_API_KEY}&size=thumb"

# response = requests.get(api_url)
# print (response.content)
