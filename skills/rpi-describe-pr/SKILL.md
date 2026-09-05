---
name: rpi-describe-pr
description: Only use when the user explicitly invokes /rpi-describe-pr. Create or update the pull request description for the current task.
---

# Describe a Pull Request

Create or update the pull request description for the current task branch. Explain why the change exists and how it is shaped.

## Workflow

### 0. Load task context

Call `hl_task_context` before reading files. Use the returned task directory, slug, artifact manifest, environment id, provider, and saved artifact links.

Locate this skill through the skills tier listing, then read:

- `references/pr_description_template.md`
- `references/show-me.md`
- `references/pr_walkthrough_example.html` only when the user wants an HTML walkthrough
- `references/pr_description_final_answer.md`

### 1. Read the description template

Read `references/pr_description_template.md` first. Keep the PR body inside that template. Do not add a changelog, verification report, plan appendix, or long narrative.

### 2. Identify or create the pull request

Use bb environment PR facilities, not provider-specific CLIs as the default path:

```bash
bb environment status $BB_ENVIRONMENT_ID
bb environment diff-files $BB_ENVIRONMENT_ID --target all --merge-base-branch <base>
bb environment diff $BB_ENVIRONMENT_ID
bb environment pull-request show $BB_ENVIRONMENT_ID
```

If no PR exists, inspect branch status and committed changes. Commit and push only when required, then create or expose the PR through bb's environment PR surface.

### 3. Gather only useful context

Read `task.md` or `ticket.md` and only explanatory task artifacts: plan, outline, PRD/TDD, design discussion, implementation receipts, or explicit `@file` inputs.

Read the complete PR diff and enough surrounding code to understand ownership and behavior.

If the task has a plan, launch the reviewer child:

```bash
bb thread spawn --project $BB_PROJECT_ID --parent-self --environment $BB_ENVIRONMENT_ID --provider <same provider> --model <review model from hl_task_context prefs, or current model> --prompt "/rpi-agent-implementation-reviewer Compare <plan-or-task-dir> with the current implementation against <base-branch>. Return only reviewer-relevant deviations."
bb thread wait <thread-id>
bb thread output <thread-id>
```

Verify important child claims against the diff.

### 4. Write the PR description

Use the template exactly:

- `Why the change` is one sentence.
- `Special things to note` is one to three bullets. Use `- None.` when there are no warnings, migrations, constraints, omissions, or surprises.
- `Change outline` is a compact structural view inspired by `references/show-me.md`.
- Include only views that help explain this PR: data shape, endpoint contract, pseudocode, shallow file tree, component tree, call flow, control flow, or data flow.
- Prefer `diff` blocks for changes to an existing shape.
- Show the full resulting shape when the structure is mostly new or a patch view would hide ordering or ownership.
- Keep every view focused on files, calls, fields, components, and boundaries a reviewer needs.

Do not include walkthrough artifacts in the PR body unless asked. When requested, create a separate HTML artifact from `references/pr_walkthrough_example.html`, fill it with real diff nodes, write it under the task directory, and save it.

### 5. Save and publish

Write the PR description to:

```text
.humanlayer/tasks/<task-slug>/pr-description.md
```

If no task directory exists, use `.humanlayer/tasks/pr-<number>/description.md`.

Call `hl_artifact_save` after writing. Then update the PR body through bb's environment PR workflow. Confirm URL, title, number, base, and head.

### 6. Report completion

Read `references/pr_description_final_answer.md` and answer using it exactly. Include:

- PR URL.
- Saved description artifact directive.
- Short file-change summary.
- Deviation summary or `No plan file found`.

The final answer must end with exactly one fenced `text` block. This is a human gate; auto-advance does not apply unless it starts another manual visual pass.

## Style Rules

- Write like one engineer to another.
- Keep the description reviewable in one pass.
- Put risk before broad summaries.
- Avoid filler, slang, and unexplained acronyms.
- Use provider-specific PR commands only when bb cannot do the required action.
