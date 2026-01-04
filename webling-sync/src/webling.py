#!/bin/python
import os
import sys
import json

# Webling
import requests
WEBLING_API_KEY=os.environ.get('WEBLING_API_KEY')
WEBLING_DOMAIN=os.environ.get('WEBLING_DOMAIN')

SUPABASE_URL=os.environ.get('SUPABASE_URL')
SUPABASE_ANON_KEY=os.environ.get('SUPABASE_ANON_KEY')


if not WEBLING_DOMAIN:
  print('Please export WEBLING_DOMAIN')
  sys.exit()

if not WEBLING_API_KEY:
  print('Please export WEBLING_API_KEY')
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

def get_label(membergroup_ids):
  labels = []
  for id in membergroup_ids:
    api_url = f"https://{WEBLING_DOMAIN}.webling.ch/api/1/membergroup/{id}?apikey={WEBLING_API_KEY}&format=full"
    response = requests.get(api_url)
    label = transform_label(response.json()['properties']['title'])
    labels.append(label)
  return labels


""" Create member in firebase for every webling """
def sync_members():
  print("fetching webling")
  api_url = f"https://{WEBLING_DOMAIN}.webling.ch/api/1/member?apikey={WEBLING_API_KEY}&format=full"

  response = requests.get(api_url)

  for e in response.json():
    prop = e["properties"]
    labels = get_label(e["parents"]) # membergroups -> titles
    print(f"ID: {e['id']}, Name: {prop['Name']}, Vorname: {prop['Vorname']}, Geburtstag: {prop['Geburtstag']}, Mobile: {prop['Mobile']}, Labels: {labels}")
    data = {
        u"id": e['id'],
        u"firstname": prop["Vorname"].strip(),
        u"lastname": prop["Name"].strip(),
        u"birthday": prop["Geburtstag"],
        u"mobile": prop["Mobile"],
        u"labels": labels
    }
    upsert('members', data)

def upsert(table_name, data):
    headers = {
        'apikey': SUPABASE_ANON_KEY,
        'Authorization': f"Bearer {SUPABASE_ANON_KEY}",
        'Content-Type': 'application/json',
        'Prefer': 'resolution=merge-duplicates'
    }
    response = requests.post(f"{SUPABASE_URL}/rest/v1/{table_name}", headers=headers, data=json.dumps(data))
    if response.status_code == 200:
        return f"Updated: {data}"
    else:
        print("Error:", response.status_code, response.text)
        return None

#print(get_data("members?select=id,firstname,lastname,labels,birthday,mobile"))
sync_members()

# print("Now in Firebase: ")
# members = db.collection(u'members').stream()
# for m in members:
#   print(f'{m.id} => {m.to_dict()}')




# print("get image")
# api_url = f"https://{WEBLING_DOMAIN}.webling.ch/api/1/member/3452/image/Mitgliederbild.png?apikey={WEBLING_API_KEY}&size=thumb"

# response = requests.get(api_url)
# print (response.content)
