# Phase 13: inbox-first redesign of the RPI panel

Follows `docs/phases/11-dashboard-redesign.md` (pills, overlays, layout, line comments) and
`docs/phases/12-model-catalog.md` (written by the phase E worker). Branch
`bb/worktree-setup-rpi-cleanup-thr_derkgia7de`. Product record: `PRODUCT.md` (root).

## Why

The owner's verdict on the post-phase-11 panel was "really not user-friendly". An impeccable
critique (dual-agent, live screenshots at 1440/820/iPhone 14, detector) scored it 17/40 and named
two P0s: red meant "waiting for you" so red meant nothing, and the panel had no surface for "what
needs me". Snapshot: `.impeccable/critique/2026-09-07T02-41-23Z__ui-rpi-tsx.md`.

Decisions taken with the owner before any code moved:
- Direction: inbox first, "attention band over task table" (dealt by the concept seed from a
  ranked list of seven structures; the owner locked it).
- Audience: solo today, larger organization later; in-place hints and tooltips, no onboarding.
- Vocabulary: internal statuses, tables, and notification rules stay at parity with the reference workflow; the words
  on screen are ours ("Needs you", "Approve", "Failed", "Done").
- "Needs you" uses bb's `--attention` token; `--destructive` is reserved for failed and lost.
- Visual references: bb workflows card (structure, pills, collapsible groups) and pi-subagents
  fleet view (row density).
- Mocks first: five artboards on page "Redesign: inbox first" of the Paper file "BB Plugins"
  (R1 landing desktop, R2 landing 520, R3 task detail, R4 phone artifact viewer, R5 new task).

## What shipped (18 commits after `e0a4795`)

Status vocabulary (`status.ts`, pure, tested):
- `statusMeta(status)` returns text, tone, icon, and a hint sentence for every status;
  `ready_for_input` is "Needs you" / attention / MessageSquare; `failed` and `lost` are the only
  danger tones; `interrupted` is "Stopped" / muted.
- `effectiveStatus(session, taskSessions, task)`: a `ready_for_input`, `failed`, `lost`, or
  `interrupted` session becomes `superseded` once it was auto-advanced or a newer session exists
  for the same label (null labels supersede null labels only) or a later phase. Live finding
  behind it: the first build showed "Needs you 54" because every finished phase session stays
  `ready_for_input` forever. The rule brought the live count to 7 real items. `tasks.ts`
  `readAttentionCount` uses the same rule (`attentionCountForTask`) so the table chip, the band,
  and the sidebar agree in principle.
- `attentionQueue`, `attentionText`, `phaseProgress`, `workflowSteps`, `labelStep`,
  `PHASE_DESCRIPTIONS`, `plural`.

Landing (`RpiPanel`): tab strip Tasks | Drafts | Settings (real tablist; Settings finally has an
in-panel route), one Create task button, a "Needs you" band (rows = status pill with hint, task,
phase and age, what the agent wants, Open; capped at 8 with "Show N more"; `N` opens the first
item; empty state teaches), then the task table (Task + slug, Phase mini strip and label, Needs
you chip, Sessions, Updated; single List | Board segmented control; keyboard-operable rows;
two-line compact rows under 560px of measured panel width). The aside, the duplicate CTAs, the
"LIST LIST" header, and the in-panel "RPI" h1 are gone.

Task detail (`TaskDetailPage`): "All tasks" back link, title, a plain-language meta line with
tooltips (slug, workflow, worktree timing, permissions, auto-advance, model), Scratch in a
popover, "Open current session", tabs Sessions | Artifacts | Settings. The Sessions tab owns a live
phase strip (count and worst status per step, click filters, `aria-current`, description
tooltip), a dismissible tip row, and a sessions table with effective statuses, "attempt N"
titles, a "What it wants" column, and a context gauge. Minimap and Tips tabs are gone; the
`Rpi*ThreadPanel` exports still compile.

Artifacts: collapsible phase groups persisted per task, middle-ellipsis names with full-name
tooltips, type-correct icons, "Reimport files" demoted with a tooltip, list-or-viewer under the
stack breakpoint with the back control in the toolbar, one scroll owner, always-visible comment
gutter (larger on coarse pointers), versions named by session, comment send defaults to the
authoring session, confirm dialogs and toasts for deletes.

Models (`models.ts`, `listModels` RPC): the catalog comes from `bb.sdk.providers.list()` plus
`providers.models({ providerId })` per provider (the unscoped call returns one provider only),
normalized and bounded (1000 models, 50 providers). `ModelSelect` (native select with optgroups)
appears in New task, the task Settings tab, the composer banner popover, and defaults. Changing a
task's model patches the task record, so every session launched afterwards uses it.

Sidebar (`RpiThreadList`): collapsible task groups (persisted overrides; default open for the
active task and tasks that need you), needs-you chips, live sessions first as "Phase, attempt N",
done sessions folded under "N done sessions", "Other threads" group, footer link to bb's list.

Sweep: `useElementWidth` became a callback ref (its effect never re-ran after a Loading branch, so
compact mode never engaged on late-mounting pages), a11y pass (row buttons, labels, aria on icon
buttons, motion-safe pulse), type normalization enforced by `tests/ui-conventions.test.ts`
(uppercase tracking only on table headers, no 10px text, no em dashes), and the launch marker
moved to the end of the spawn prompt so bb-derived thread titles no longer start with
`<!-- rpi:launch:... -->` (`launch.ts`, tested via `extractLaunchToken`).

## Verification

Final state (`14585ce` plus the marker and cap fixes):

```
npx tsc --noEmit                      # clean
npm test                              # 229 tests, 228 pass
bb plugin build                       # clean
node .../impeccable/scripts/detect.mjs --json ui/rpi.tsx app.tsx components/ui   # exit 0, 0 findings
```

The one failing test is `tests/prose.test.ts` on em dashes inside `.rpi/tasks/rpi-cleanup/01-*`
and `03-*.md` (agent-authored task artifacts, pre-existing, untouched).

Live checks with agent-browser against the running bb (`127.0.0.1:38886`) at 1440x900, 820x900,
and iPhone 14: landing, board, task Sessions / Artifacts / Settings, new task, panel settings,
sidebar. Screenshots were used for the critique, not committed.

Re-critique (same dual-agent method): 28/40, Good band. Snapshot
`.impeccable/critique/2026-09-07T06-05-56Z__ui-rpi-tsx.md`. Trend 17 -> 28.

Subagent work: haiku for mechanical fixes, sonnet-5 for structural UI phases; every phase was
re-verified from a clean shell here and inspected on screen before the next phase started. One
sonnet run (the first attempt at the sweep) timed out after a runaway `find /` and was replaced
by three narrower runs; it left no changes.

## Deviations from the brief, and why

1. The band ranks needs_approval, then failed and lost, then ready_for_input. The Paper mock
   showed failed last; approvals block a running agent so they go first.
2. `useElementWidth` changed signature (returns `[width, ref]`) instead of a call-site patch:
   the bug was in the hook, and `ArtifactsPanel` would have hit it next.
3. Per-provider model fetch instead of one SDK call, verified live (`bb provider models --json`
   returned a single provider's catalog).
4. Table column headers keep `text-[11px] uppercase tracking-[0.2em]`; every other eyebrow was
   removed. The convention test encodes exactly that exception.
5. `ModelSelect` is a styled native `<select>`, not a vendored Radix Select: no new dependency,
   works on phones, and the catalog can be 600 options long.

## Open items (from the 28/40 re-critique, for the reviewer)

- P0: failed rows say "or retry" but a retry only exists for launch attempts; a failure the task
  has visibly moved past (an earlier step re-run) is not superseded and sits at the top of the
  band with no dismiss. Needs an inline Retry / Start fresh / Dismiss on failed rows and a rule for
  acknowledging failures.
- P1: tooltips are the teaching layer but their triggers (StatusPill, meta terms, sidebar glyph,
  artifact names) are non-focusable spans, so keyboard and touch users get none of them.
- P1: `PHASE_TIPS` copy is written to the agent ("Commit only after the human approves"); it
  needs a second-person rewrite or removal in favor of `PHASE_DESCRIPTIONS`.
- P1: phone artifact viewer header clips Preview / Raw because the inner control group does not
  wrap and version labels carry the task name.
- P2: sidebar needs-you chips count only threads present in bb's sidebar list, so they can
  disagree with the band.
- P3: task detail chrome before content on a phone (strip wraps to four rows, tip paragraph).
- "Create and start questions" should read "Create and start research questions".
- `PRODUCT.md` and `.impeccable/` are untracked; decide whether to commit them.
