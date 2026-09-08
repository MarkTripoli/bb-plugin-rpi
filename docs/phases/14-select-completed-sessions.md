# Phase 14: select completed sessions

## What shipped

The collapsed completed-session group now has the same bulk archive controls as
Other threads.

- Select a task's completed sessions from its `Select` control.
- Use `All`, `Clear`, and `Archive` in the compact selection toolbar.
- Archiving uses bb's host-owned thread archive action, so child threads and
  open panes follow the same lifecycle as the built-in sidebar.
- Only one completed-session group is selectable at a time, preventing a stale
  selection from another task from being archived accidentally.

## Status indicator

Red is deliberate. It represents an effective session status of `failed` or
`lost`, not a generic selection or archive state. `ready_for_input` uses the
separate attention tone and `needs_approval` uses warning.

## Verification

```text
$ npm test
237 passed, 0 failed

$ bb plugin build
dist/server.js
dist/app.js
dist/app.css

$ bb plugin reload rpi
rpi@0.1.0 running
```

## Open item

BB still exposes only a single-thread destructive delete confirmation. A bulk
delete control must wait for a host API that provides one aggregate confirmation.
