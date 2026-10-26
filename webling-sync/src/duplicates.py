#!/bin/python
import os
import sys

# Webling
import requests
SUPABASE_URL=os.environ.get('SUPABASE_URL')
SUPABASE_SERVICE_ROLE_KEY=os.environ.get('SUPABASE_SERVICE_ROLE_KEY')


if not SUPABASE_URL:
  print('Please export SUPABASE_URL')
  sys.exit()

if not SUPABASE_SERVICE_ROLE_KEY:
  print('Please export SUPABASE_SERVICE_ROLE_KEY (the service_role key; RLS blocks the anon key)')
  sys.exit()


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
def get(table_name):
    response = requests.get(f"{SUPABASE_URL}/rest/v1/{table_name}", headers=HEADERS)
    if response.status_code == 200:
        return response.json()
    else:
        print("Error:", response.text)
        return None

def print_usage():
    print("./duplicates.py search Schmid")

def main(cmd):
    if cmd == "search": 
        arg2 = sys.argv[2]
        for m in get(f"members?lastname=ilike.*{arg2}*"): 
            print(m["id"], m["lastname"], m["firstname"], m["birthday"], m["labels"])
    elif cmd == "merge":
        # Disabled: it only moved logs and participants to the kept member and
        # then deleted the other one, which also deleted (ON DELETE CASCADE) its
        # event registrations and attendance, grades, medals, badges, exam
        # candidates and trial e-mails, and unlinked its sign-in account. A
        # merge that moves every reference in one transaction will replace it.
        sys.exit("merge is disabled: it deleted grades, medals, badges and event attendance of the removed member")
    else:
        print(f"command {cmd} unknown")
        print_usage()
        sys.exit(1)
    sys.exit(0)
   


if __name__ == "__main__":
    if len(sys.argv) <= 1:  
        print("Missing arguments! Use it like: ")
        print_usage()
        sys.exit(1)

    main(sys.argv[1])


