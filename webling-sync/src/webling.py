#!/bin/python
import os
import sys
import json
import hashlib
import re

# Webling
import requests
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


# initialize client (supabase)
HEADERS = {
    'apikey': SUPABASE_SERVICE_ROLE_KEY,
    'Authorization': f"Bearer {SUPABASE_SERVICE_ROLE_KEY}",
    'Content-Type': 'application/json'
}

# Read data from the table
def get_data(table_name):
    response = requests.get(f"{SUPABASE_URL}/rest/v1/{table_name}", headers=HEADERS)
    if response.status_code == 200:
        return response.json()
    else:
        print("Error:", response.status_code, response.text)
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
      api_url = f"https://{WEBLING_DOMAIN}.webling.ch/api/1/membergroup/{id}?apikey={WEBLING_API_KEY}&format=full"
      response = requests.get(api_url)
      response.raise_for_status()
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
  api_url = f"https://{WEBLING_DOMAIN}.webling.ch/api/1/member?apikey={WEBLING_API_KEY}&format=full"

  response = requests.get(api_url)
  response.raise_for_status()

  failed = 0
  for e in response.json():
    prop = e["properties"]
    labels = get_label(e["parents"]) # membergroups -> titles
    # Only the id: logs end up in GitHub Actions, which must not hold personal data
    print(f"ID: {e['id']}, Labels: {labels}")
    data = {
        u"id": e['id'],
        u"firstname": prop["Vorname"].strip(),
        u"lastname": prop["Name"].strip(),
        u"birthday": prop["Geburtstag"],
        u"mobile": prop["Mobile"],
        u"labels": labels
    }
    # Members sign in to Administra with this address (see
    # docs/MEMBER_SIGN_IN.md). Only send it when Webling has one, so an
    # address entered in the app is not wiped by an empty Webling field.
    email = (prop.get("E-Mail") or "").strip()
    if email:
      data[u"email"] = email
    if ANONYMIZE:
      data = anonymize(e['id'], data)
    if not upsert('members', data):
      failed += 1
  return failed

def upsert(table_name, data):
    headers = {
        'apikey': SUPABASE_SERVICE_ROLE_KEY,
        'Authorization': f"Bearer {SUPABASE_SERVICE_ROLE_KEY}",
        'Content-Type': 'application/json',
        'Prefer': 'resolution=merge-duplicates'
    }
    response = requests.post(f"{SUPABASE_URL}/rest/v1/{table_name}", headers=headers, data=json.dumps(data))
    if response.status_code in [200, 201, 204]:
        return f"Updated: {data}"
    else:
        print("Error:", response.status_code, response.text)
        return None

#print(get_data("members?select=id,firstname,lastname,labels,birthday,mobile"))
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
