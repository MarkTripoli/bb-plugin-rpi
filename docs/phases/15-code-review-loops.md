# Phase 15: code review loops and ticket kickoff

## What shipped

- Added `/rpi-review-code`, which pins the merge base and head, reviews the
  complete task-owned diff, and saves either actionable findings, a clean
  result, or a blocked review artifact.
- Added `/rpi-fix-code-review`, which validates every finding, applies the
  smallest root-cause repairs, records dispositions and verification, then
  always starts a fresh review.
- Added a branching review transition: findings continue to fixes and a clean
  review proceeds to pull request creation. The existing
  `aa_implementation_to_pr` flag can drive the loop after the user enters it.
  Missing or blocked extraction never guesses a branch.
- Added direct Review code and Create pull request actions after implementation
  and throughout the local review loop. The existing task model picker remains
  authoritative for every newly launched session.
- Added `/rpi-resolve-pr-reviews` after pull request creation. Each manual round
  re-fetches current GitHub or GitLab review state, triages every unresolved
  thread, obtains action-time confirmation, fixes confirmed findings, verifies,
  replies with evidence, and records the round. The action can be repeated until
  the current head is approved with no unresolved threads.
- Added review and PR review steps to every workflow. Oneshot and freeform keep
  their single work session, followed by the same optional manual actions.
- Added a first-session instruction for all workflow types to move exactly one
  unambiguous linked ticket to the configured ticketing system's existing active
  state.

## Verification

```text
$ npm test
239 passed, 0 failed

$ npm run check:features
93 status-bearing rows, 1 mixed: 62 full, 13 partial, 7 omitted, 12 N/A

$ npm run check:pack
npm pack contains 167 entries; dist/FEATURES.md/LICENSE/README.md present, docs/ and tests/ absent.

$ bb plugin build
dist/server.js
dist/server.js.map
dist/server.meta.json
dist/app.js
dist/app.css
dist/app.meta.json

$ bb plugin reload rpi
rpi@0.1.0 running
source: path:/Users/marktripoli/PersonalDevelopment/bb-plugin-rpi
service launch-attempt-sweep: running
```

The test suite covers both review branches, repeated fix-to-review transitions,
the post-PR human gate, terminal approved and blocked outcomes, status mapping,
final-answer extraction, structured and freeform ticket kickoff prompts,
third-party shingle checks, and prose/UI copy checks.

## Deviations and limits

- Ticket status kickoff is agent-driven and best effort. The current SDK has no
  provider-neutral ticket mutation API, and the task schema intentionally does
  not duplicate external ticket status. The first session skips safely when it
  cannot identify one ticket and one configured system.
- Pull request review rounds are human gates. The plugin does not poll reviewers,
  send replies, push commits, or resolve threads without action-time
  confirmation.
- The path-installed plugin was reloaded and reported running. No browser or
  native visual check was performed.

## Reviewer checklist

- Confirm the reloaded plugin's action menu exposes Review code and Create pull
  request on implementation and local-review sessions.
- Change the task model in the composer banner before launching a review and
  confirm the new session uses it.
- Run one findings-to-fixes-to-clean sequence and confirm the task progress strip
  groups both review labels under Review.
- Run a pull request review round on a disposable PR or MR, verify the
  confirmation boundary, replies, thread resolution, and approved terminal
  state.
- Start one task with a supported linked ticket and one without; observe the
  external status mutation in the first case and the reported safe skip in the
  second.
