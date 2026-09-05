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

## Deep Rewrite

| Skill | Original bytes | New bytes | Sections mirrored | Rules preserved | Intentionally dropped |
|---|---:|---:|---|---|---|
| rpi-implement-plan | 4627 | 6007 | yes: context, phase loop, implementer, review, checks, human gate, commit, repeat, final template | 31 / 44 | none; child execution rewritten to bb thread spawn/wait/output |
| rpi-implement-outline | 5356 | 6422 | yes: startup, discovery, precedence, progress markers, child implementer, report, human gate, commit, repeat | 34 / 51 | none; agent-tool wording replaced with bb child-thread commands |
| rpi-iterate-implementation | 4109 | 5333 | yes: full input read, current-state review, verify feedback, clarify, fix, final template | 26 / 41 | none; cloud permalink wording replaced by artifact directives |
| rpi-agent-implementer | 3336 | 3816 | yes: charter, startup, philosophy, mismatch report, verification, stuck handling, resume, final output | 21 / 30 | none; deliverable is final thread output |
| rpi-agent-outline-implementer | 3368 | 3524 | yes: charter, discovery, precedence, implementation rules, progress tracking, mismatch, verification, final output | 19 / 21 | none; deliverable is final thread output |
| rpi-agent-implementation-reviewer | 3271 | 3867 | yes: inputs, locate source artifact, extract planned work, analyze diff, categorize, guidelines, output | 13 / 23 | none; git diff default replaced with bb environment diff when available |
| rpi-describe-pr | 3413 | 4341 | yes: template read, PR discovery, context gathering, body writing, save/publish, final report | 15 / 27 | none; provider-specific PR defaults replaced with bb environment PR facilities |
| rpi-ci-commit | 1467 | 1906 | yes: inspect changes, plan commits, execute with explicit staging, remember exclusions | 9 / 14 | none; task receipt added for bb artifact handoff |
| rpi-setup-worktree | 6297 | 6123 | yes: disabled branch, already-worktree branch, task info, default config, per-repo setup loop, success-only final | 31 / 43 | shell worktree creation; bb launcher owns environment creation |
| rpi-configure-workspaces | 10416 | 10193 | yes: purpose, select repo, read project, proposal, validation, approved writes, summary, concepts | 35 / 54 | none; bb environment limits called out instead of hidden worktree assumptions |

## Open Items

- Child-thread artifact tools are not selected for `/rpi-agent-*` threads because those threads carry no session row in this phase. The child skills therefore read explicit files and report structured markdown; task-scoped mutation still belongs to parent task sessions.
- The skill text is intentionally compact. If a reviewer wants closer per-template shape parity, extend the generated templates, then keep the shingle guard in place.

## Deep Rewrite - Lane 1

Verification after this rewrite:

```text
npm test
tests 102
pass 102
fail 0

bb plugin build
dist/server.js
dist/server.js.map
dist/server.meta.json
dist/app.js
dist/app.css
dist/app.meta.json
```

| Skill | Original bytes | New bytes | Sections mirrored | Rules preserved | Intentionally dropped |
|---|---:|---:|---|---|---|
| rpi-create-research-questions | 6987 | 7623 | 4/5 heading blocks; original read, light research, draft, save, final-answer order preserved with bb step 0 added | 28 original rule markers / 17 rewritten rule markers; task/@-only input, context pointers, neutral current-state questions, no intent leakage, frontend design-system coverage, final template preserved | None |
| rpi-iterate-research-questions | 4028 | 5001 | 5/6 heading blocks; input selection, full read, feedback processing, same-path update, final-answer order preserved with bb step 0 added | 16/19; full artifact read, symlink-safe listing, no unrelated artifacts, same frontmatter/format, current-state-only questions, context pointers preserved | None |
| rpi-create-research | 16782 | 12098 | 16/15 heading blocks; initial artifact selection, read mentioned files, decompose, spawn research agents, wait, metadata, write, one open-question pass, final answer preserved with bb step 0 added | 55/27; descriptive-only research, no ticket reads unless explicit, child-thread delegation, all children waited, metadata before write, one extra pass, visual/narrative research style, testing patterns | None |
| rpi-iterate-research | 11260 | 8181 | 12/13 heading blocks; initial selection, full artifact read, feedback processing, optional child research, same-path update, final answer preserved with bb step 0 added | 41/29; excludes task/ticket by default, objective current-state updates, child-thread use, cohesive in-place edits, no diff blocks, testing patterns, open-question handling | None |
| rpi-agent-codebase-locator | 4841 | 5616 | 17/20 heading blocks; role charter, responsibilities, search strategy, output format, guidelines, do-not list preserved as child-thread deliverable | 21/9; locate only, no implementation analysis, include tests/config/docs/types/examples, group by purpose, no critique or edits | None |
| rpi-agent-codebase-analyzer | 5678 | 5129 | 18/20 heading blocks; role charter, responsibilities, analysis strategy, output format, quality bar, do-not list preserved as child-thread deliverable | 28/15; current-state explanation, trace flows, cite file:line evidence, include tests/errors/config, no recommendations or edits | None |
| rpi-agent-codebase-pattern-finder | 6960 | 5423 | 21/18 heading blocks; role charter, pattern categories, search/read/extract flow, output format, quality bar, do-not list preserved as child-thread deliverable | 25/13; catalog existing examples, include snippets/tests/variants, no preferred-pattern judgment, no future implementation | None |
| rpi-agent-web-search-researcher | 5804 | 4430 | 16/13 heading blocks; query analysis, search, fetch/read, synthesize, source handling, output format, quality bar preserved as child-thread deliverable | 10/10; sourced external research, official/current sources first, version/date notes, links required, uncertainty stated, no artifact writes | None |
| rpi-show-me | 3039 | 3708 | 0/6 heading blocks; original visual modes preserved and organized with bb step 0, artifact save, and final template flow | 2/16; smallest useful visual, pseudocode/call tree/component tree/file tree/Mermaid/diff/HTML options, concise prose, no unrelated artifacts | None |
| rpi-review-artifact-comments | 4192 | 4789 | 6/6 heading blocks; tool availability, input cases, XML format, artifact read, comment fetch/read, ask-before-action, example behavior, notes preserved with bb step 0 | 28/24; ask unless instructed, work one thread at a time, resolve/reply/delete only on confirmation, reversible state changes, comment XML counterpart added | None |
||||||| parent of 9fa9806 (skills(rpi-iterate-plan): deep rewrite)


## Deep rewrite - lane 2

| Skill | Original bytes | New bytes | Sections mirrored | Rules preserved (original / rewritten) | Intentionally dropped and why |
|---|---:|---:|---|---:|---|
| rpi-create-design-discussion | 7615 | 7865 | yes (7 original sections/steps, 6 rewritten sections/steps) | 28 / 36 | Claude/SKILLBASE/cloud-hook wording replaced with bb task tools, child threads, and artifact directives; no behavior dropped. |
| rpi-iterate-design-discussion | 5142 | 5843 | yes (8 original sections/steps, 7 rewritten sections/steps) | 22 / 29 | Claude/SKILLBASE/cloud-hook wording replaced with bb task tools, child threads, and artifact directives; no behavior dropped. |
| rpi-create-prd | 12224 | 8843 | yes (13 original sections/steps, 14 rewritten sections/steps) | 24 / 34 | Claude/SKILLBASE/cloud-hook wording replaced with bb task tools and bb child research commands; no behavior dropped. |
| rpi-iterate-prd | 11275 | 8500 | yes (10 original sections/steps, 9 rewritten sections/steps) | 37 / 39 | Claude/SKILLBASE/cloud-hook wording replaced with bb task tools and bb child research commands; no behavior dropped. |
| rpi-create-tdd | 17410 | 14705 | yes (16 original sections/steps, 17 rewritten sections/steps) | 27 / 59 | Claude/SKILLBASE/cloud-hook wording replaced with bb task tools and local HTML artifact template; no behavior dropped. |
| rpi-iterate-tdd | 16177 | 12132 | yes (13 original sections/steps, 14 rewritten sections/steps) | 48 / 50 | Claude/SKILLBASE/cloud-hook wording replaced with bb task tools and local HTML artifact template; no behavior dropped. |
| rpi-create-structure-outline | 9679 | 8442 | yes (12 original sections/steps, 10 rewritten sections/steps) | 39 / 36 | Claude/SKILLBASE/cloud-hook wording replaced with bb task tools, child threads, and auxiliary branch templates; no behavior dropped. |
| rpi-iterate-structure-outline | 6984 | 6953 | yes (11 original sections/steps, 9 rewritten sections/steps) | 30 / 33 | Claude/SKILLBASE/cloud-hook wording replaced with bb task tools, child threads, and auxiliary branch templates; no behavior dropped. |
| rpi-create-plan | 3999 | 4802 | yes (10 original sections/steps, 8 rewritten sections/steps) | 21 / 29 | Claude/SKILLBASE/cloud-hook wording replaced with bb task tools, child threads, and auxiliary branch templates; no behavior dropped. |
| rpi-iterate-plan | 3918 | 4412 | yes (9 original sections/steps, 7 rewritten sections/steps) | 25 / 30 | Claude/SKILLBASE/cloud-hook wording replaced with bb task tools, child threads, and auxiliary branch templates; no behavior dropped. |

Verification for this rewrite pass:

```text
npm test: 102 pass, 0 fail
bb plugin build: dist/server.js, dist/app.js, and metadata/css artifacts emitted
```
