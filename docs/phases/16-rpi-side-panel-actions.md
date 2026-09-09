# Phase 16: RPI side-panel actions

## What shipped

- Replaced the five separate RPI right-panel registrations with one `RPI` action.
- Added a phase-independent workflow action hub for every RPI task session:
  - Start code review loop
  - Create pull request
  - Resolve pull request reviews
- Kept Artifacts, Workspace, Scratch, Minimap, and Tips in the same panel, and added the existing per-task model and auto-advance controls under Settings.
- Preserved composer suggestions and thread-header actions. The hub is an additional manual entry point, so a user can start or revisit either review loop without waiting for a suggested transition.
- Routed artifact directives and the existing Artifacts and Scratch command-palette entries through the consolidated panel.
- Added bounded parameter parsing for deep-linked panel views and artifact filenames.

## Verification

- `npm run typecheck`
  - Passed with no TypeScript errors.
- `npm test`
  - `tests 241`, `pass 241`, `fail 0`.
  - Includes parameter validation and a static assertion that only the `rpi` thread-panel action is registered.
- `npm run check:features`
  - `93 status-bearing rows, 1 mixed: 62 full, 13 partial, 7 omitted, 12 N/A`.
- `npm run check:pack`
  - `npm pack contains 168 entries; dist/FEATURES.md/LICENSE/README.md present, docs/ and tests/ absent.`
- `bb plugin build`
  - Built `dist/server.js`, `dist/app.js`, metadata, source maps, and CSS.
- `bb plugin reload rpi`
  - Reported `rpi@0.1.0 running` with the sweep service running.
- Live bb desktop check after refresh:
  - The right-panel action chooser showed one `RPI` plugin action instead of separate Artifacts, Workspace, Scratch, Minimap, and Tips actions.
  - The RPI hub showed all three workflow actions and all six task-tool destinations.
  - Artifacts opened from the hub and the back control returned to the hub.
  - No workflow action was launched during inspection, so the live task was not mutated.

## Deviations and decisions

- No new workflow state or RPC was added. The panel reuses the existing `launchSkill` RPC, task model control, auto-advance control, and task panels.
- The RPI action remains visible on non-RPI threads because the SDK action registration has no per-thread availability predicate. Opening it there produces the existing bounded `Not an RPI task session` state.
- Previously open legacy panel tabs can remain visible until bb is refreshed. After refresh, the action chooser exposes only the consolidated RPI action.

## Reviewer checklist

- Launch each of the three workflow actions on disposable representative tasks and confirm the new session uses the task's selected model.
- Check the hub and each nested view at narrow phone width in the remote bb shell.
- Confirm artifact permalinks still open the requested file through the RPI panel after a fresh app start.
