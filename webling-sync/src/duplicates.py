#!/bin/python
import os
import sys
import json

# Webling
import requests
SUPABASE_URL=os.environ.get('SUPABASE_URL')
SUPABASE_ANON_KEY=os.environ.get('SUPABASE_ANON_KEY')


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
def get(table_name):
    response = requests.get(f"{SUPABASE_URL}/rest/v1/{table_name}", headers=HEADERS)
    if response.status_code == 200:
        return response.json()
    else:
        print("Error:", response.text)
        return None

def update(table_name, data):
    response = requests.patch(f"{SUPABASE_URL}/rest/v1/{table_name}", headers=HEADERS, data=json.dumps(data))
    if response.status_code == 204:
        return f"Updated: {data}"
    else:
        print(f"Error: [{response.status_code}]", response.text)
        return None

def delete(table_name):
    response = requests.delete(f"{SUPABASE_URL}/rest/v1/{table_name}", headers=HEADERS) 
    if response.status_code == 204:
        return f"Deleted"
    else:
        print("Error:", response.text)
        return None

def print_usage():
    print("./duplicates.py search Schmid")
    print("./duplicates.py merge")

def main(cmd):
    if cmd == "search": 
        arg2 = sys.argv[2]
        for m in get(f"members?lastname=ilike.*{arg2}*"): 
            print(m["id"], m["lastname"], m["firstname"], m["birthday"], m["labels"])
    elif cmd == "merge":
        keep_id = input("ID to keep?: ")
        to_remove_id = input("ID to remove?: ")
        ret = input(f"Going to merge {to_remove_id} into {keep_id}, confirm? [N/y]: ")
        if "y" != ret and "Y" != ret: 
            print("aborting")
            sys.exit(0)

        print("Replace ids in logs and participation")
        update(f"participants?memberId=eq.{to_remove_id}", {"memberId": keep_id})
        update(f"logs?memberId=eq.{to_remove_id}", {"memberId": keep_id})

        print("Remove member")
        delete(f"members?id=eq.{to_remove_id}")
    else:
        print("command {cmd} unknown")
        print_usage()
        sys.exit(1)
    sys.exit(0)
   


if __name__ == "__main__":
    if len(sys.argv) <= 1:  
        print("Missing arguments! Use it like: ")
        print_usage()
        sys.exit(1)

    main(sys.argv[1])


