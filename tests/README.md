# Ubuntu 3.0 — regression test suite

Black-box HTTP tests in Python/pytest. Run them before each release to catch
regressions in the things v0.3.6 changed (sync, soft-delete, multi-facilitator
courses, reuse-by-email, Moodle news, public stories).

## Setup (once)

You need Python 3.9+ and `pip`.

```bash
cd "/Users/jniyonkuru/Documents/Claude/Projects/Ubuntu 3.0 Platform/tests"
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

## Create a dedicated test admin (once, in the admin console)

The tests need an admin account to drive every API. Don't reuse your own — these tests will create and delete data. In the admin console:

1. Staff → "+ Invite trainer".
2. Email: `regression-bot@ubuntu3.local`. First/last name: `Regression Bot`.
3. Save, copy the temporary password.
4. Sign in to the PWA as that user, change the password to something you set in a `.env` file (see below).
5. Back in the admin console, promote the user to admin (Staff → row → "Make admin").

## Configure env

Create a `.env` file next to this README:

```ini
TEST_BASE_URL=https://ubuntu3.academyubuntu.com
TEST_ADMIN_EMAIL=regression-bot@ubuntu3.local
TEST_ADMIN_PASSWORD=<the password you set>
```

`.env` is gitignored. The runner loads it automatically via `python-dotenv`.

## Run all tests

```bash
./run.sh
```

That activates the venv and runs `pytest -v --tb=short`. To re-run only failed tests: `pytest --lf`.

## What gets created

Every test record name is prefixed with `TEST-<timestamp>-` so a misconfigured run is easy to identify and purge by hand. Tests clean up after themselves — but if a test aborts mid-flight you might find stale rows; search any admin table for `TEST-` to find them.

## Files

| File | Covers |
| --- | --- |
| `conftest.py` | Shared fixtures: API client with bearer-token auth; admin login; unique-name helper. |
| `test_auth.py` | Login, wrong password, token expiry on logout. |
| `test_sync.py` | Push a cohort/course, pull it back, soft-delete propagates through tombstones. |
| `test_users.py` | Reuse-by-email, synthetic-email handling, `/users/staff` returns only trainer+admin. |
| `test_facilitators.py` | `facilitator_ids` JSON round-trip; legacy `facilitator` text mirrored on save. |
| `test_moodle_news.py` | Shape of `/api/admin/moodle/news`; counts never go negative. |
| `test_public_feed.py` | Public stories endpoint returns only consented + publishable rows. |
| `test_participant_lifecycle.py` | Create participant, attend a session, drop, reactivate, delete-anyway. |

Each file is self-contained — you can run a single file: `pytest test_sync.py -v`.

## Adding a new test

1. Drop a `test_*.py` file in this folder.
2. Use the `client` fixture from `conftest.py` for authenticated calls.
3. Use the `unique` fixture to mint a `TEST-<...>-name` so concurrent runs don't collide.
4. Clean up at the end of the test (or via a fixture `finalizer`).

## CI / scheduled runs

The suite isn't currently wired to CI. To run it from cron / GitHub Actions:

```bash
TEST_BASE_URL=...  TEST_ADMIN_EMAIL=...  TEST_ADMIN_PASSWORD=...  pytest -v
```

Exit code is 0 on success, non-zero on failure — wire to your alerting of choice.
