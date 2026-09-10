---
name: rpi-describe-pr
description: Run for /rpi-describe-pr requests. Create or update the pull request description for the current task.
---

After the task-context step, read the [RPI writing guide](../WRITING.md), resolved relative to this installed skill directory. Apply it before drafting or revising artifacts and before replying.

# Pull Request Description

Create or update PR description. Explain why and how.

## Workflow

### 0. Load context

Call `rpi_task_context` before reading files. Use the returned task directory, slug, artifact manifest, environment id, provider, and saved artifact links.

Read from this skill directory:

- `references/pr_description_template.md`
- `references/show-me.md`
- `references/pr_walkthrough_example.html` (user wants HTML walkthrough only)
- `references/pr_description_final_answer.md`

### 1. Read template

Read `references/pr_description_template.md`. Keep body in template. No changelog, verification report, plan appendix, long narrative.

### 2. Identify or create PR

Use bb environment PR facilities, not provider-specific CLIs as the default path:

```bash
bb environment status $BB_ENVIRONMENT_ID
bb environment diff-files $BB_ENVIRONMENT_ID --target all --merge-base-branch <base>
bb environment diff $BB_ENVIRONMENT_ID
bb environment pull-request show $BB_ENVIRONMENT_ID
```

If no PR exists, inspect branch status and committed changes. Commit and push only when required, then create or expose the PR through bb's environment PR surface.

### 3. Gather context

Read `task.md` or `ticket.md`, explanatory artifacts: plan, outline, PRD/TDD, design, receipts, @file inputs.

Read full diff plus surrounding code.

If the task has a plan, launch the reviewer child:

```bash
bb thread spawn --project $BB_PROJECT_ID --parent-self --environment $BB_ENVIRONMENT_ID --provider <same provider> --model <review model from rpi_task_context prefs, or current model> --prompt "/rpi-agent-implementation-reviewer Compare <plan-or-task-dir> with the current implementation against <base-branch>. Return only reviewer-relevant deviations."
bb thread wait <thread-id>
bb thread output <thread-id>
```

Verify important child claims against the diff.

### 4. Write description

Template exactly:

- `Why the change`: one sentence.
- `Special things to note`: one to three bullets. `- None.` when no warnings, migrations, constraints, omissions, surprises.
- `Change outline`: compact structural view from `references/show-me.md`. Views that help: data shape, endpoint contract, pseudocode, file tree, component tree, call/control/data flow. `diff` for changes, full shape for new. Focus on files, calls, fields, components, boundaries.

Do not include walkthrough artifacts in the PR body unless asked. When requested, create a separate HTML artifact from `references/pr_walkthrough_example.html`, fill it with real diff nodes, write it under the task directory, and save it.

### 5. Save and publish

Write `.rpi/tasks/<task-slug>/pr-description.md` (no task dir: `.rpi/tasks/pr-<number>/description.md`).

Call `rpi_artifact_save`. Publish:

1. `gh` on PATH, GitHub PR: update body.
2. `glab` on PATH, GitLab MR: update description.
3. Otherwise: print path, manual paste.

Confirm URL, title, number, base, head.

### 6. Report

Read and use `references/pr_description_final_answer.md` exactly. Include PR URL, saved directive, file-change summary, deviation summary or `No plan file found`.

The final answer must end with exactly one fenced `text` block. This is a human gate; auto-advance does not apply unless it starts another manual visual pass.

## Style

- Engineer to engineer.
- Reviewable in one pass.
- Risk before summaries.
- No filler, slang, unexplained acronyms.
- Provider-specific PR commands only when bb cannot.
