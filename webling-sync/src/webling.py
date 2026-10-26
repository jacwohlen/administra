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
from sync_rules import WEBLING_ID_MAX, WEBLING_ID_MIN, member_row, missing_table, plan_gone
WEBLING_API_KEY=os.environ.get('WEBLING_API_KEY')
WEBLING_DOMAIN=os.environ.get('WEBLING_DOMAIN')

SUPABASE_URL=os.environ.get('SUPABASE_URL')
SUPABASE_SERVICE_ROLE_KEY=os.environ.get('SUPABASE_SERVICE_ROLE_KEY')

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
  synced_ids = []
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
    if upsert('members', data):
      synced_ids.append(e['id'])
    else:
      failed += 1
  print(f"Synced {len(members) - failed} of {len(members)} members")
  now = datetime.now(timezone.utc).isoformat()
  if not write_links(synced_ids, now):
    failed += 1
  # Every id Webling returned counts as still there, also members that failed above
  elif not mark_gone({e['id'] for e in members}, now):
    failed += 1
  return failed

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
  response = requests.post(f"{SUPABASE_URL}/rest/v1/member_links", headers=headers, data=json.dumps(rows))
  if response.status_code in [200, 201, 204]:
    print(f"Linked {len(rows)} members to Webling")
    return True
  if is_missing_table(response):
    # Not an error: the migration with member_links has not reached this database yet
    print("Warning: member_links does not exist here yet, links skipped")
    return True
  print(f"Error: member links: {postgrest_error(response)}")
  return False

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
    response = requests.get(f"{SUPABASE_URL}/rest/v1/{path}&limit={page}&offset={len(rows)}", headers=HEADERS)
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
  links, state = get_all("member_links?connection=eq.webling&select=external_id,gone_at&order=external_id")
  if state != 'ok':
    # A missing table (migration not here yet) is not an error
    return state == 'missing'
  in_range, state = get_all(f"members?select=id&id=gte.{WEBLING_ID_MIN}&id=lt.{WEBLING_ID_MAX}&order=id")
  if state != 'ok':
    return False
  to_mark, to_adopt, too_many = plan_gone(links, [m['id'] for m in in_range], webling_ids)
  if too_many:
    # Counts only: ids of people who left are not for the public log
    active = sum(1 for link in links if link.get('gone_at') is None)
    print(f"Error: {len(to_mark)} of {active} members still in Webling would be "
          "marked as gone; too many at once, check Webling first")
    return False
  ok = True
  if to_mark:
    ids = ','.join(to_mark)
    response = requests.patch(
        f"{SUPABASE_URL}/rest/v1/member_links?connection=eq.webling&external_id=in.({ids})",
        headers=HEADERS, data=json.dumps({'gone_at': now}))
    if response.status_code in [200, 204]:
      print(f"{len(to_mark)} members are no longer in Webling")
    else:
      print(f"Error: marking members as gone: {postgrest_error(response)}")
      ok = False
  if to_adopt:
    rows = [{'connection': 'webling', 'external_id': str(i), 'member_id': i, 'gone_at': now}
            for i in to_adopt]
    headers = {**AUTH_HEADERS, 'Content-Type': 'application/json',
               'Prefer': 'resolution=ignore-duplicates,return=minimal'}
    response = requests.post(f"{SUPABASE_URL}/rest/v1/member_links", headers=headers, data=json.dumps(rows))
    if response.status_code in [200, 201, 204]:
      print(f"{len(to_adopt)} former Webling members recorded as gone")
    else:
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
