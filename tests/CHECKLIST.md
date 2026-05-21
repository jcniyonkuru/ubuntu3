# What each test pins down

Quick reference for what breaks if a specific test fails.

| Test file | Test | If it fails… |
| --- | --- | --- |
| `test_auth.py` | `test_login_with_correct_credentials_returns_token` | Login is broken — every other test will fail. Check Auth.php and the bcrypt verify path. |
| | `test_login_with_wrong_password_is_rejected` | The server is accepting bad passwords. Critical. |
| | `test_authed_endpoint_requires_token` | Routes that should require auth are now open. Critical. |
| | `test_admin_session_can_pull` | `/sync/pull` is broken. Every PWA will be unable to refresh. |
| `test_sync.py` | `test_push_then_pull_round_trips_a_cohort` | Sync push is broken or a field stopped surviving the boundary. |
| | `test_pull_cursor_filters_to_recent_changes` | The `since` cursor is misbehaving — pulls will return way too much data. |
| | `test_soft_delete_propagates_as_tombstone` | Soft deletes no longer flow across devices. PWA tablets will keep showing rows other devices deleted. |
| | `test_course_and_session_round_trip` | The four-level hierarchy push (cohort → course → session) is broken. |
| `test_users.py` | `test_create_trainee_then_list_finds_them` | The base POST /users + GET /users is broken. |
| | `test_create_trainee_with_existing_email_reuses` | Duplicates will start appearing. Check the reuse-by-email branch in Users::create. |
| | `test_staff_endpoint_returns_only_trainer_and_admin` | The new facilitators picker will show trainees in the staff list. |
| | `test_synthetic_email_is_accepted` | The PWA "+ Create new" walk-in path will fail when no email is given. |
| `test_facilitators.py` | `test_facilitator_ids_round_trip` | The v0.3.5i JSON encode/decode boundary is broken — facilitators silently disappear. |
| | `test_empty_facilitator_ids_is_empty_list_on_pull` | Pulls return null instead of []; the PWA picker will crash on Array.isArray. |
| | `test_facilitator_ids_can_be_updated` | Edits to facilitator list don't replace cleanly. |
| `test_moodle_news.py` | `test_news_default_since_returns_full_counts` | Header bell endpoint is broken. PWA will silently stop showing notifications. |
| | `test_news_with_far_future_since_returns_zero` | News count is leaking — bell will light up forever. |
| | `test_news_endpoint_requires_auth` | News endpoint is publicly accessible. Critical. |
| `test_public_feed.py` | `test_public_stories_endpoint_no_auth` | academyubuntu.com/news/ will stop showing stories. |
| | `test_publishing_a_story_makes_it_public` | The publish toggle doesn't take effect — admin actions broken. |
| | `test_unconsented_story_never_publishes` | Privacy violation: stories without consent are leaking publicly. **Most critical** test in the suite. |
| `test_participant_lifecycle.py` | `test_drop_status_round_trip` | drop / reactivate flow is broken. |
| | `test_attendance_round_trip` | Attendance no longer persists or reads back. |
| | `test_walk_in_session_id_scopes_to_session` | Walk-ins will start polluting the course roster. |

## When to run

| Trigger | Run |
| --- | --- |
| Before tagging a release | All tests. |
| After deploying a server-side change | Full suite. |
| After deploying a PWA-only change | `test_auth.py test_sync.py` minimum. |
| Investigating a bug | The matching file + its neighbours. |
| Once a week as smoke | `./run.sh` from cron. |

## Test record cleanup

Every record created carries a `TEST-<timestamp>-` prefix. To purge any orphans (from an aborted run), in the admin console:

1. Cohorts → spot anything matching `TEST-*`, delete.
2. Trainees → tick **Show merged / disabled**, search for `@ubuntu3-tests.local`, delete.
3. Stories → look for `TEST-` in story text, delete.

The cleanup fixture handles this automatically when tests run to completion; manual cleanup is only needed after a crash or Ctrl-C.
