# HumanLayer RPI Skills

Each skill starts by calling hl_task_context, writes task artifacts under .humanlayer/tasks/<slug>/, saves artifacts through hl_artifact_save, and ends with one text-fenced command for extraction.

| Skill | Label | Next command | Human gate |
|---|---|---|---|
| rpi-create-research-questions | research-questions | /rpi-create-research | no |
| rpi-iterate-research-questions | research-questions | /rpi-create-research | no |
| rpi-create-research | research | /rpi-create-structure-outline for outline_only, /rpi-create-design-discussion for rpi | no |
| rpi-iterate-research | research | /rpi-create-structure-outline for outline_only, /rpi-create-design-discussion for rpi | no |
| rpi-create-design-discussion | design | /rpi-create-plan | yes |
| rpi-iterate-design-discussion | design | /rpi-create-plan | yes |
| rpi-create-prd | design-prd | /rpi-create-tdd | no |
| rpi-iterate-prd | design-prd | /rpi-create-tdd | no |
| rpi-create-tdd | design-tdd | /rpi-create-plan | yes |
| rpi-iterate-tdd | design-tdd | /rpi-create-plan | yes |
| rpi-create-structure-outline | structure | /rpi-implement-outline, or /rpi-setup-worktree when worktree_timing is later | yes |
| rpi-iterate-structure-outline | structure | /rpi-implement-outline, or /rpi-setup-worktree when worktree_timing is later | yes |
| rpi-create-plan | plan | /rpi-setup-worktree | yes |
| rpi-iterate-plan | plan | /rpi-setup-worktree | yes |
| rpi-configure-workspaces | worktree-setup | /rpi-setup-worktree | yes |
| rpi-setup-worktree | worktree-setup | /rpi-implement-plan or /rpi-implement-outline by workflow type | no |
| rpi-implement-plan | implementation | /rpi-describe-pr | no |
| rpi-implement-outline | implementation | /rpi-describe-pr | no |
| rpi-iterate-implementation | implementation | /rpi-describe-pr | no |
| rpi-describe-pr | describe-pr | human gate or no automatic command | no |
| rpi-ci-commit | implementation | /rpi-describe-pr | no |
| rpi-review-artifact-comments | review | /rpi-iterate-implementation | no |
| rpi-show-me | helper | no Proceed target | no |

Human gates: design, design-prd, design-tdd, and structure. Auto-advance flags are `aa_questions_to_research`, `aa_research_to_design`, `aa_plan_to_worktree`, `aa_worktree_to_implementation`, and `aa_implementation_to_pr`; only transitions with one of those flags can launch automatically.
