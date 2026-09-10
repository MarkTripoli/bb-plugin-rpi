---
name: rpi-setup-worktree
description: Run for /rpi-setup-worktree requests. Verify and finish task workspace setup inside the current bb environment.
---

After the task-context step, read the [RPI writing guide](../WRITING.md), resolved relative to this installed skill directory. Apply it before drafting or revising artifacts and before replying.

## Steps

### 0. Decide whether setup is skipped

Call `rpi_task_context` before reading files. Use its task directory, task slug, artifact list, workspace data, bb environment id, provider, and model preferences.

Read workspace config:

```text
.rpi/workspace.json
.rpi/workspace.local.json
```

Local overrides shared. If the effective root config has `disabled: true`, do not continue with setup unless the user explicitly asks you to override it. Disabled: check branch suitable, handoff to `/rpi-implement-outline` (`outline_only`) or `/rpi-implement-plan` (others).

Check if already in managed worktree:

```bash
bb environment show $BB_ENVIRONMENT_ID
git rev-parse --git-dir
```

Already in worktree: continue with the setup work in the current worktree: resolve workspace config from the base path reported by `rpi_task_context`, apply copyGlobs, run setupCommand, and verify the branch. Do not request another worktree.

### 1. Gather task information

Read `task.md` or `ticket.md`, then plan artifact (`/rpi-implement-plan`) or outline (`/rpi-implement-outline`).

Use `rpi_artifacts_list` if the source artifact is not already selected. Do not list, search, or glob the task mirror directly.

### 2. Create default config when none exists

Run this step only if neither workspace config file exists.

Check legacy setup:

```text
scripts/create_worktree.sh
README.md
Makefile
package.json
```

Legacy script: read usage, ask before running it, run it only against the current bb worktree, verify. Do not create second worktree unless user requests.

No convention: write `.rpi/workspace.json`:

```json
{
  "repos": [{"localPath": ".", "description": "Selected repository", "primary": true}],
  "disabled": false,
  "sourceRef": "HEAD",
  "branchTemplate": "{{ TASKSLUG }}",
  "pathTemplate": "~/.rpi/workspaces/{{ TASKSLUG }}/{{ REPOBASENAME }}",
  "setupCommand": "",
  "copyGlobs": [".rpi/workspace.local.json", "CLAUDE.local.md", ".env*", ".claude/settings.local.json"]
}
```

Multi-repo: add siblings with `localPath` relative, one `primary: true`.

Call `rpi_artifact_save` only if the file is inside the task directory. Repository config files are normal repository files and should be committed through the regular git flow, not saved as task artifacts.

### 3. Apply setup in current bb worktree

Do not run `git worktree add`. Plugin creates/reuses environment. Verify and perform file-copy and setup-command.

Source for copyGlobs: `workspace.defaultDirectory` from `rpi_task_context`, else repo root.

Resolve effective config: defaults, workspace.json, workspace.local.json, per-repo overrides.

Only `{{ TASKSLUG }}` and `{{ REPOBASENAME }}` template variables. Unsupported variables are errors.

For each repo:

#### 3.1: Verify worktree

```bash
ls -la <localPath>
git -C <localPath> rev-parse --git-dir
git -C <localPath> status --short --branch
```

Compare `sourceRef`, path/branch templates with bb environment. Report requested vs actual.

#### 3.2: Copy files

Build `copyGlobs` additively, de-duplicate. Copy only files that exist in the source checkout and are safe to copy. Preserve the relative path under the target worktree.

Record: files copied, no-match patterns, skipped items, already present.

No `node_modules` unless user configured and confirms.

#### 3.3: Run setup command

Non-empty `setupCommand`: run from worktree path. Capture command, status, output.

If the command fails, stop before Step 4. Report the failure and work with the user on retrying, skipping, or changing the config.

### 4. Report success

Only after all repos verified, all setup commands succeeded or skipped.

Receipt from `references/worktree_template.md`. Task artifact: call `rpi_next_artifact_number`, write `NN-worktree-setup-*.md`, call `rpi_artifact_save`.

`{implementation_command}`: `/rpi-implement-outline` for `outline_only`, else `/rpi-implement-plan`.

Read and use `references/worktree_final_answer.md`. The final answer must include the saved artifact directive and end with exactly one fenced `text` block containing the manual next command. Auto-advance does not apply at this gate.

## Rules

- `.rpi/workspace.json` matches research schema.
- `.rpi/workspace.local.json` gitignored, machine-specific.
- Multi-repo setup sequential, record all.
- Verify bb environment, not just config existence.
- Read only: task file, plan/outline, @file args, requested comments.
