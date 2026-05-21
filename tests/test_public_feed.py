"""Public stories endpoint tests.

GET /api/public/stories is consumed by academyubuntu.com/news/. It returns
only stories with consent=true AND publishable=true AND not deleted. No auth
required.

These tests:
  1. Confirm the endpoint is reachable without auth (smoke).
  2. Push a story we control, mark it publishable, assert it appears.
  3. Unpublish it, assert it disappears.
"""
import time
import requests


def _now_iso() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def test_public_stories_endpoint_no_auth(base_url):
    """The public feed must be reachable with no auth header."""
    r = requests.get(f"{base_url}/api/public/stories", timeout=20)
    assert r.status_code == 200, f"public stories: {r.status_code} {r.text[:200]}"
    body = r.json()
    assert "stories" in body, "response should have a stories array"
    assert isinstance(body["stories"], list)


def test_publishing_a_story_makes_it_public(client, base_url, cleanup, make_uuid, unique):
    """Create the chain cohort → course → session → story (publishable), pull
    the public feed, confirm it appears. Then unpublish and confirm it leaves."""
    cohort_id, course_id, session_id, story_id = (
        make_uuid(), make_uuid(), make_uuid(), make_uuid()
    )
    client.sync_push({
        "cohorts":  [{"id": cohort_id, "name": f"{unique}-pub-c",
                      "createdAt": _now_iso(), "updatedAt": _now_iso()}],
        "groups":   [{"id": course_id, "cohortId": cohort_id, "name": f"{unique}-pub-course",
                      "createdAt": _now_iso(), "updatedAt": _now_iso()}],
        "sessions": [{"id": session_id, "groupId": course_id, "date": "2026-06-01",
                      "theme": f"{unique}-pub-theme",
                      "createdAt": _now_iso(), "updatedAt": _now_iso()}],
        "stories":  [{"id": story_id, "sessionId": session_id,
                      "text": f"{unique} a brave story",
                      "consent": True, "publishable": True,
                      "createdAt": _now_iso(), "updatedAt": _now_iso()}],
    })
    cleanup.extend([
        ("stories", story_id),
        ("sessions", session_id),
        ("groups", course_id),
        ("cohorts", cohort_id),
    ])

    r = requests.get(f"{base_url}/api/public/stories", timeout=20)
    assert r.status_code == 200
    public = r.json()["stories"]
    assert any(s["id"] == story_id for s in public), (
        "publishable story with consent must appear in the public feed"
    )

    # Now unpublish.
    client.sync_push({"stories": [{
        "id": story_id, "publishable": False, "updatedAt": _now_iso(),
    }]})
    r = requests.get(f"{base_url}/api/public/stories", timeout=20)
    public_after = r.json()["stories"]
    assert all(s["id"] != story_id for s in public_after), (
        "unpublished story must disappear from the public feed"
    )


def test_unconsented_story_never_publishes(client, base_url, cleanup, make_uuid, unique):
    """publishable=True but consent=False → still hidden from the public feed."""
    cohort_id, course_id, session_id, story_id = (
        make_uuid(), make_uuid(), make_uuid(), make_uuid()
    )
    client.sync_push({
        "cohorts":  [{"id": cohort_id, "name": f"{unique}-nc",
                      "createdAt": _now_iso(), "updatedAt": _now_iso()}],
        "groups":   [{"id": course_id, "cohortId": cohort_id, "name": f"{unique}-nc-course",
                      "createdAt": _now_iso(), "updatedAt": _now_iso()}],
        "sessions": [{"id": session_id, "groupId": course_id, "date": "2026-06-01",
                      "createdAt": _now_iso(), "updatedAt": _now_iso()}],
        "stories":  [{"id": story_id, "sessionId": session_id,
                      "text": f"{unique} no consent",
                      "consent": False, "publishable": True,
                      "createdAt": _now_iso(), "updatedAt": _now_iso()}],
    })
    cleanup.extend([
        ("stories", story_id), ("sessions", session_id),
        ("groups", course_id), ("cohorts", cohort_id),
    ])

    r = requests.get(f"{base_url}/api/public/stories", timeout=20)
    public = r.json()["stories"]
    assert all(s["id"] != story_id for s in public), (
        "unconsented story must NEVER appear publicly, even if publishable=true"
    )
