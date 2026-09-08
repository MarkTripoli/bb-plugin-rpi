# Phase 12: bulk archive other sidebar threads

## What shipped

The RPI sidebar replacement now has a `Select` mode in its `Other threads` group.

- Each non-RPI thread gets an accessible checkbox with a 24px target.
- `All` and `Clear` manage the visible group.
- `Archive` confirms the selected count, then delegates each archive to bb's
  `experimental_useSidebarThreadActions().archive()`. bb owns recursive child
  archiving, pane cleanup, optimistic updates, and errors.
- Leaving selection mode clears the selection so stale thread ids cannot be
  acted on later.

## Verification

```text
$ npm test
177 passed, 0 failed

$ bb plugin build
dist/server.js
dist/app.js
dist/app.css

$ bb plugin install . --yes
rpi@0.1.0 running

$ bb plugin reload rpi
rpi@0.1.0 running
```

`bb plugin types --check` also confirmed the project and host SDK pins are both
`0.4.34`. The desktop surface was not available to automate in this session.

## Deviation

The SDK exposes only single-thread `requestDelete(threadId)`, deliberately
opening bb's native recursive-delete confirmation. It has no bulk delete API,
so this phase does not simulate one by firing concurrent confirmation requests.
Bulk archive is complete; deletion remains available through bb's existing
single-thread flow.

## Open items

- If bb adds a host-owned bulk-delete action with one aggregate confirmation,
  add it beside `Archive` in the selection toolbar.
