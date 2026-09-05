# HumanLayer RPI Skills

Each skill starts by calling hl_task_context, writes task artifacts under .humanlayer/tasks/<slug>/, saves artifacts through hl_artifact_save, and ends with one text-fenced command for extraction.

| Skill | Label | Next command | Human gate |
|---|---|---|---|
| rpi-create-research-questions | research-questions | /rpi-create-research | no |
| rpi-iterate-research-questions | research-questions | /rpi-create-research | no |
| rpi-create-research | research | /rpi-create-design-discussion | no |
| rpi-iterate-research | research | /rpi-create-design-discussion | no |
| rpi-create-design-discussion | design | /rpi-create-structure-outline | yes |
| rpi-iterate-design-discussion | design | /rpi-create-structure-outline | yes |
| rpi-create-prd | design-prd | /rpi-create-tdd | no |
| rpi-iterate-prd | design-prd | /rpi-create-tdd | no |
| rpi-create-tdd | design-tdd | /rpi-create-structure-outline | yes |
| rpi-iterate-tdd | design-tdd | /rpi-create-structure-outline | yes |
| rpi-create-structure-outline | structure | /rpi-implement-outline | yes |
| rpi-iterate-structure-outline | structure | /rpi-implement-outline | yes |
| rpi-create-plan | plan | /rpi-setup-worktree | yes |
| rpi-iterate-plan | plan | /rpi-setup-worktree | yes |
| rpi-configure-workspaces | worktree-setup | /rpi-setup-worktree | yes |
| rpi-setup-worktree | worktree-setup | /rpi-implement-plan | yes |
| rpi-implement-plan | implementation | /rpi-ci-commit | yes |
| rpi-implement-outline | implementation | /rpi-ci-commit | yes |
| rpi-iterate-implementation | implementation | /rpi-ci-commit | yes |
| rpi-describe-pr | describe-pr | human gate or no automatic command | no |
| rpi-ci-commit | implementation | /rpi-describe-pr | no |
| rpi-review-artifact-comments | review | /rpi-iterate-implementation | no |
| rpi-show-me | review | human gate or no automatic command | no |

Human gates: design to outline, PRD to TDD, TDD to outline, structure to implementation outline, plan to worktree setup, worktree setup to implementation, implementation to commit, comment review actions. At these points auto-advance is not used; the user must choose Proceed or give direct instructions.
