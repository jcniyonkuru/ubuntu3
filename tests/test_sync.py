"""Sync engine regression tests.

The sync engine is the spine of the platform — every PWA write goes through
it. We exercise the three things that matter most: push round-trip, the pull
cursor (server_updated_at > since), and tombstone propagation.
"""
import time


def _now_iso() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


# ---------------------------------------------------------------------------
#  Round-trip
# ---------------------------------------------------------------------------

def test_push_then_pull_round_trips_a_cohort(client, cleanup, make_uuid, unique):
    """Push one cohort, pull it back, assert fields survived the round-trip."""
    cid = make_uuid()
    payload = {
        "cohorts": [{
            "id": cid,
            "name": f"{unique}-cohort",
            "region": "Test Region",
            "startDate": "2026-01-01",
            "endDate": "2026-12-31",
            "createdAt": _now_iso(),
            "updatedAt": _now_iso(),
        }],
    }
    client.sync_push(payload)
    cleanup.append(("cohorts", cid))

    body = client.sync_pull()
    found = next((c for c in body["cohorts"] if c["id"] == cid), None)
    assert found is not None, "cohort we just pushed should come back via pull"
    assert found["name"] == f"{unique}-cohort"
    assert found["region"] == "Test Region"
    assert found["startDate"] == "2026-01-01"
    assert found["endDate"]   == "2026-12-31"
    assert found.get("deletedAt") is None
    assert found.get("authorId") == client.user_id, "server should stamp authorId from the session"


# ---------------------------------------------------------------------------
#  Pull cursor
# ---------------------------------------------------------------------------

def test_pull_cursor_filters_to_recent_changes(client, cleanup, make_uuid, unique):
    """A `since` later than now should return no rows for that cohort."""
    cid = make_uuid()
    client.sync_push({"cohorts": [{
        "id": cid, "name": f"{unique}-cursor", "createdAt": _now_iso(), "updatedAt": _now_iso(),
    }]})
    cleanup.append(("cohorts", cid))

    # Get serverTime and use a moment AFTER it
    body = client.sync_pull()
    server_time = body["serverTime"]
    future = server_time.replace(server_time[:4], str(int(server_time[:4]) + 1))  # +1 year

    later = client.sync_pull(since=future)
    assert all(c["id"] != cid for c in later["cohorts"]), (
        "pull with a future `since` should not include our just-pushed cohort"
    )


# ---------------------------------------------------------------------------
#  Tombstones
# ---------------------------------------------------------------------------

def test_soft_delete_propagates_as_tombstone(client, make_uuid, unique):
    """Soft-deleted rows come back from pull with deletedAt set.

    This is the contract the PWA's applyPull relies on to mirror deletions
    across devices. If it ever stops, deletions silently fail to propagate.
    """
    cid = make_uuid()
    client.sync_push({"cohorts": [{
        "id": cid, "name": f"{unique}-delete", "createdAt": _now_iso(), "updatedAt": _now_iso(),
    }]})

    # Confirm it's alive first
    body = client.sync_pull()
    assert any(c["id"] == cid and not c.get("deletedAt") for c in body["cohorts"]), (
        "cohort should appear alive before delete"
    )

    # Soft-delete
    client.sync_push({"cohorts": [{"id": cid, "deletedAt": _now_iso()}]})

    # Now it must come back with deletedAt set (this is what other devices use to know)
    body = client.sync_pull()
    found = next((c for c in body["cohorts"] if c["id"] == cid), None)
    assert found is not None, "tombstoned cohort must still be returned by pull"
    assert found.get("deletedAt"), "tombstone must carry a non-empty deletedAt"


# ---------------------------------------------------------------------------
#  Hierarchy
# ---------------------------------------------------------------------------

def test_course_and_session_round_trip(client, cleanup, make_uuid, unique):
    """Push a cohort → course → session chain and confirm the pull returns all three."""
    cohort_id = make_uuid()
    course_id = make_uuid()
    session_id = make_uuid()

    client.sync_push({
        "cohorts": [{"id": cohort_id, "name": f"{unique}-c", "createdAt": _now_iso(), "updatedAt": _now_iso()}],
        "groups":  [{"id": course_id, "cohortId": cohort_id, "name": f"{unique}-course",
                     "createdAt": _now_iso(), "updatedAt": _now_iso()}],
        "sessions": [{"id": session_id, "groupId": course_id, "date": "2026-06-01",
                      "theme": f"{unique}-theme",
                      "createdAt": _now_iso(), "updatedAt": _now_iso()}],
    })
    cleanup.extend([("sessions", session_id), ("groups", course_id), ("cohorts", cohort_id)])

    body = client.sync_pull()
    assert any(c["id"] == cohort_id for c in body["cohorts"])
    assert any(g["id"] == course_id for g in body["groups"])
    sess = next((s for s in body["sessions"] if s["id"] == session_id), None)
    assert sess is not None
    assert sess["groupId"] == course_id
    assert sess["theme"] == f"{unique}-theme"
    assert sess["date"]  == "2026-06-01"
