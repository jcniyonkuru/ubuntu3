"""
Shared pytest fixtures and the API client used by every test file.

Reads connection details from the environment (or a .env file next to this
conftest), logs into the admin account once per session, and exposes a small
`Client` class with helpers for the routes the tests exercise.
"""
from __future__ import annotations

import os
import time
import uuid
from typing import Any

import pytest
import requests
from dotenv import load_dotenv

# Allow a .env file beside this conftest to override env vars.
load_dotenv(os.path.join(os.path.dirname(__file__), ".env"))


def _env(name: str, default: str | None = None) -> str:
    v = os.environ.get(name, default)
    if not v:
        raise RuntimeError(
            f"Missing required env var {name}. Copy tests/.env.example to .env and fill it in."
        )
    return v


# ---------------------------------------------------------------------------
#  Client
# ---------------------------------------------------------------------------

class Client:
    """Thin wrapper around requests.Session with API-aware helpers."""

    def __init__(self, base_url: str):
        self.base = base_url.rstrip("/")
        self.sess = requests.Session()
        self.token: str | None = None
        self.user_id: str | None = None

    # ----- low-level -----
    def _hdrs(self, extra: dict[str, str] | None = None) -> dict[str, str]:
        h = {"Content-Type": "application/json", "Accept": "application/json"}
        if self.token:
            h["Authorization"] = f"Bearer {self.token}"
        if extra:
            h.update(extra)
        return h

    def request(self, method: str, path: str, **kwargs) -> requests.Response:
        url = self.base + "/api" + path
        kwargs.setdefault("headers", self._hdrs())
        return self.sess.request(method, url, timeout=20, **kwargs)

    def get(self, path: str, **kw) -> requests.Response:
        return self.request("GET", path, **kw)

    def post(self, path: str, json: Any = None, **kw) -> requests.Response:
        return self.request("POST", path, json=json, **kw)

    def patch(self, path: str, json: Any = None, **kw) -> requests.Response:
        return self.request("PATCH", path, json=json, **kw)

    def delete(self, path: str, **kw) -> requests.Response:
        return self.request("DELETE", path, **kw)

    # ----- auth -----
    def login(self, email: str, password: str) -> None:
        r = self.sess.post(
            f"{self.base}/api/auth/login",
            json={"email": email, "password": password},
            timeout=20,
        )
        r.raise_for_status()
        body = r.json()
        self.token = body["token"]
        self.user_id = body.get("user", {}).get("id")

    # ----- sync helpers (push/pull as the PWA does) -----
    def sync_push(self, payload: dict[str, list]) -> dict:
        r = self.post("/sync/push", json=payload)
        r.raise_for_status()
        return r.json()

    def sync_pull(self, since: str = "1970-01-01T00:00:00Z") -> dict:
        r = self.post("/sync/pull", json={"since": since})
        r.raise_for_status()
        return r.json()


# ---------------------------------------------------------------------------
#  Fixtures
# ---------------------------------------------------------------------------

@pytest.fixture(scope="session")
def base_url() -> str:
    return _env("TEST_BASE_URL")


@pytest.fixture(scope="session")
def client(base_url) -> Client:
    """An authenticated admin Client, shared by every test in the session."""
    c = Client(base_url)
    c.login(_env("TEST_ADMIN_EMAIL"), _env("TEST_ADMIN_PASSWORD"))
    assert c.token, "login succeeded but no token in response"
    return c


@pytest.fixture
def unique() -> str:
    """A unique, identifiable suffix for test record names.

    Use it in record names so concurrent runs (and runs against shared envs)
    don't collide, and so a bystander can spot test rows easily by their
    `TEST-` prefix.
    """
    return f"TEST-{int(time.time() * 1000)}-{uuid.uuid4().hex[:6]}"


@pytest.fixture
def make_uuid():
    """Return a function that mints fresh UUIDs (mirrors what the PWA does)."""
    return lambda: str(uuid.uuid4())


@pytest.fixture
def cleanup(client: Client):
    """Collect records to delete at test teardown.

    Usage:

        def test_x(client, cleanup, make_uuid):
            cid = make_uuid()
            client.sync_push({"cohorts": [{"id": cid, "name": "x"}]})
            cleanup.append(("cohorts", cid))

    After the test the fixture pushes a tombstone for every (entity, id) in
    the list. Failures here are warnings — they don't fail the test.
    """
    pending: list[tuple[str, str]] = []
    yield pending
    if not pending:
        return
    now = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    payload: dict[str, list] = {}
    for entity, rid in pending:
        payload.setdefault(entity, []).append({"id": rid, "deletedAt": now})
    try:
        client.sync_push(payload)
    except Exception as exc:  # noqa: BLE001 — best-effort cleanup
        print(f"[cleanup] failed to tombstone {pending}: {exc}")
