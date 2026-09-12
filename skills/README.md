# RPI Skills

Each skill starts by calling rpi_task_context, writes task artifacts under .rpi/tasks/<slug>/, saves artifacts through rpi_artifact_save, and ends with one text-fenced command for extraction. A completed human-gated phase emits exactly one standalone primary artifact directive, copies concrete checks from the artifact's `Human Review` section, and states which successor launch records approval.

All phase and child-thread skills load the [RPI writing guide](WRITING.md). It governs artifact prose, revisions, and reports while each skill retains its required content and output format.

| Skill | Label | Next command | Human gate |
|---|---|---|---|
| rpi-create-research-questions | research-questions | /rpi-create-research | no |
| rpi-iterate-research-questions | research-questions | /rpi-create-research | no |
| rpi-create-research | research | /rpi-create-structure-outline for outline_only, /rpi-create-design-discussion for rpi | no |
| rpi-iterate-research | research | /rpi-create-structure-outline for outline_only, /rpi-create-design-discussion for rpi | no |
| rpi-create-design-discussion | design | /rpi-create-plan | yes |
| rpi-iterate-design-discussion | design | /rpi-create-plan | yes |
| rpi-create-prd | design-prd | /rpi-create-tdd | yes |
| rpi-iterate-prd | design-prd | /rpi-create-tdd | yes |
| rpi-create-tdd | design-tdd | /rpi-create-plan | yes |
| rpi-iterate-tdd | design-tdd | /rpi-create-plan | yes |
| rpi-create-structure-outline | structure | /rpi-implement-outline, or /rpi-setup-worktree when worktree_timing is later | yes |
| rpi-iterate-structure-outline | structure | /rpi-implement-outline, or /rpi-setup-worktree when worktree_timing is later | yes |
| rpi-create-plan | plan | /rpi-setup-worktree | yes |
| rpi-iterate-plan | plan | /rpi-setup-worktree | yes |
| rpi-create-epic-plan | epic-plan | /rpi-start-epic-delivery (materializes children; no session) | yes |
| rpi-configure-workspaces | worktree-setup | /rpi-setup-worktree | yes |
| rpi-setup-worktree | worktree-setup | /rpi-implement-plan or /rpi-implement-outline by workflow type | no |
| rpi-implement-plan | implementation | same implementation command between numeric phases, then /rpi-describe-pr | yes |
| rpi-implement-outline | implementation | same implementation command between numeric phases, then /rpi-describe-pr | yes |
| rpi-iterate-implementation | implementation | source implementation command between numeric phases, then /rpi-describe-pr | yes |
| rpi-review-code | code-review | /rpi-fix-code-review when findings remain, otherwise /rpi-describe-pr | no |
| rpi-fix-code-review | review-fixes | /rpi-review-code | no |
| rpi-describe-pr | describe-pr | /rpi-resolve-pr-reviews | yes |
| rpi-resolve-pr-reviews | pr-review | /rpi-resolve-pr-reviews until approved | yes |
| rpi-ci-commit | implementation | /rpi-describe-pr | no |
| rpi-review-artifact-comments | review | /rpi-iterate-implementation | no |
| rpi-show-me | helper | no Proceed target | no |

Human gates: design, design-prd, design-tdd, structure, plan, epic-plan, implementation, describe-pr, and pr-review. Auto-advance flags are `aa_questions_to_research`, `aa_research_to_design`, `aa_plan_to_worktree`, `aa_worktree_to_implementation`, and `aa_implementation_to_pr`; only transitions with one of those flags can launch automatically. The code-review loop reuses `aa_implementation_to_pr`. Pull request review remains manual because approval and new comments are external events.
