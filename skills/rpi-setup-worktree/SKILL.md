---
name: rpi-setup-worktree
description: Run for /rpi-setup-worktree requests. Verify and finish task workspace setup inside the current bb environment.
---

After the task-context step, read the [RPI writing guide](../WRITING.md), resolved relative to this installed skill directory. Apply it before drafting or revising artifacts and before replying.

## Steps to Follow

### Step 0: Decide whether setup is skipped

Call `rpi_task_context` before reading files. Use its task directory, task slug, artifact list, workspace data, bb environment id, provider, and model preferences.

Read workspace configuration from the repository root when present:

```text
.rpi/workspace.json
.rpi/workspace.local.json
```

The local file overrides shared config. If the effective root config has `disabled: true`, do not continue with setup unless the user explicitly asks you to override it.

When setup is disabled, ensure the current branch is suitable for the task if the repository is writable, then answer with a manual implementation handoff. Use `/rpi-implement-outline` for `outline_only`; use `/rpi-implement-plan` for every other workflow.

Next, check whether the current bb environment is already a managed worktree:

```bash
bb environment show $BB_ENVIRONMENT_ID
git rev-parse --git-dir
```

If the git dir shows you are already inside a worktree, that is the normal path. Do not request another worktree. Continue with the setup work in the current worktree: resolve workspace config from the base path reported by `rpi_task_context`, apply copyGlobs, run setupCommand, and verify the branch.

### Step 1: Gather required task information

Use the task slug from `rpi_task_context`. Read `task.md` or `ticket.md`, then read the selected implementation source artifact when present:

- plan artifact for `/rpi-implement-plan`
- structure outline for `/rpi-implement-outline`

List the task directory with `ls -La .rpi/tasks/<task-slug>` if the source artifact is not already known. Do not use glob-only discovery for task mirrors because they may be symlinks.

### Step 2: Create default config only when none exists

Run this step only if neither workspace config file exists.

Check whether the repository has an old setup script or documented worktree convention. Read only targeted files such as:

```text
scripts/create_worktree.sh
README.md
Makefile
package.json
```

If a legacy setup script or documented task-worktree command exists, read its usage, ask before running it, run it only against the current bb worktree, then verify branch and setup output before continuing. Do not let a legacy script create a second worktree unless the user explicitly requests that escape hatch.

If no convention exists, write `.rpi/workspace.json` using the documented schema:

```json
{
  "repos": [
    {
      "localPath": ".",
      "description": "Selected repository",
      "primary": true
    }
  ],
  "disabled": false,
  "sourceRef": "HEAD",
  "branchTemplate": "{{ TASKSLUG }}",
  "pathTemplate": "~/.rpi/workspaces/{{ TASKSLUG }}/{{ REPOBASENAME }}",
  "setupCommand": "",
  "copyGlobs": [
    ".rpi/workspace.local.json",
    "CLAUDE.local.md",
    ".env*",
    ".claude/settings.local.json"
  ]
}
```

For multi-repo tasks, add sibling repos with relative `localPath` values and exactly one `primary: true`. `localPath: "."` means the repository containing the config.

After writing either workspace config, call `rpi_artifact_save` only if the file is inside the task directory. Repository config files are normal repository files and should be committed through the regular git flow, not saved as task artifacts.

### Step 3: Apply setup in the current bb worktree

Do not run `git worktree add`. The plugin launcher creates or reuses the bb environment according to task settings. This skill verifies that environment and performs the file-copy and setup-command steps that the workspace config describes. Use `workspace.defaultDirectory` from `rpi_task_context` as the source checkout for copyGlobs when it is present; otherwise use the repository root of the base task environment.

Resolve the effective config:

- Defaults.
- `.rpi/workspace.json`.
- `.rpi/workspace.local.json`.
- Per-repo overrides.

Use only `{{ TASKSLUG }}` and `{{ REPOBASENAME }}` template variables. Treat unsupported variables as a configuration error.

For each repo entry:

#### Step 3.1: Verify the repo worktree

Confirm the local path exists and is a git repository:

```bash
ls -la <localPath>
git -C <localPath> rev-parse --git-dir
git -C <localPath> status --short --branch
```

Compare `sourceRef`, requested path template, and branch template with the current bb environment. bb may choose the actual worktree path and branch name; report requested vs actual instead of trying to rename them.

#### Step 3.2: Copy configured files

Build `copyGlobs` additively with de-duplication. Copy only files that exist in the source checkout and are safe to copy. Preserve the relative path under the target worktree.

Record for each pattern:

- files copied
- no-match patterns
- skipped directories or unreadable files
- files already present and left untouched

Do not copy dependency directories such as `node_modules` unless the user explicitly configured them and confirms the cost.

#### Step 3.3: Run the setup command

If `setupCommand` is non-empty, run it from the repo's worktree path. Capture the command, exit status, and bounded output.

If the command fails, stop before Step 4. Report the failure and work with the user on retrying, skipping, or changing the config.

### Step 4: Report success only after setup is complete

Only use this step if every configured repo has been verified and every setup command succeeded or was intentionally skipped by the user.

Create a setup receipt with `references/worktree_template.md`. If it is saved as a task artifact, call `rpi_next_artifact_number`, write `NN-worktree-setup-*.md`, then call `rpi_artifact_save`.

Derive `{implementation_command}` from `rpi_task_context.task.workflow`: `/rpi-implement-outline` for `outline_only`, otherwise `/rpi-implement-plan`.

Read `references/worktree_final_answer.md` and answer using that template. The final answer must include the saved artifact directive and end with exactly one fenced `text` block containing the manual next command. Auto-advance does not apply at this gate.

## Additional Rules

- Keep `.rpi/workspace.json` compatible with the schema described in the research docs.
- Keep `.rpi/workspace.local.json` for machine-specific overrides and ensure it is gitignored when created.
- Multi-repo setup is sequential in this plugin. Record every repo result.
- Do not claim the workspace exists merely because config exists; verify the current bb environment.
- Do not read unrelated task artifacts. Use the task file, the selected plan or outline, explicit `@file` arguments, and comments the user asked about.
