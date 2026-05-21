"""Multi-facilitator course tests.

`groups_.facilitator_ids` is the v0.3.5i feature: a JSON array of user UUIDs
encoded by Sync::normaliseValue on push and decoded by denormaliseValue on
pull. The tests verify the array survives a full round-trip and that empty
arrays come back as [] (not null), so client-side picker code can rely on
Array.isArray.
"""
from __future__ import annotations
import time


def _now_iso() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def _find_group(pull_body: dict, gid: str) -> dict | None:
    return next((g for g in pull_body.get("groups", []) if g["id"] == gid), None)


def test_facilitator_ids_round_trip(client, cleanup, make_uuid, unique):
    """Push two staff UUIDs into facilitatorIds, pull, assert the array survived."""
    # Use the admin's own id plus a second one we make up. The fake UUID won't
    # resolve to a real user — that's fine; the storage layer doesn't enforce
    # the link (see data-model doc, §3.5). What we're testing is the JSON
    # encode/decode boundary.
    admin_id = client.user_id
    fake_id  = make_uuid()
    cohort_id = make_uuid()
    course_id = make_uuid()

    client.sync_push({
        "cohorts": [{"id": cohort_id, "name": f"{unique}-c",
                     "createdAt": _now_iso(), "updatedAt": _now_iso()}],
        "groups":  [{
            "id": course_id, "cohortId": cohort_id,
            "name": f"{unique}-fac-course",
            "facilitator": "Admin, Phantom",   # legacy display field
            "facilitatorIds": [admin_id, fake_id],
            "createdAt": _now_iso(), "updatedAt": _now_iso(),
        }],
    })
    cleanup.extend([("groups", course_id), ("cohorts", cohort_id)])

    body = client.sync_pull()
    g = _find_group(body, course_id)
    assert g is not None, "course should be returned by pull"
    assert isinstance(g.get("facilitatorIds"), list), (
        "facilitatorIds must come back as a list (got %r)" % type(g.get("facilitatorIds"))
    )
    assert set(g["facilitatorIds"]) == {admin_id, fake_id}, (
        "facilitatorIds should round-trip exactly: %r" % g["facilitatorIds"]
    )
    # Legacy display field stays intact for back-compat.
    assert g.get("facilitator") == "Admin, Phantom"


def test_empty_facilitator_ids_is_empty_list_on_pull(client, cleanup, make_uuid, unique):
    """A course saved with no facilitators must come back as [] not null."""
    cohort_id = make_uuid()
    course_id = make_uuid()
    client.sync_push({
        "cohorts": [{"id": cohort_id, "name": f"{unique}-c",
                     "createdAt": _now_iso(), "updatedAt": _now_iso()}],
        "groups":  [{
            "id": course_id, "cohortId": cohort_id, "name": f"{unique}-empty",
            "facilitatorIds": [],
            "createdAt": _now_iso(), "updatedAt": _now_iso(),
        }],
    })
    cleanup.extend([("groups", course_id), ("cohorts", cohort_id)])

    g = _find_group(client.sync_pull(), course_id)
    assert g is not None
    assert g.get("facilitatorIds") == [], (
        "empty facilitators must come back as []: %r" % g.get("facilitatorIds")
    )


def test_facilitator_ids_can_be_updated(client, cleanup, make_uuid, unique):
    """A second push with a different list must replace, not merge."""
    cohort_id = make_uuid()
    course_id = make_uuid()
    a, b, c_ = make_uuid(), make_uuid(), make_uuid()

    # First save: a + b
    client.sync_push({
        "cohorts": [{"id": cohort_id, "name": f"{unique}-c",
                     "createdAt": _now_iso(), "updatedAt": _now_iso()}],
        "groups":  [{"id": course_id, "cohortId": cohort_id, "name": f"{unique}-u",
                     "facilitatorIds": [a, b],
                     "createdAt": _now_iso(), "updatedAt": _now_iso()}],
    })
    cleanup.extend([("groups", course_id), ("cohorts", cohort_id)])
    g = _find_group(client.sync_pull(), course_id)
    assert sorted(g["facilitatorIds"]) == sorted([a, b])

    # Second save: c only
    client.sync_push({"groups": [{
        "id": course_id, "facilitatorIds": [c_], "updatedAt": _now_iso(),
    }]})
    g = _find_group(client.sync_pull(), course_id)
    assert g["facilitatorIds"] == [c_], (
        "second push should replace facilitatorIds, not merge: %r" % g["facilitatorIds"]
    )
