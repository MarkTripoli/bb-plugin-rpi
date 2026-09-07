# Phase 11: dashboard redesign (pills, overlays, panel-width layout, scroll owners, line comments)

Plan: `.rpi/tasks/rpi-cleanup/04-plan-dashboard-redesign.md` (five phases). Design
discussion: `.rpi/tasks/rpi-cleanup/03-design-discussion-dashboard-redesign.md`.
Branch `bb/worktree-setup-rpi-cleanup-thr_derkgia7de`.

## What shipped

Commits, in order:

- `e0a4795` (plan phases 1 and 2): tone-based `StatusPill` / `LabelPill` with a single
  `TONE_PILL_CLASS` table, `ROW_SHADE_CLASS` for attention and active rows, and
  `Popover` / `Dialog` replacing `<details>` menus and `window.confirm` for destructive
  confirms. All host token classes (`bg-success/10 text-success`, `bg-destructive/5
  ring-destructive/20`, ...), no hardcoded colors.
- `4e0aa32` (plan phase 3): `RpiPanel` derives its aside/main split from its own measured
  width. `artifact-layout.ts` gains `PANEL_ASIDE_STACK_BREAKPOINT = 560` and
  `panelLayoutMode(panelWidth)` ("stacked" below 560, "aside" at or above, and "aside" for an
  unmeasured 0 so first paint matches the common case). The `lg:grid-cols-[...]` viewport rule
  is gone; the grid class is applied only when the mode is "aside". `ArtifactRow`'s menu
  trigger uses `COARSE_POINTER_CHILD_ICON_BUTTON_CLASS`; `StatusPill`'s icon uses
  `COARSE_POINTER_COMPACT_ICON_SIZE_CLASS`.
- `46b6e21` (plan phase 4): one scroll owner per region in the stacked Artifacts view. The
  two permanent `<details open>` section labels (artifact list, comments) became plain
  header + content wrappers where the content div owns `overflow-auto`. The stacked wrapper
  lost its redundant `overflow-auto`. `TaskDetailPage`'s root and `RpiPanel`'s `main` are now
  flex columns so the Artifacts tab has a bounded height instead of only a `min-h-[520px]`
  floor. In stacked mode the artifact list sizes to content capped at 40% while a viewer is
  open, and fills the height when nothing is selected.
- `6f8e9ec` (plan phase 5): `markdownBlocks` returns one block per non-blank line, so the
  existing per-block "+" affordance is now per line. `MarkdownBlock` gains `code: boolean`
  (true for fence delimiter lines and every line inside a fence). `ArtifactViewer` renders
  flagged lines as `<pre>` from the raw `content.slice(start, end)` so indentation survives,
  and everything else through `<Markdown>` as before. `CommentAnchor`, `reanchor`, the RPC
  contract, `comments.ts`, and `tests/comments.test.ts` are unchanged.

### Paper mock-out

Design decision #3 in the design discussion scoped Paper to a human-side authoring aid, and
that is how it was used: no `.mcp.json`, setup script, or plugin dependency was added to the
repo. The connection is a user-global `~/.config/mcp/mcp.json` entry pointing the pi MCP
adapter at Paper Desktop's local server (`http://127.0.0.1:29979/mcp`).

Paper file "BB Plugins" (`https://app.paper.design/file/01M1R7GACYGJMVT6KR7RMVR79D/1-0`)
now holds:

- A token set mirroring bb's active theme (Dracula, dark) so mocks for this and other plugins
  read as native bb surfaces: `--color-canvas #282a36`, `--color-ink #f8f8f2`,
  `--color-primary #bd93f9`, `--color-success #50fa7b`, `--color-warning #ffb86c`,
  `--color-destructive #ff5555`, `--color-attention #f1fa8c`, `--color-accent-mono #8be9fd`,
  plus the derived tiers bb computes (`--muted-foreground` = ink 70% over canvas,
  `--subtle-foreground` = 58%, `--border` = 14%), Inter and JetBrains Mono, and the
  type/radius/spacing scale the plugin actually uses. Values were read from the theme CSS in
  the installed bb app bundle, not guessed.
- Four artboards built from the shipped code, not from imagination:
  1. `01 RPI panel / desktop, aside mode`: 1440 wide, aside + tasks table with an
     attention-shaded row, emphasis and draft `LabelPill`s.
  2. `02 RPI panel / narrow panel 520px, stacked aside`: the sub-560 state the plan's manual
     check could not exercise (bb's window was maximized and would not shrink). Shows the
     stacked aside reflowed into a single strip and compact two-line task rows.
  3. `03 Task detail / Artifacts tab, phone 390`: the three independent scroll regions from
     phase 4 (list capped, preview with the line gutter and mono code lines, comments) on a
     phone-width panel.
  4. `04 Artifact viewer / desktop split-rail, per-line comments`: list rail, preview with a
     line in the composing state and a commented code line, comments rail with the send
     controls.

## Verification

Run in the worktree after the last commit:

```
npx tsc --noEmit            # clean
npm test                    # 180 tests, 179 pass
bb plugin build             # dist/server.js, dist/app.js, dist/app.css written
bb plugin reload rpi        # live plugin now serves this worktree's build
```

The one failing test is `tests/prose.test.ts` ("repo prose contains no em dashes") on
`.rpi/tasks/rpi-cleanup/01-research-questions-dashboard-redesign.md` and
`03-design-discussion-dashboard-redesign.md`, which are agent-authored task artifacts, not
plugin source or docs. Pre-existing before this work; not touched here. The untracked
`HANDOFF-dashboard-redesign.md` also failed that check and was deleted once this document
superseded it.

New tests: `tests/artifact-layout.test.ts` gained the `panelLayoutMode` boundary case (0, 559,
560). `tests/blocks.test.ts` is new: one block per non-blank line, start/end offsets cover the
newline, fenced lines are individually anchorable and flagged `code`, trailing line without a
final newline is kept. `tests/comments.test.ts` (17 cases) passes with no edits, which is the
plan's stated invariant for phase 5.

Subagent work (phases 3 to 5 execution, `anthropic/claude-haiku-4-5-20251001`) was
re-verified independently: `git show` of each commit read in full, the three commands above
re-run from a clean shell.

## Deviations from the plan, and why

1. **Phase 3.4, `StatusPill` icon class.** The plan named
   `COARSE_POINTER_ICON_SIZE_CLASS` (`size-4` base). The pill's icon is `size-3.5` on desktop,
   so that constant would have silently grown it everywhere. `COARSE_POINTER_COMPACT_ICON_SIZE_CLASS`
   keeps `size-3.5` on fine pointers and grows to `size-5` on coarse ones, which is the
   behavior the plan was after.
2. **Phase 4.3 as written would not have produced a bounded height.** It made
   `TaskDetailPage` a `flex-1` column but left `main` as a plain grid cell. `flex-1` on a
   block child of a non-flex parent does nothing, so the Artifacts tab would still have had
   only a floor. `main` is now `flex flex-col` as well. This is one class on one element and
   is the reason the rest of 4.3 works.
3. **Phase 4.1, list sizing in stacked mode.** The plan's diff gave the list and the viewer
   equal `flex-1` shares. With three artifacts and a viewer open that hands half a phone screen
   to a list that needs 130px. The list is `max-h-[40%] shrink-0` while a viewer is open and
   `flex-1` otherwise.
4. **Phase 5.4 said "UI: no changes required". That was wrong.** Feeding each line to
   `<Markdown>` on its own turns a lone ` ```ts ` line into an unterminated fence and renders
   code lines as prose. `markdownBlocks` therefore also reports `code`, and the viewer renders
   those lines as `<pre>`. This is the smallest change that keeps fenced content readable; it
   does not touch the anchor model.
5. **Paper artboard 02 shows a reflowed aside, not the shipped one.** Rendering the shipped
   aside faithfully at 520px was done first and then replaced: it consumed 250px of a 900px
   panel before any task row and put a second primary "Create task" button 130px below the
   header's. The strip variant is a proposal, recorded below, not shipped code.

## Open items for the reviewer checklist

Manual checks from the plan that are still unconfirmed:

- Sub-560 aside collapse in the real app. Requires bb's own split view to narrow the plugin
  panel; a smaller window is not enough because the rule is panel-width based.
- Phone-width Artifacts scroll behavior (list scroll does not scroll the page, comments scroll
  does not scroll the list). Artboard 03 is the intended result; the simulator run was not
  done.
- Per-line rendering on a real plan artifact. Known consequence of phase 5, inherent to
  line-per-block plus per-block Markdown: a wrapped paragraph renders as one `<p>` per source
  line (spacing tightened to `space-y-0.5`), a list item becomes a single-item list, and table
  rows render as literal pipe text. Fixing tables means grouping contiguous lines for rendering
  while keeping line anchors, which the design discussion classified as Option B territory.
  Decide whether the current state is acceptable for a first pass before merging.

Findings surfaced by the mock-out, none applied to code yet:

- The aside's "Create task" button wraps to two lines at 220px (188px inner width vs roughly
  193px of content with the 0.2em tracking and the `T` badge) and duplicates the header CTA.
  Cheapest fix: remove it from the aside; the header already owns that action.
- In stacked mode the aside should reflow into one horizontal strip (counts inline, List/Board
  toggle right) rather than stacking its desktop layout. Artboard 02 shows this.
- The tasks table has no narrow-width layout; at 456px inner width its five columns overflow
  horizontally. Artboard 02 shows the two-line row alternative (name + time, then pill +
  sessions + slug).
- RPI artifact filenames (`NN-phase-slug.md`) truncate at the tail in the list rail, losing
  the part that distinguishes them. Middle-ellipsis or a phase label would fix it.
- In stacked mode the comments region should size to content capped at 40%, matching the list
  rule, instead of taking an equal `flex-1` share; with two threads it currently takes half
  the viewer.
