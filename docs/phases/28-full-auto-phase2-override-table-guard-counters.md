# Phase 2: Override table and guard counters

Plan: `04-plan-full-auto-mode.md` (Phase 2). Branch worktree commit on top of Phase 1 (`63c54b0`).

## What shipped

- `transitions.ts`: `E2E_AUTO_ADVANCE` const table (research-questions / research / worktree-setup / implementation / code-review / review-fixes rows, `satisfies Partial<Record<PhaseLabel, Record<string, { next: SkillId; to: PhaseLabel; chain?: "phase" }>>>`), `E2eTransition` type, and `e2eTransition(label, workflowType, skillId)`. The resolver rejects null labels, restricts the `research` row to the workflow's own design entry via `autoAdvanceAccepts`, and restricts `chain: "phase"` to the workflow's own implementation skill via `phaseImplementationSkill` (function declarations, so the forward reference resolves by hoisting).
- `e2e.ts` (new, pure, no bb imports): `E2eAttempt`, `E2ePausedReason`, `E2eGuardState`; `e2eGuardState(attempts, caps)` anchored at the newest attempt not launched by `auto_advance` (any human launch resets counters by moving the anchor); `retryChainDepth(attempts, attemptId)` walking `retried_from` links with cycle detection; `E2E_REASONING_LABELS`; `phaseModelFor(task, label, prefs)` (explicit `phase_models` entry always wins; class defaults only when `e2eMode`); `e2ePausedText(state)`.
- `instructions.ts`: `E2E_LAUNCH_CONTEXT` constant for the Phase 3 launch-context line.
- `tests/transitions.test.ts`: "e2e auto advance table is literal" pins the table with `assert.deepEqual`; "e2eTransition resolves rows, redirects implementation into review, and refuses human gates" covers the redirect, the chain refusal for `outline_only + implement-plan`, the research workflow guards, all seven human-gate labels, helpers, and null labels.
- `tests/e2e.test.ts` (new): hand-built attempt arrays covering empty list, anchor reset, hop cap, review-cycle cap, retry chain under cap (no pause), failed-at-cap pause, spawned newest at depth 3 (no pause), cap precedence, `retryChainDepth` links and cycle termination, `phaseModelFor` explicit-vs-class-default and `e2eMode` gating, reasoning-label classification, and `e2ePausedText` null case.

## How it was verified

- `npm test -- tests/transitions.test.ts tests/e2e.test.ts`: 28 pass, 0 fail (pretest `tsc --noEmit` clean).
- `npm test`: 344 pass, 0 fail, ~3.1s.

## Deviations

- Test helper signature: `attempt(overrides)` accepts `Partial<E2eAttempt>` rather than omitting `id`, because the cycle test needs explicit ids.
- `retryChainDepth` on a full `retried_from` cycle (c1 -> c2 -> c3 -> c1) returns 3, not 0: the walk counts links until it revisits a node. The plan only required termination; no legitimate chain forms a full cycle, so this is fine. Test pins the terminating behavior.

## Open items for the reviewer checklist

- Confirm the guard precedence in `e2eGuardState` (hops, then review cycles, then retries) matches the design intent.
- Confirm `reviewCycles` counts `fix-code-review` launches (not review-code) as review cycles after the anchor.
- Phase 3 imports: `DEFAULT_E2E_PREFS`, `E2ePrefs` from `./contract`; `e2eGuardState`, `phaseModelFor` from `./e2e`; `e2eTransition` from `./transitions`; `listLaunchAttempts` from `./launch`; `E2E_LAUNCH_CONTEXT` from `./instructions`.
