# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Primary user today: one developer (the plugin's author) running several agent-driven software tasks in parallel across multiple projects inside bb, returning to the panel between other work, and sometimes from a phone through the remote bb web shell (getbb.app). Confirmed 2026-09-06.

Planned audience: engineers in a larger organization who have not learned the RPI loop. They are not assumed to be experts. The owner wants subtle in-context hints, tooltips, and "what to do next" cues, not an onboarding flow. Confirmed 2026-09-06.

## Product Purpose

RPI (research, plan, implement) runs a software task through phases, one fresh bb agent session ("thread") per phase: research questions, research, design, plan, worktree setup, implementation, describe-pr. Each phase reads the previous phases' markdown artifacts and writes new ones. The plugin owns tasks, artifacts and their versions, line-anchored comments that flow back to the authoring agent, auto-advance between phases with human gates, notifications, and the `rpi-*` skills that drive the loop. bb owns threads, environments and worktrees, providers, permissions, and diffs.

Success for the user of the panel: knowing within seconds which sessions are waiting on them and why, acting on one in a single step, and reviewing a phase's artifact with comments the next phase will honor. Success for the product: a task reaches a PR with the human touching it only at the gates they chose.

## Positioning

A phase-per-session workflow with durable, versioned, commentable artifacts and derived session status, living inside the IDE that already owns the agent threads. A generic task tracker has none of the phase graph, the fresh-context handoff, the artifact manifest, or comments that are addressed to an agent. The reference for behavior (statuses, tables, notification rules, naming of internal states) is the reference workflow recorded in the design record; that parity is binding for internals. Display labels in the UI are the plugin's own (confirmed 2026-09-06).

## Operating Context

- Runs as a bb plugin panel (sidebar entry "RPI"), a thread header action, a composer banner, and thread-side panels. Same React/Tailwind/shadcn stack as bb; host token classes only, no hardcoded colors; the user's active bb theme applies (currently Dracula dark).
- Sessions are bb threads; the primary action on a waiting session is to open its thread and use the composer banner (Proceed, Iterate) or reply.
- Artifacts mirror to `.rpi/tasks/<slug>/` in the workspace so agents can read them; the panel reads them from the plugin database.
- Used on a wide desktop window, in bb's split view where the panel can be narrower than 560px, and on a phone through the remote shell.
- Tasks in flight at once: typically 3 to 10; sessions per task: 3 to 20 (inferred from the live database on 2026-09-06: 6 tasks, 8 to 18 sessions each).

## Capabilities and Constraints

- Session status is derived from bb state (ready_for_input, needs_approval, running, launching, resuming, failed, interrupted, lost, and settled states); the plugin never sets it. Internal names are parity-bound; UI labels are not.
- Workflow types: rpi, outline_only, prd_tdd, oneshot, freeform. Worktree timing: now, later, never. Permission mode per task. Auto-advance per transition with fixed human gates.
- Artifacts: markdown and binary, versioned, soft-deletable, restorable, hydrated from the workspace on demand. Comments anchor per line (since 2026-09-06), re-anchor across versions, and can be sent to a chosen session, optionally resolving on send.
- Context-window pressure per session with a configurable warning threshold (global default, per-model rules).
- Hotkeys exist (T for new task, g then t for tasks, configurable jump key). Split widths persist per browser.
- Constraints: `bb.agents` callbacks are synchronous; every workspace write is CAS-guarded; migrations are append-only after the first tagged release; pure logic lives in pure modules with node:test coverage; `server.ts` is wiring only; no em dashes in copy.
- Undecided: whether task-detail surfaces beyond Sessions and Artifacts (Workspace, Auto-advance, Scratch, Tips) belong in the panel or in thread-side panels.

## Brand Commitments

Name: RPI (plugin id `rpi`, tools `rpi_*`, skills `rpi-*`, CLI `bb rpi`). Must read as a native bb surface: bb's tokens, components, density, and interaction vocabulary. Visual references the owner named: bb's workflows plugin card (filled token-class status pills, per-row activity shading, segmented phase strip, collapsible phase groups with settled/total counts) and pi-subagents' fleet view (per-row status glyph, model badge, token and elapsed counters, current activity line). Confirmed 2026-09-06.

## Evidence on Hand

- Live plugin with real data at `http://127.0.0.1:38886/plugins/rpi/rpi` (local bb); 17 screenshots from 2026-09-06 at `/tmp/rpi-critique/` (transient).
- Critique snapshot: `.impeccable/critique/2026-09-07T02-41-23Z__ui-rpi-tsx.md` (17/40).
- Design record and ground truth: `~/PersonalDevelopment/bb-plugin-rpi-reference/design-record/research/` (plan, spike results, reference workflow research).
- Paper file "BB Plugins" with bb Dracula tokens and four artboards of the prior pass: `https://app.paper.design/file/01M1R7GACYGJMVT6KR7RMVR79D/1-0`.
- No user research, testimonials, or usage analytics exist. Do not fabricate them.

## Product Principles

1. The panel is an inbox before it is a tracker: what needs the human, and one step to act, outranks browsing.
2. Red is reserved for failure. A session waiting for its human is the normal state and must not look like an alarm.
3. One control per decision, shown once. Duplicated entry points and inert decoration are removed, not restyled.
4. Every product-specific element earns its place by doing something: a phase strip shows status and filters, or it does not exist.
5. Teach in place: a label, tooltip, or empty state explains the next step where the decision is made; no separate onboarding.

## Accessibility & Inclusion

Keyboard-first developer tool: every list row, tab, and phase step must be reachable and operable by keyboard with visible focus, with proper roles (tablist, row buttons) and labels on every select. Touch targets follow bb's coarse-pointer sizing. Motion respects reduced-motion preferences. No formal WCAG target has been set; AA contrast is the working floor because bb's tokens already meet it.
