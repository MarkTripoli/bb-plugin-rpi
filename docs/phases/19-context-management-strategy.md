# Context management for long RPI tasks

Status: proposed strategy, not an implementation. Source baseline: `ff97b93`.

Keep immutable artifact history, but give each session a small, explicit set of current inputs. The plugin already avoids loading historical version bodies by default. The remaining problems are large current documents, incomplete selection rules, missing summaries, and fresh sessions without a precise continuation handoff.

Latest-only retrieval cannot evict content already read in an ongoing conversation. If an agent reads v3, revises it, then reads v4, both reads can remain in that thread until the host compacts its history or a fresh session starts. This makes session turnover necessary even when version selection is correct.

## What the current code establishes

| Behavior | Evidence | Consequence |
| --- | --- | --- |
| Artifact identity is task plus filename; changed content creates a version. Reads default to `currentVersion`. | `artifacts.ts`, `upsertArtifact`, `getArtifactVersion` | Version 19 does not imply reading versions 1 through 18. Keep this design. |
| Hydration walks all artifacts and writes current content to the workspace with conflict protection. | `mirror.ts`, `hydrate`, `writeOne` | Files on disk are not automatically model context. Hydration can still incur I/O, which needs separate timing. |
| `rpi_task_context` returns up to 200 alphabetically ordered artifact entries and `task.md`, capped at 20,000 characters. Each summary is capped at 400 characters. | `tools.ts:114`, `artifacts.ts:129`, `artifacts.ts:240` | Output depends on the number of documents, not relevance. An entry limit is not a small total context budget. There is no pagination input to this tool. |
| Shared instructions say primary input fully, other artifacts by summary. Some create skills also retain the broad instruction to read task artifacts fully. | `sessions.ts:1120`; `skills/rpi-create-plan/SKILL.md:21` and `:68`; `skills/rpi-create-design-discussion/SKILL.md:21` and `:92` | The intended policy exists, but conflicting wording and absent summaries weaken it. |
| Implementers read the whole plan. The outline parent names companion documents, and its child reads every named companion. | `skills/rpi-agent-implementer/SKILL.md:18`; `skills/rpi-implement-outline/SKILL.md:55`; `skills/rpi-agent-outline-implementer/SKILL.md:18` | Fresh children can repeatedly load large upstream documents even when assigned one phase. |
| Iterate starts a new thread with a bare iterate command or a generic prompt to read task artifacts. | `advance.ts:86`, `launch.ts:350` | It drops explicit artifact selection and does not pass current progress, pending feedback, or a continuation checkpoint. The agent has to reconstruct them. |
| Session summaries append the first 600 characters of final messages. | `sessions.ts:538` | These are display/history snippets, not reliable execution checkpoints. They are not all injected by `rpi_task_context`. |
| Context warning defaults are 60%, with model rules at 50% or 70%. | `context-threshold.ts:5` | An existing recovery affordance, not an automatic context-management policy or proven performance threshold. |

Research has a further boundary mismatch: its skill excludes task intent unless explicitly requested, but the shared context tool returns `task.md` before the skill makes that selection. Phase filtering should apply to tool output itself.

## Live metadata sample

Read-only `bb rpi artifacts list --task <id> --json` calls inspected current metadata. These are bytes, not tokens. No transcript or model-latency benchmark was performed.

| Task | Artifacts | Nonempty summary fields | Example current artifact |
| --- | ---: | ---: | --- |
| SDK Dev | 62 | 0 | Plan v13: 39,498 bytes |
| RPI Cleanup | 14 | 0 | Plan v1: 33,339 bytes |
| Alidade D-04 | 20 | 0 | Design v19: 103,046 bytes |
| Formation Design | 9 | 0 | Design v18: 119,051 bytes |

SDK Dev's reconstructed manifest was only 6,792 bytes with null summaries. Its latest artifact contents totaled 712,109 bytes. This supports investigating repeated full reads before blaming historical versions. It does not prove which reads occurred in a particular slow session.

## Proposed rules

### 1. Keep one filename per evolving document

Continue editing the existing plan or design file. Preserve older content in `artifact_versions`; retrieve it only for an explicit comparison, historical review, or recovery. A genuinely separate deliverable gets a separate artifact.

For existing duplicate documents, record which one supersedes which before hiding it from default discovery. Never infer supersession merely because two documents share a type or one has a larger numeric prefix. Several research documents can cover independent topics.

Use the user-selected artifact first, then the workflow's recorded input. Otherwise use the phase's eligible candidates, resolving material ambiguity explicitly. Latest means the current revision of that selected artifact, not the newest file anywhere in the task. Existing approval gates still determine whether it is ready for implementation.

### 2. Select before returning context

Extend the existing context tool and launch path. Return the current assignment, selected artifact references, global constraints, checkpoint, and only the relevant dependency summaries. Include the selection reason and artifact version/hash. Derive task identity from the session; validate supplied filenames and phase selections within that task.

| Work | Default inputs |
| --- | --- |
| Research | Selected research questions and explicitly assigned sources; task intent only when authorized by the research rules |
| Design | Task requirements and relevant completed research |
| Plan | Selected design/outline, global constraints, unresolved implementation decisions |
| Implement phase N | Plan's shared contracts and phase N, acceptance checks, required dependency sections, current repository state |
| Revise an artifact | Selected artifact and feedback; upstream sections when the change affects them |
| Review/fix | Assigned diff or review, affected requirements, unresolved findings, current verification evidence |

Keep the rest accessible through bounded, paginated discovery and explicit reads. Reuse `listArtifacts` and `getArtifactVersion` behind those surfaces. A missing summary means relevance is unknown: inspect the named document's headings or relevant section, not every artifact in the task.

Use summaries for discovery, not as replacements for binding contracts or acceptance criteria. Revise the current conflicting skill instructions together with the tool contract. Explicit full-document requests still work.

### 3. Bound the working input, including long plans

Suggested starting targets: at most about 2,000 tokens of bootstrap metadata and checkpoint, and 8,000 to 12,000 tokens of artifact context for an implementation step. These are proposed operating targets, not measured optima. Enforce deterministic byte limits on plugin output; report actual token usage when the provider exposes it.

Reserve space for required inputs first. If they exceed the target, disclose that and load complete required sections in bounded calls. Never silently truncate a requirement or drop a named primary input. Additional necessary source inspection remains allowed.

For large plans, keep a short shared-contract section and clearly delimited phase sections. Workers load shared constraints plus their assigned phase and explicit dependencies. An artifact-wide revision or architectural review can deliberately read the whole document. Split a document only when those sections themselves become unwieldy; avoid automatically generating another summary artifact for every file.

Normal revisions replace obsolete explanations in place. Current documents state current decisions; the version store retains the change history. This prevents the latest version from becoming an append-only conversation log.

### 4. Carry current state into fresh sessions

Use one stable, versioned `handoff.md` per active execution lane, updated at phase boundaries or deliberate continuation points. The ordinary single-lane case needs one file. Store only:

- Current objective, assigned step, and next action.
- Selected artifact paths and versions/hashes.
- Binding decisions and constraints not already in the selected shared contracts.
- Verified completed work, repository branch/commit, and relevant uncommitted work.
- Outstanding feedback, blockers, and checks still required.

The handoff is current state, not accumulated session summaries. Preserve receipts and logs behind links. Refresh it from the running agent while the relevant context is available; do not pretend the first 600 characters of a final answer establish it.

Fresh Iterate must preserve the selected artifact and current assignment and pass the checkpoint. If no checkpoint exists, state that and reconstruct only the missing state from selected inputs and the repository. Do not report a seamless continuation based on inference.

Resolve current versions at the work boundary, then record the exact revisions read. If a dependency changes during the step, show the change and reassess affected work before a consequential write. Continue using mirror CAS checks and task confinement. Do not silently let a moving `latest` invalidate a review or overwrite newer work.

Rotate the parent session at meaningful phase boundaries as well as creating fresh implementation children. Keep the existing context warning as a fallback. Save and verify the checkpoint before turnover, and avoid creating competing writers while the original session is still active. Existing approval gates remain in force.

### 5. Make the policy observable

Expose a compact account of selected files, revisions, reasons, and emitted bytes. Measure bootstrap size, artifact-read volume, hydration duration, and time to first meaningful code action separately. Global instructions, other plugins, shell output, and conversation history also consume context and remain outside RPI's artifact budget.

For a fixed current assignment and content, adding old versions or unrelated artifacts should not materially grow default context. A fresh continuation should identify its exact next action without replaying old sessions.

## Smallest implementation sequence

1. Add phase/assignment-aware selection to `rpi_task_context`, bounded discovery for additional artifacts, and consistent read rules in affected skills. Reuse current version storage and summary extraction. Populate missing summaries only when an active input is read or revised.
2. Carry the selected input and a compact checkpoint through Iterate and phase launch. Read global plan contracts plus the assigned phase in workers. Add explicit supersession metadata only for distinct files that actually replace each other.
3. Compare representative long tasks before and after. Optimize all-artifact disk hydration only if its separate timings justify changing the current synchronization model.

No embeddings, vector database, automatic cross-session fact extractor, or deletion of historical versions is needed for this first implementation.

## Verification and limits

Source trace covered persistence, hydration, context output, launch/iterate, relevant phase and child skills, and context thresholds. The existing reference plan, SDK spike, and workflow ground truth were read; spike behaviors were not re-tested.

An in-memory probe used the real `MIGRATIONS`, `createDraftTask`, `upsertArtifact`, and `registerArtifactTools` with a stub thread lookup:

```text
100 revisions of one plan: one plan manifest entry at version 100
Historical and current plan bodies in context response: absent
205 unrelated artifacts with 400-character summaries:
  manifest bytes: 100297
  entries: 200 plus truncation sentinel
  alphabetically later primary plan: omitted
```

This demonstrates existing selection behavior, not a deployed fix. No live task, artifact, or session was changed. Only this proposal was added to the repository.

`rtk npm test` passed typechecking and 242 of 243 tests. The existing naming test failed on `docs/phases/18-concise-artifact-writing.md`, which is unchanged by this proposal. Its tracked reference-product wording violates `tests/naming.test.ts`. The baseline is therefore not fully green; no unrelated source or test fix was made.

`rtk bb plugin build` passed and emitted the server/app bundles. `rtk git diff --check` passed. No live install or reload was performed.

Future acceptance cases: fixed-context size with 100 historical versions or 1,000 unrelated artifacts; primary input beyond the first 200 filenames; two independent research topics; missing summaries; preserved Iterate selection and unfinished step; changed/deleted dependencies; research intent isolation; required sections exceeding the budget without silent truncation; representative real-agent continuations with no lost decisions.

This analysis is outside the original merged plan's delivery rows. It proposes extending context selection and continuation while retaining its database, hydration safety, synchronous instruction callbacks, and human-gate decisions. Performance improvement remains unmeasured until the implementation and a controlled before/after run exist.
