# Phase 6 - Skills, Extraction, Proceed

## Shipped

- Added 23 rewritten user skills under `skills/rpi-*/SKILL.md`.
- Added 7 child-thread agent skills under `skills/rpi-agent-*/SKILL.md`.
- Added `skills/README.md` with skill, label, next-command, and human-gate mapping.
- Added final-answer template coverage and a 12-word shingle guard against `docs/hl-reference`.
- Enabled RPI launches, task-session skill selection, child `/rpi-agent-*` skill selection, model hints in `hl_task_context`, and task instructions.
- Added Tips task/thread panels with per-label text and task-scoped "Don't show again" persistence in `task_ui_state`.
- Added CLI helpers for `tasks update` auto-advance flags and `proceed --thread`.

## Verification

`npm test`

```text
tests 102
pass 102
fail 0
```

Focused extraction and rewrite guard:

```text
every final-answer template parses to the expected next skill
all shipped final-answer templates are covered
rewritten skills do not contain long HumanLayer reference shingles
tests 15
pass 15
fail 0
```

`bb plugin build`

```text
dist/server.js
dist/server.js.map
dist/server.meta.json
dist/app.js
dist/app.css
dist/app.meta.json
```

Live install:

```text
bb plugin install . --yes
bb plugin reload humanlayer
humanlayer@0.1.0 running
service launch-attempt-sweep: running
```

Live task:

```text
taskId: 2032cf6b-51e0-411b-a5bb-b52f7bbf94f9
projectId: proj_v36xq75qse
workflowType: outline_only
worktreeTiming: never
provider/model: codex gpt-5.4-mini
autoAdvance: true
aa_questions_to_research: true
aa_research_to_design: false
```

Observed sessions:

```text
thr_yv6f29k8cq research-questions user ready_for_input next=/rpi-create-research advanced=true
thr_2y2c9c6gww research auto_advance ready_for_input next=/rpi-create-design-discussion advanced=true
thr_5w9dirqhvw design proceed ready_for_input next=/rpi-create-structure-outline advanced=false
```

Observed artifacts:

```text
task.md
01-research-questions-live-outline-smoke.md
02-research-rpi-loop-live-outline-smoke.md
03-design-discussion-live-outline-smoke.md
```

Observed launch attempts:

```text
30522783-b460-4236-b7be-6182e9dc3b4c create-research-questions user spawned thr_yv6f29k8cq
a41af6bf-82b2-47f8-a03e-03dc73669231 create-research auto_advance spawned thr_2y2c9c6gww
5fecb73e-054a-4f75-a840-096870e4dfcf create-design-discussion proceed spawned thr_5w9dirqhvw
```

Cleanup:

```text
bb thread archive thr_yv6f29k8cq
bb thread archive thr_2y2c9c6gww
bb thread archive thr_5w9dirqhvw
bb plugin remove humanlayer
Removed humanlayer.
```

## Deviations

- I added `rpi-show-me` to `transitions.ts` so its final-answer template can be parsed by the same deterministic extractor as the other 22 skills.
- I added CLI wrappers for `tasks update` and `proceed`; the live acceptance path required exact auto-advance flags and a non-UI Proceed trigger.
- The live task used the project default environment, which was already a managed worktree environment. `worktreeTiming: never` still prevented HumanLayer from creating a later worktree.

## Per-Skill Fidelity Checklist

| Skill | HL rule preserved | Where |
|---|---|---|
| rpi-create-research-questions | yes | neutral questions, no intent leak, task/@ inputs only |
| rpi-iterate-research-questions | yes | @ artifact update, comments path, same final command |
| rpi-create-research | yes | descriptive research, no recommendations, child research commands |
| rpi-iterate-research | yes | reads selected research artifact and preserves descriptive mode |
| rpi-create-design-discussion | yes | design discussion artifact, unresolved questions, manual gate |
| rpi-iterate-design-discussion | yes | selected design artifact plus comments, same-file bump |
| rpi-create-prd | yes | PRD artifact, product requirements before TDD |
| rpi-iterate-prd | yes | selected PRD artifact plus comments |
| rpi-create-tdd | yes | TDD artifact, implementation bridge, manual gate |
| rpi-iterate-tdd | yes | selected TDD artifact plus comments |
| rpi-create-structure-outline | yes | phased outline, explicit checks, manual gate |
| rpi-iterate-structure-outline | yes | selected outline artifact plus comments |
| rpi-create-plan | yes | implementation plan artifact and worktree next step |
| rpi-iterate-plan | yes | selected plan artifact plus comments |
| rpi-configure-workspaces | yes | workspace.json schema, proposal before setup |
| rpi-setup-worktree | yes | bb-managed worktree, copyGlobs/setupCommand evidence |
| rpi-implement-plan | yes | implementer child, reviewer child, commit-and-proceed pause |
| rpi-implement-outline | yes | outline implementer child, reviewer child, commit gate |
| rpi-iterate-implementation | yes | selected implementation context and review before commit |
| rpi-describe-pr | yes | bb environment PR/status/diff commands, pr-description.md |
| rpi-ci-commit | yes | explicit invocation, exact staging, excludes task mirror by default |
| rpi-review-artifact-comments | yes | fetch comments, ask before resolving, one comment at a time |
| rpi-show-me | yes | visual artifact guidance and bb artifact links |

## Open Items

- Child-thread artifact tools are not selected for `/rpi-agent-*` threads because those threads carry no session row in this phase. The child skills therefore read explicit files and report structured markdown; task-scoped mutation still belongs to parent task sessions.
- The skill text is intentionally compact. If a reviewer wants closer per-template shape parity, extend the generated templates, then keep the shingle guard in place.
