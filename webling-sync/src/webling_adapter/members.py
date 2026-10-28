"""Webling members as layer records (integration_stage, kind 'members').

The fields and values are the ones the legacy sync writes (member_row()
in sync_rules.py): names trimmed, birthday and mobile as Webling has them,
the e-mail only when Webling has one (the layer only fills it). Groups go
up with their Webling id and raw title; the layer's catalog maps them to
labels and statuses (04_Probetraining becomes the label Probetraining).
"""
from safe_log import WeblingError

# Layer key -> Webling property. A missing property (renamed in Webling)
# must not blank everyone's name: the member is sent as a problem instead
# (seen, so not gone, but not written).
FIELDS = {'firstname': 'Vorname', 'lastname': 'Name', 'birthday': 'Geburtstag', 'mobile': 'Mobile'}
EMAIL = 'E-Mail'


def member_record(raw, titles):
    """One member object of W1 as a record. titles: {group id: title}, with
    None for a group whose title could not be read."""
    external_id = str(raw['id'])
    properties = raw.get('properties') if isinstance(raw.get('properties'), dict) else {}
    if any(name not in properties for name in FIELDS.values()):
        return {'external_id': external_id, 'data': {'problem': 'missing_field'}}
    parents = raw.get('parents') if isinstance(raw.get('parents'), list) else []
    if any(titles.get(group) is None for group in parents):
        return {'external_id': external_id, 'data': {'problem': 'fetch_failed'}}
    email = (properties.get(EMAIL) or '').strip()
    return {'external_id': external_id, 'data': {
        'firstname': (properties['Vorname'] or '').strip(),
        'lastname': (properties['Name'] or '').strip(),
        'birthday': properties['Geburtstag'],
        'mobile': properties['Mobile'],
        'email': email or None,
        'groups': [{'id': str(group), 'name': titles[group]} for group in parents],
    }}


def member_records(api, counters):
    """W1, then W2 once per group (the titles are cached). Returns (records,
    fetch errors). A failed W1 raises WeblingError (the run fails: no
    record at all); a group that cannot be read marks its members
    'fetch_failed' (seen, not written, the run ends as a warning)."""
    members = api.members()
    titles = {}
    errors = 0
    records = []
    for raw in members:
        if not isinstance(raw, dict) or not isinstance(raw.get('id'), int):
            counters['without_id'] = counters.get('without_id', 0) + 1
            errors += 1
            continue
        for group in raw.get('parents') or []:
            if group in titles:
                continue
            try:
                titles[group] = api.group_title(group)
            except WeblingError as err:
                print(f"Error: {err}")
                titles[group] = None
                errors += 1
        records.append(member_record(raw, titles))
    counters['members'] = len(members)
    counters['groups'] = sum(1 for title in titles.values() if title is not None)
    counters['groups_failed'] = sum(1 for title in titles.values() if title is None)
    counters['missing_field'] = sum(1 for r in records if r['data'].get('problem') == 'missing_field')
    print(f"Webling: {len(members)} members, {counters['groups']} groups "
          f"({counters['groups_failed']} could not be read), "
          f"{counters['missing_field']} members with a missing field")
    return records, errors
