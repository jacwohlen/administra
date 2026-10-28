"""Fake personal data for every target except prod (ANONYMIZE=true).

The same values as anonymize() in src/webling.py, which the legacy member
sync keeps (it cannot import this package without changing): a test pins
the two together. Applied to member records before they are staged, so
no real name ever reaches a dev database through the layer either.
"""
import hashlib
import re

FAKE_FIRSTNAMES = ["Anna", "Ben", "Clara", "David", "Elena", "Felix", "Gina", "Hugo", "Ines", "Jonas",
                   "Katja", "Luca", "Mia", "Noah", "Olivia", "Paul", "Rosa", "Simon", "Tara", "Yann"]
FAKE_LASTNAMES = ["Muster", "Beispiel", "Probst", "Tester", "Demo", "Sample", "Platzhalter", "Fiktiv",
                  "Dummy", "Ersatz", "Modell", "Vorlage", "Entwurf", "Skizze", "Kopie", "Schema"]


def anonymize(external_id, data):
    """A copy of a member record's data with fake personal fields derived
    from the external id: deterministic, so every run stages the same fake
    member. Only the birth year is kept (age groups and badges work); the
    e-mail is always set, so a real address left in the target is
    overwritten, and .invalid never resolves (no mail, no sign-in)."""
    data = dict(data)
    h = int(hashlib.sha256(str(external_id).encode()).hexdigest(), 16)
    data['firstname'] = FAKE_FIRSTNAMES[h % len(FAKE_FIRSTNAMES)]
    data['lastname'] = f"{FAKE_LASTNAMES[(h >> 8) % len(FAKE_LASTNAMES)]} {external_id}"
    year = re.search(r"\d{4}", data.get('birthday') or "")
    data['birthday'] = f"{year.group()}-{(h >> 16) % 12 + 1:02d}-{(h >> 24) % 28 + 1:02d}" if year else None
    data['mobile'] = None
    data['email'] = f"member-{external_id}@example.invalid"
    return data
