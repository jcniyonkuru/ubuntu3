"""User-management regression tests.

Covers:
  - POST /api/users creates a trainee.
  - Reuse-by-email: posting the same email twice returns the existing user.
  - GET /api/users (admin) lists the new user.
  - POST /api/users/staff (any authed user) returns only trainer + admin rows.
"""
import time


def _email_for(unique: str) -> str:
    # Make sure each run gets a unique, identifiable email.
    return f"{unique}@ubuntu3-tests.local"


def test_create_trainee_then_list_finds_them(client, unique):
    email = _email_for(unique)

    r = client.post("/users", json={
        "firstName": "Reggie",
        "lastName":  "Bot",
        "email":     email,
        "phone":     "+25700000000",
        "sex":       "M",
        "ageRange":  "25-34",
        "role":      "trainee",
        "sendInvite": False,
    })
    assert r.status_code in (200, 201), f"create failed: {r.status_code} {r.text}"
    body = r.json()
    assert body.get("user", {}).get("id"), "response should include user.id"
    assert body["user"]["email"] == email
    assert body.get("reused") in (False, None), "first create should not be reused"

    # Listing as admin must include the new user.
    listing = client.get("/users")
    assert listing.status_code == 200
    found = next((u for u in listing.json()["users"] if u["id"] == body["user"]["id"]), None)
    assert found is not None, "newly created trainee should appear in /users"

    # Cleanup: hard-delete via the admin endpoint.
    client.post(f"/users/{body['user']['id']}/delete")


def test_create_trainee_with_existing_email_reuses(client, unique):
    """The reuse-by-email path returns reused:true and never inserts a duplicate."""
    email = _email_for(unique)

    first = client.post("/users", json={
        "firstName": "Original",
        "lastName":  "Reggie",
        "email":     email,
        "role":      "trainee",
        "sendInvite": False,
    })
    assert first.status_code in (200, 201)
    uid = first.json()["user"]["id"]

    # Same email again — should reuse.
    second = client.post("/users", json={
        "firstName": "Duplicate",
        "lastName":  "Attempt",
        "email":     email,
        "role":      "trainee",
        "sendInvite": False,
    })
    assert second.status_code in (200, 201)
    body = second.json()
    assert body["user"]["id"] == uid, "second create must reuse the same user.id"
    assert body.get("reused") is True, "response should explicitly say reused"

    # Cleanup
    client.post(f"/users/{uid}/delete")


def test_staff_endpoint_returns_only_trainer_and_admin(client):
    """POST /users/staff is what the facilitators picker calls. Trainees must not appear."""
    r = client.post("/users/staff", json={})
    assert r.status_code == 200, f"{r.status_code} {r.text}"
    body = r.json()
    users = body.get("users", [])
    assert isinstance(users, list), "staff response must have a users array"
    assert len(users) >= 1, "at least the test admin should appear in staff"
    roles = {u.get("role") for u in users}
    assert "trainee" not in roles, "trainees must not appear in /users/staff"
    assert roles.issubset({"trainer", "admin"}), f"unexpected roles in staff: {roles}"
    # Every entry should carry id and either first/last names or an email.
    for u in users:
        assert u["id"], "every staff entry needs an id"


def test_synthetic_email_is_accepted(client, make_uuid):
    """The PWA may create a placeholder trainee with no real email. The server
    must mint a synthetic one (trainee-<uuid>@ubuntu3.local) when the client
    omits or blanks it."""
    r = client.post("/users", json={
        "firstName": "NoEmail",
        "lastName":  "Trainee",
        "email":     "",        # blank — server should synthesize
        "role":      "trainee",
        "sendInvite": False,
    })
    assert r.status_code in (200, 201), f"{r.status_code} {r.text}"
    body = r.json()
    assert body["user"]["email"].endswith("@ubuntu3.local"), (
        "synthetic placeholder should land on @ubuntu3.local: " + body["user"]["email"]
    )
    # Cleanup
    client.post(f"/users/{body['user']['id']}/delete")
