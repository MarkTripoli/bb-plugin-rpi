# Phase 10: header and composer banner, artifact panel layout

## What shipped

### Header and composer banner

The SDK contract for `experimental_threadHeaderAction`
(`frontend-registration.md`, "A control in the thread header") is explicit:

> The row is a 48px chrome row with 28px controls. Render one inline control.
> Put taller content in a portalled popover.

`RpiThreadHeaderAction` (`ui/rpi.tsx`) previously rendered eight controls into
that row (phase pill, status, context gauge, context-high banner, Proceed,
Suggested next, Iterate, Fork, Interrupt), which overlapped bb's own VS Code
and side-panel buttons on the right edge of the header at normal window
widths.

**Before**: one `h-7`-button-per-affordance row, eight items wide, no wrap.

**After**:
- Header (`RpiThreadHeaderAction`): phase pill, `SessionStatus`,
  `ContextGauge`, and one `size-7` icon button (accessible name "RPI session
  actions") that opens a portalled `Popover` (`components/ui/popover.tsx`,
  vendored from the already-installed `@radix-ui/react-popover` the same way
  `dialog.tsx` vendors `@radix-ui/react-dialog`, no new dependency) containing
  Iterate, Fork, Interrupt. Same handlers, same `showIterateConfirmation`
  confirm and `reportLaunchError` as before.
- Composer banner (`RpiComposerBanner`, registered via
  `app.composer.customize({ id: "rpi-session", scopes: ["thread"], banners:
  [{ id: "next-step", chrome: "bare", component: RpiComposerBanner }] })` in
  `app.tsx`): the context-high notice, Proceed, and Suggested next, same RPCs
  (`dismissContextWarning`, `proceed`, `launchSkill`), same disable
  conditions. Reads `threadId` from `useComposerView().scope` (kind
  `"thread"` only) and renders null for any other scope kind or a non-RPI
  thread (`getSession` returns null).
- `useRpiSessionState(threadId)` (`ui/rpi.tsx`): the shared `getSession` +
  `getTaskUiState` + `listLaunchAttempts` fetch and the `rpi:sessions` /
  `rpi:ui-state` realtime refetch, used by both components so the fetch logic
  is not duplicated. `setViewingSession`, the `usePanelHotkeys` archive
  (`⌘E`) wiring, and the `RpiNotificationBridge` mount stay in the header
  exactly as before; they are unrelated to which affordances render where.
- `shouldShowComposerBanner` (`transitions.ts`): pure visibility decision for
  the banner. A quiet session (no extraction, no suggestion, no context
  warning) renders no banner at all; a context-high warning alone still shows
  the banner even when the session is otherwise quiet, since dismissing it is
  itself an affordance the user needs. Covered by `tests/transitions.test.ts`.

No RPC, extraction, auto-advance, or notification behavior changed; this is a
placement-only change confirmed by `git diff --stat` touching only
`ui/rpi.tsx`, `app.tsx`, `transitions.ts`, and their tests/docs.

### Artifact panel layout (part B)

`ArtifactsPanel` rendered a `lg:grid-cols-[...]` list/viewer split, and
`ArtifactViewer` nested inside it a second `lg:grid-cols-[...]`
preview/comments split. Both read the browser viewport (`lg:`), not the
panel's own width, so a wide window with a narrow side panel (~900px) forced
the desktop three-column layout into a panel that could not fit it: the
preview column collapsed to ~150px, one word per line.

**Before**: two independent `lg:`-breakpoint grids, no resize, three columns
whenever the viewport happened to be wide regardless of panel width.

**After**: `artifactLayoutMode(panelWidth, viewerWidth)`
(`artifact-layout.ts`, pure, tested at the 759/760 and 619/620 boundaries)
decides the whole panel's arrangement from its own measured width
(`useElementWidth`, a `ResizeObserver` on the panel/viewer root, measured with
`useLayoutEffect` to avoid a one-frame flash):

- panel width < 760px: everything stacks (list as a collapsible `<details>`
  section, viewer below, comments as a collapsible section under the
  preview) regardless of viewer width.
- panel width >= 760px: list left, viewer right, with a draggable divider
  (`SplitHandle`) between them. Inside the viewer, comments render as a right
  rail (with its own `SplitHandle`) only when the viewer itself measures at
  least 620px wide; otherwise comments stack under the preview.

Both dividers are plain pointer-event handles (`onPointerDown` +
`setPointerCapture`, `pointermove` updates width in memory only,
`pointerup` persists), 6px, `cursor-col-resize`, `role="separator"`
`aria-orientation="vertical"` `tabIndex=0`, arrow keys move 16px and persist
immediately. Widths persist to `localStorage` under
`rpi.artifacts.split.list` / `rpi.artifacts.split.comments`: the contract's
`getTaskUiState`/`setTaskUiState`-shaped RPCs are keyed to specific named UI
state fields (`taskUiStateSchema`, `contract.ts`), not a generic key/value
path, so there is nothing to extend there without widening the schema for a
purely client-local preference. List width clamps to 200-480px, comments
rail to 260-520px (`ARTIFACT_LIST_WIDTH_RANGE`/`ARTIFACT_COMMENTS_WIDTH_RANGE`,
`artifact-layout.ts`).

Every existing behavior (Preview/Raw toggle, version select, restore banner,
block hover comment button, comment composer, send-to-session, show
resolved, load more) is unchanged; the preview and comment JSX moved into
`previewNode`/`commentRailNode`/`listNode`/`viewerNode` variables so the same
markup renders in either arrangement instead of being duplicated. Preview
column and comments rail are both `min-w-0` (comments rail is never a fixed
`320px`), so prose wraps normally in a narrow rail instead of one word per
line.

Confined to `ui/rpi.tsx` plus the new `artifact-layout.ts` pure module and
its test, per the task's "ui/rpi.tsx only" scope for the layout change
itself.

## Verification

- `npm test`: 164/164 passing, including
  `tests/transitions.test.ts` (`shouldShowComposerBanner`) and the new
  `tests/artifact-layout.test.ts` (`artifactLayoutMode`/`clampWidth`
  boundaries).
- `npx tsc --noEmit`: clean.
- `bb plugin build`: clean (`dist/server.js`, `dist/app.js`, `dist/app.css`).
- `npm run check:pack`: clean (dist/FEATURES.md/LICENSE/README.md present,
  docs/ and tests/ absent from the pack).
- `bb plugin types --check`: pin 0.4.34 matches host 0.4.34.

## Deviations from the task and why

- The composer banner's visibility rule additionally shows the banner when
  only the context-high warning applies (no extraction, no suggestion). The
  task's one-line description ("hide entirely when the session has no
  extraction AND no suggestion") did not name the context warning as an
  exception, but `shouldShowComposerBanner`'s own parameter list includes
  `contextWarn`/`dismissed`, and hiding a live, dismissible context warning
  because no other affordance happened to apply would silently drop a real
  user action. Documented in the function's own comment in `transitions.ts`.
- `SplitHandle`'s comments-rail divider negates the drag delta before handing
  it to the rail's width state, since the divider sits between the preview
  (grows left-to-right) and the rail (anchored to the panel's right edge):
  dragging the handle right must grow the preview and shrink the rail, the
  opposite sign from the list divider (dragging right grows the list). Noted
  inline at each call site.

## Open items for the reviewer checklist

- No visual/manual pass was done in the bb desktop app or an environment
  simulator for this change; verification is `npm test` + `tsc` + `bb plugin
  build` + `check:pack` only. Installing this worktree with `bb plugin
  install . --yes` would move the live "rpi" plugin's source path away from
  the primary checkout, so that step was left to the reviewer.
- The list/comments split widths persist to `localStorage`, not
  `task_ui_state`, so they are a per-browser preference, not a per-task one
  synced across devices (see "Persist widths" above for why no generic
  `task_ui_state` key path exists to hang this off of).
