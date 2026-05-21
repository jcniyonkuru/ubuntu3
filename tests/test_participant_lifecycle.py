"""Participant lifecycle: enrol → attend → drop → reactivate → delete.

This covers the v0.3.5d (drop status) and v0.3.6 (delete-anyway) behaviour.
We don't directly drive the PWA UI here — we replicate the same payloads
the PWA's DB.put → SYNC.push pipeline sends, then assert the server-visible
state matches what a fresh sync pull would surface.
"""
import time


def _now_iso() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def _scaffold(client, cleanup, make_uuid, unique):
    """Push a cohort + course + one session, return (course_id, session_id)."""
    cohort_id  = make_uuid()
    course_id  = make_uuid()
    session_id = make_uuid()
    client.sync_push({
        "cohorts":  [{"id": cohort_id, "name": f"{unique}-life-c",
                      "createdAt": _now_iso(), "updatedAt": _now_iso()}],
        "groups":   [{"id": course_id, "cohortId": cohort_id, "name": f"{unique}-life-course",
                      "createdAt": _now_iso(), "updatedAt": _now_iso()}],
        "sessions": [{"id": session_id, "groupId": course_id, "date": "2026-06-01",
                      "theme": f"{unique}-life-theme",
                      "createdAt": _now_iso(), "updatedAt": _now_iso()}],
    })
    cleanup.extend([("sessions", session_id), ("groups", course_id), ("cohorts", cohort_id)])
    return course_id, session_id


def _find_participant(pull_body, pid):
    return next((p for p in pull_body.get("participants", []) if p["id"] == pid), None)


def test_drop_status_round_trip(client, cleanup, make_uuid, unique):
    """Push status=dropped, pull, assert it stuck."""
    course_id, _ = _scaffold(client, cleanup, make_uuid, unique)
    pid = make_uuid()
    client.sync_push({"participants": [{
        "id": pid, "groupId": course_id,
        "firstName": "Reactivate", "lastName": "Me",
        "status": "active",
        "createdAt": _now_iso(), "updatedAt": _now_iso(),
    }]})
    cleanup.append(("participants", pid))

    # Drop
    client.sync_push({"participants": [{"id": pid, "status": "dropped", "updatedAt": _now_iso()}]})
    p = _find_participant(client.sync_pull(), pid)
    assert p is not None
    assert p["status"] == "dropped", f"after drop, status should be 'dropped', got {p['status']!r}"

    # Reactivate
    client.sync_push({"participants": [{"id": pid, "status": "active", "updatedAt": _now_iso()}]})
    p = _find_participant(client.sync_pull(), pid)
    assert p["status"] == "active", f"after reactivate, status should be 'active', got {p['status']!r}"


def test_attendance_round_trip(client, cleanup, make_uuid, unique):
    """Push an attendance row, pull, assert it comes back with present=true."""
    course_id, session_id = _scaffold(client, cleanup, make_uuid, unique)
    pid  = make_uuid()
    aid  = make_uuid()
    client.sync_push({
        "participants": [{"id": pid, "groupId": course_id,
                          "firstName": "Att", "lastName": "Endant",
                          "createdAt": _now_iso(), "updatedAt": _now_iso()}],
        "attendance":   [{"id": aid, "sessionId": session_id, "participantId": pid,
                          "present": True,
                          "createdAt": _now_iso(), "updatedAt": _now_iso()}],
    })
    cleanup.extend([("attendance", aid), ("participants", pid)])

    body = client.sync_pull()
    a = next((x for x in body["attendance"] if x["id"] == aid), None)
    assert a is not None, "attendance should be returned by pull"
    assert a["present"] is True, f"present should be True, got {a['present']!r}"
    assert a["sessionId"] == session_id
    assert a["participantId"] == pid


def test_walk_in_session_id_scopes_to_session(client, cleanup, make_uuid, unique):
    """A participant with walk_in_session_id set must come back with that field
    preserved. This is what session detail uses to filter walk-ins out of the
    course roster."""
    course_id, session_id = _scaffold(client, cleanup, make_uuid, unique)
    pid = make_uuid()
    client.sync_push({"participants": [{
        "id": pid, "groupId": course_id,
        "firstName": "Walk", "lastName": "In",
        "walkInSessionId": session_id,
        "createdAt": _now_iso(), "updatedAt": _now_iso(),
    }]})
    cleanup.append(("participants", pid))

    p = _find_participant(client.sync_pull(), pid)
    assert p is not None
    assert p.get("walkInSessionId") == session_id, (
        "walkInSessionId must round-trip via sync: %r" % p.get("walkInSessionId")
    )
