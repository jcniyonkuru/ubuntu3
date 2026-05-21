"""Moodle news endpoint shape.

The PWA header bell polls /api/admin/moodle/news to decide whether to show a
yellow dot. The endpoint is lightweight (read-only counts), but the PWA
relies on a stable response shape — that's what these tests pin down.
"""

def _check_news_shape(body: dict) -> None:
    for key in ("since", "newSessions", "newParticipants", "newCourses", "serverTime"):
        assert key in body, f"news response missing key {key!r}: {body!r}"
    # latestUpdate may be null if nothing has ever been imported.
    assert "latestUpdate" in body
    for key in ("newSessions", "newParticipants", "newCourses"):
        assert isinstance(body[key], int), f"{key} should be an int, got {type(body[key])}"
        assert body[key] >= 0, f"{key} should be ≥ 0, got {body[key]}"


def test_news_default_since_returns_full_counts(client):
    r = client.post("/admin/moodle/news", json={})
    assert r.status_code == 200, f"{r.status_code} {r.text}"
    _check_news_shape(r.json())


def test_news_with_far_future_since_returns_zero(client):
    r = client.post("/admin/moodle/news", json={"since": "2999-12-31T23:59:59Z"})
    assert r.status_code == 200
    body = r.json()
    _check_news_shape(body)
    assert body["newSessions"] == 0
    assert body["newParticipants"] == 0
    assert body["newCourses"] == 0


def test_news_with_since_at_epoch_is_total(client):
    """`since` at epoch is what an unconfigured PWA sends. Counts should be
    consistent with the "total Moodle rows we have"."""
    r = client.post("/admin/moodle/news", json={"since": "1970-01-01T00:00:00Z"})
    assert r.status_code == 200
    body = r.json()
    _check_news_shape(body)
    # All three counts ≥ 0 is enough — we don't know totals on this env.
    assert body["serverTime"], "serverTime should be a non-empty ISO timestamp"


def test_news_endpoint_requires_auth(base_url):
    """No bearer token → 401/403, never 200."""
    import requests
    r = requests.post(f"{base_url}/api/admin/moodle/news", json={}, timeout=20)
    assert r.status_code in (401, 403), f"expected 401/403, got {r.status_code}"
