# Phase 20: Task and session controls

Individual sessions can now be marked done manually and reopened. Each task has a three-dot menu containing New chat, Mark done or Reopen, Archive, and Delete.

Worktree: `.worktrees/feature/manual-task-completion`. Branch: `feature/manual-task-completion`, based on `origin/main` at `accbf62`. The live plugin is installed from this worktree.

## Shipped behavior

- Session menus and task session tables expose Mark done and Reopen. Marking a session done moves it into the sidebar's collapsed done group. Show done sessions reveals manually completed sessions in the task table.
- Manual session completion is a separate persisted flag, never a replacement for BB's derived session status. Runtime status updates do not clear it. Completed sessions no longer contribute to Needs you or the task's attention count.
- The shared task dropdown replaces the separate plus and check controls. It is also used in task lists, board cards, and task details. New chat preserves the sidebar's current-session choice.
- Task completion is independently reversible. Show done reveals hidden tasks in the main panel and sidebar. Grouping happens before filtering, so hidden task sessions and descendants cannot spill into Other threads.
- Archive uses the existing task/session archive cascade. Delete requires confirmation, removes RPI task data transactionally, and clears its in-memory session and child bindings. BB conversations and worktree files are kept, as the dialog states.
- Deletion rejects running sessions and unresolved launches. Deleted task slugs remain reserved, preventing a new task from reusing a retained mirror directory. A failed database deletion rolls back all related rows.
- Completion does not stop agents or change auto-advance settings. It is a manual organization control. No artifacts or conversations are removed by marking a task or session done.

## Verification

`rtk npm test` includes typechecking and passed:

```text
tests 247
pass 247
fail 0
skipped 0
```

New regression checks cover completion migration, strict boolean validation, independent session completion, preservation of derived status, task visibility filters, attention counts, reopening, preserved artifacts and sessions, realtime publication, deletion isolation, running/launch guards, transaction rollback, and slug reservation.

`rtk proxy bb plugin build` passed:

```text
dist/server.js
dist/server.js.map
dist/server.meta.json
dist/app.js
dist/app.css
dist/app.meta.json
```

`rtk git diff --check` passed. Installation and reload report `rpi@0.1.0 running` from the feature worktree.

Browser checks at desktop width:

- The task dropdown contains New chat, Mark done, Archive, and Delete; keyboard End and Enter open the delete confirmation.
- The delete dialog explicitly describes retained BB conversations and worktree files. Cancel was exercised without deleting task data.
- A real session's existing three-dot menu displays Mark done. Its state mutation and reopening are covered by the isolated RPC/database test; existing user sessions were not marked done for testing.
- Disposable draft checks established hide, Show done, Reopen, board completion, and persistence across a live plugin reload. The final dropdown Mark done action also removed its fixture from the active list. Both disposable drafts were archived after verification.
- Screenshots confirmed the task dropdown layout and replacement of the sidebar's plus/check controls.

No agent session was launched for verification. New chat reuses the existing tested launch/fork paths; it was not activated in the browser. Narrow layout and hiding a live session with descendants were inspected in code rather than tested against a live fixture.

## Deviations and reviewer notes

This extends the original task/session phases without changing their workflow-state rules. Archive cannot serve as a manual done marker because it archives BB threads too.

Three wording changes in the inherited phase 18 document fix an existing naming-test failure. The check itself was not weakened.

The fake-host reload path closes the database shared by plugin generations. Reload persistence was therefore checked against the running host. Repeated RPC reads and reopening are covered deterministically.

No new dependencies or CLI commands were added. Delete currently preserves BB threads; deletion of those conversations remains available through BB's thread controls. Repository files mirrored into worktrees also remain available outside RPI.
