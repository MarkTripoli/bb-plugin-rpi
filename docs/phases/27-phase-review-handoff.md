# Phase 1: Review artifact handoff

## Shipped

- `artifacts.ts` extracts the first valid standalone `::rpi-artifact` directive outside fenced, inline, and indented code. It validates the task id, reuses the artifact filename guard, and requires a live artifact.
- `sessions.ts` stores the validated reference as `summary_json.primaryReviewArtifact` after ingest. A later real turn replaces or clears it; idempotent replay and system-injected child completion preserve their prior behavior.
- Human-gated artifact templates now include `Human Review`, `Review targets`, `Verify`, and `Known limits`. Numeric implementation receipts require `type: implementation` and a positive `completed_phase` placeholder.
- Human-gate answer templates identify one standalone review artifact, concrete checks, the feedback path, approval semantics, and one final command. Numeric implementation skills save a receipt at every phase boundary and use a same-command handoff while later phases remain.
- `skills/README.md` records the updated human gates and numeric phase continuation contract.

## Verification

- `npm install`: passed; 167 packages installed, 0 vulnerabilities reported.
- `npm test -- tests/artifacts.test.ts tests/sessions.test.ts tests/skills.test.ts`: passed; 61 tests, 0 failures.
- `npm test`: passed after compressing `skills/rpi-implement-plan/SKILL.md` below its 850-word budget; 300 tests, 0 failures.
- `bb plugin build`: passed; server and app artifacts generated.

## Deviations

- No task artifact or plan checkbox was written because the assignment prohibited task artifact changes.
- Incomplete design and review-round answer variants state that iteration does not record approval. Only a completed phase's successor launch records approval.
- Phase 2 authority derivation and Phase 3 UI or launch-label changes were not implemented.

## Reviewer checks

- Render one implementation receipt and one design artifact. Confirm each shows review targets, exact checks, known limits, and one primary directive in its final answer.
- Confirm the copy distinguishes requested iteration from approval and leaves the final command fence last.

# Phase 2: Session-bound numeric phase authority

## Shipped

- `plan-phases.ts` now derives numeric continuation only from the completed session's live primary implementation receipt and its positive integer `completed_phase`. Receipt prose, newest-receipt selection, and plan-checkbox fallback were removed.
- `contract.ts`, `transitions.ts`, and `manual-launch.ts` carry and strictly parse the expected target phase. Numeric actions are labeled `Proceed to Phase N`.
- `advance.ts` reloads the source session, its primary artifact, and the selected plan before launch. Missing, deleted, malformed, stale, or conflicting authority is rejected before the existing advance claim and launch-attempt transaction.
- `ui/rpi.tsx` uses the shared Phase 2 derivation so the current banner compiles without the removed inference helpers. No Phase 3 artifact review presentation or approval-dialog copy was added.
- Focused tests cover valid, terminal, missing, deleted, malformed, absent, and gapped authority; unrelated newer receipts; same-task session isolation; strict routes; stale RPC targets; no-write rejection; and the existing concurrent single-winner behavior.

## Verification

- `npm test -- tests/plan-phases.test.ts tests/transitions.test.ts tests/advance.test.ts tests/manual-launch.test.ts tests/server.test.ts`: passed; 63 tests, 0 failures.
- `npm test`: passed; 298 tests, 0 failures.
- `bb plugin build`: passed; server and app artifacts generated. Node emitted the existing `module.register()` deprecation warning.
- `git diff --check`: passed.

## Deviations

- The Phase 1 note above is retained as its original checkpoint. Its statement that Phase 2 was not implemented describes that earlier checkpoint and is superseded by this section.
- No Phase 3 review-state UI, comment-count presentation, approval-dialog wording, task artifact, or commit was added.

## Reviewer checks

- Inspect the focused fixtures for a receipt with `completed_phase: 3`; only Phase 4 may be offered even when earlier plan boxes remain unchecked or a newer unrelated receipt exists.
- Exercise one live manual completion after Phase 1 metadata is present and confirm a stale phase route is rejected without an advance stamp or launch attempt.

# Phase 3: Review-state presentation and approval launch

## Shipped

- `ui/rpi.tsx` now reuses the artifact directive navigation path for a session-bound review opener, shows the completed phase, unresolved root-comment count, exact-check prompt, and a fail-closed artifact repair action.
- Numeric continuation is labeled `Proceed to Phase N`; the final launch dialog identifies the action as `Approve Phase N and start Phase N+1` while preserving the existing model choice and launch RPC path.
- Artifact and comment realtime events refresh the review metadata, and unresolved comments remain advisory rather than disabling Proceed.
- `advance.ts` rejects malformed implementation handoffs on direct Proceed and completion routes before `advanced_at` or `launch_attempts` mutation. `plan-phases.ts` and `manual-launch.ts` require safe canonical phase numbers.

## Verification

- `npm test -- tests/ui-conventions.test.ts tests/thread-panel.test.ts tests/transitions.test.ts tests/advance.test.ts tests/skills.test.ts`: passed; 62 tests, 0 failures.
- `npm test`: passed; 301 tests, 0 failures.
- `bb plugin types --check`: passed.
- `bb plugin build`: passed; generated server and app bundles. Existing Node `DEP0205` warning remains.
- `git diff --check`: passed.
- `bb plugin install . --yes` and `bb plugin reload rpi`: passed.

## Deviations

- The positive live path could not be exercised because all available implementation sessions predate `summary_json.primaryReviewArtifact`; no synthetic approval state was created.
- The repository now rejects malformed implementation metadata for direct Proceed and completion routes as a server-side consistency guard for the UI repair state.
- The packaged `WRITING.md` reference is absent; the implementation template and repository writing conventions were used.

## Reviewer checks

- Use a compliant numeric implementation session to verify the bound receipt opener, unresolved-comment count and realtime update, cancel side-effect freedom, exact approval label, and single successor launch.
- Confirm a legacy or malformed session exposes only artifact navigation and Iterate, with no guessed numeric phase action.
- After these checks, hand off to `/rpi-ci-commit`; no commit was created here.
