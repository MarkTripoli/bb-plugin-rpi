# Phase 1: Scaffold + Tasks

## Shipped

- Updated `package.json` to identify the plugin as `HumanLayer`, set branding icon `Layers`, keep the server/app/skills manifest entries, and add `npm test` / `npm run build`.
- Replaced the scaffold todo example with the HumanLayer task schema, pure transition tables, task CRUD helpers, and a typed RPC contract.
- Added database migrations `0..6`, including `sessions.hydrated_at` and `launch_attempts`.
- Added the first HumanLayer nav panel with Tasks, Drafts, and New task views.
- Added the task list and board layouts, plus the draft composer with permissions, auto-advance, host/project, worktree timing, and workflow controls.
- Generated `assets/notification.mp3` with ffmpeg.
- Added node:test coverage for transition tables, slug collisions, board column derivation, and migration idempotence.

## Verification

- `npm test`

  Output excerpt:

  ```text
  ✔ migrations are idempotent
  ✔ slug generation adds -2 and -3 suffixes on collision
  ✔ board column derives from label and draft state
  ✔ creating a draft persists a row and surfaces in listTasks
  ✔ skills table keeps labels and button text
  ✔ workflow graphs match the phase plan
  ✔ auto advance table is literal
  ✔ board column derives from the current label
  ```

- `bb plugin build`

  Output excerpt:

  ```text
  dist/server.js
  dist/server.js.map
  dist/server.meta.json
  dist/app.js
  dist/app.css
  dist/app.meta.json
  ```

- `bb plugin install . --yes`

  Output excerpt:

  ```text
  Installed:
  humanlayer@0.1.0  running
  source: path:/Users/marktripoli/.bb/worktrees/env_qe438eumby/bb-plugin-humanlayer
  ```

- `bb plugin list`

  Result: `humanlayer` appeared as `running`.

- `bb plugin logs humanlayer -n 40`

  Result: no log output was emitted for this phase-1 install.

- `bb plugin remove humanlayer`

  Result: `Removed humanlayer.`

## Deviations

- `bb.skills` must be an array in this bb build, so the manifest uses `["skills"]` instead of a string path.
- The composer exposes the phase-1 draft flow and keeps `Create` disabled because session launch is not shipping yet.
- The host picker is populated through a small `listHosts` passthrough RPC so the page can render a real selector immediately.
- The fast-advance control uses the available `ArrowTurnForward` icon from the vendored registry.

## Reviewer checklist

- Manifest fields are correct and the package still builds.
- Migrations are append-only and idempotent.
- RPC schemas stay strict.
- Host-owned components are not misused.
- UI uses host token classes only and avoids hardcoded colors.
