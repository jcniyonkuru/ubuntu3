"""Authentication regression tests.

The admin login flow is the foundation of every other test — if it breaks
nothing else can run. These tests use a fresh Client (not the shared session
fixture) so they don't taint the global auth state.
"""
import pytest
import requests

from conftest import Client, _env


def test_login_with_correct_credentials_returns_token(base_url):
    c = Client(base_url)
    c.login(_env("TEST_ADMIN_EMAIL"), _env("TEST_ADMIN_PASSWORD"))
    assert c.token is not None
    assert len(c.token) > 20  # plausible token length
    assert c.user_id, "login response should include user.id"


def test_login_with_wrong_password_is_rejected(base_url):
    c = Client(base_url)
    with pytest.raises(requests.HTTPError) as exc:
        c.login(_env("TEST_ADMIN_EMAIL"), "definitely-not-the-password")
    assert exc.value.response.status_code in (400, 401, 403), (
        "wrong-password should return a 4xx, got " + str(exc.value.response.status_code)
    )


def test_login_with_unknown_email_is_rejected(base_url):
    c = Client(base_url)
    with pytest.raises(requests.HTTPError) as exc:
        c.login("noone-ever-" + base_url.replace("https://", "") + "@ubuntu3.local", "x")
    assert exc.value.response.status_code in (400, 401, 403)


def test_authed_endpoint_requires_token(client, base_url):
    """A request without an Authorization header must be rejected on a protected route."""
    r = requests.post(
        f"{base_url}/api/sync/pull",
        json={"since": "1970-01-01T00:00:00Z"},
        timeout=20,
    )
    assert r.status_code in (401, 403), f"expected 401/403, got {r.status_code}"


def test_admin_session_can_pull(client):
    """Smoke check that the shared admin client can hit the sync engine."""
    body = client.sync_pull()
    assert "serverTime" in body, "pull response should include serverTime"
    # Every known entity should be a list (even if empty)
    for k in ("cohorts", "groups", "participants", "sessions", "attendance", "stories"):
        assert isinstance(body.get(k), list), f"{k} missing or not a list in pull response"
