---
name: rpi-configure-workspaces
description: Run for /rpi-configure-workspaces requests. Propose, write, and validate HumanLayer workspace config files for bb-managed task environments.
---

# Configure Workspaces

## Purpose

This skill reads the selected repository, proposes `.humanlayer/workspace.json` and optional `.humanlayer/workspace.local.json`, writes the approved files, and validates that the config can drive task workspace setup.

The files control how RPI tasks request workspace behavior:

- `.humanlayer/workspace.json` is shared repository config and can be committed.
- `.humanlayer/workspace.local.json` is machine-specific override data and must stay out of git.

bb owns actual managed-worktree creation. This config still records source refs, setup commands, file-copy requests, and multi-repo intent so `/rpi-setup-worktree` can finish setup inside the bb environment.

Use plain, brief language when talking to the user.

## Steps to Follow

### Step 0: Select the repository

Call `hl_task_context` first when this skill runs inside a task session. If no task context is available, continue as a repository configuration session and say that no task artifact will be saved.

Check the current location:

```bash
pwd
printf '%s\n' "$HOME"
git rev-parse --path-format=absolute --show-toplevel
```

If git confirms a repository, use the current checkout and state the selected root in one sentence.

If the current directory is home or is not inside a git repository, ask exactly one question:

```text
Which repository should I configure? Send its path.
```

After the user gives a path, confirm it with:

```bash
git -C <path> rev-parse --show-toplevel
```

Use the returned repository root for every later read and command.

### Step 1: Read the project

From the selected repository root, read any current workspace config:

```text
.humanlayer/workspace.json
.humanlayer/workspace.local.json
```

Use existing config as the starting point. Then inspect only the signals needed to infer workspace setup:

```text
.claude/settings.json
package.json
Makefile
README.md
```

Also inspect sibling repo names and remotes:

```bash
ls -la ../
git remote -v
```

If `git remote -v` shows multiple plausible push or fetch remotes and the requested base is not obvious, ask which remote should be used before writing `sourceRef`.

If the task context named `task.md`, `ticket.md`, or explicit `@file` artifacts, read those only when they change the workspace proposal. Do not browse unrelated artifacts.

### Step 2: Draft workspace config

Derive a complete workspace config from repository evidence and the user's request.

Use these defaults unless the repository provides better evidence:

- Single repo unless sibling repos are clearly part of normal development.
- `localPath: "."` and `primary: true` for one repo.
- Exactly one primary repo in a multi-repo config.
- The repo with shared agent settings, MCP-style config, or team policy is usually primary.
- `~/.humanlayer/workspaces/{{ TASKSLUG }}/{{ REPOBASENAME }}` as `pathTemplate`.
- `{{ TASKSLUG }}` as `branchTemplate`.
- `origin/main` as `sourceRef` when that remote branch exists; use `HEAD` when no reliable branch is known.
- Setup command inferred from package-manager files, Makefile targets, or README instructions.
- `copyGlobs` for local files that usually matter in a new worktree: env files, machine-only tool settings, and `.humanlayer/workspace.local.json`.
- Machine-specific paths, secrets, and local-only commands go in `.humanlayer/workspace.local.json`.

For multi-repo workspaces:

- Sessions start in the primary repo's bb environment by default.
- Instruction and skill files may exist in several repos, but the launch directory controls repo-local settings.
- Add related sibling repos with paths such as `../api` or `../web`.
- Mark exactly one repo with `primary: true` when there is a clear default.

After inspection, present the shared config proposal in a fenced `json` block. When machine-local overrides are needed, include a separate fenced `json` block for `.humanlayer/workspace.local.json`.

End that response with:

```text
Tell me what to change, or approve this config.
```

If the user requests changes, print the full updated JSON again. Do not write files before approval.

### Step 3: Validate the proposal

Validate before asking for final approval.

For a single repository, the shared config should follow this shape:

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
  "sourceRef": "origin/main",
  "branchTemplate": "{{ TASKSLUG }}",
  "pathTemplate": "~/.humanlayer/workspaces/{{ TASKSLUG }}/{{ REPOBASENAME }}",
  "copyGlobs": [
    ".humanlayer/workspace.local.json",
    ".env.local",
    ".claude/settings.local.json",
    ".env",
    ".env.development.local"
  ],
  "setupCommand": ""
}
```

For a coordinated multi-repo workspace, use the same root fields and list every repo:

```json
{
  "repos": [
    {
      "localPath": ".",
      "description": "Coordination repository",
      "primary": true
    },
    {
      "localPath": "../api",
      "description": "API service",
      "setupCommand": "npm install"
    },
    {
      "localPath": "../web",
      "description": "Web app",
      "sourceRef": "origin/main"
    }
  ],
  "disabled": false,
  "sourceRef": "origin/main",
  "branchTemplate": "{{ TASKSLUG }}",
  "pathTemplate": "~/.humanlayer/workspaces/{{ TASKSLUG }}/{{ REPOBASENAME }}",
  "copyGlobs": [
    ".humanlayer/workspace.local.json",
    ".env.local",
    ".env"
  ],
  "setupCommand": "npm install"
}
```

Config rules:

- `localPath: "."` means the repository being configured.
- Other `localPath` values are resolved relative to that repository.
- Only `{{ TASKSLUG }}` and `{{ REPOBASENAME }}` are valid template variables.
- `copyGlobs` merges additively with de-duplication. Local and per-repo lists extend inherited lists; they do not replace them.
- A repo entry can supply its own `sourceRef`, `setupCommand`, `copyGlobs`, or `primary` value.
- Keep `branchTemplate` on the top-level config object.
- `.humanlayer/workspace.local.json` may use `{ "$patch": "delete" }` on a repo entry to remove it locally. Do not put that patch marker in shared config.
- `disabled: true` at the root disables workspace setup.
- In bb, `sourceRef` maps to task launch base branch only when it is `HEAD`, absent, `origin/<branch>`, or a named branch. Treat raw SHAs or unsupported refs as invalid for automatic launch.

Validate with commands:

```bash
git remote -v
ls -la <localPath>
git -C <localPath> rev-parse --git-dir
git -C <localPath> remote -v
```

For each repo, confirm the directory exists and is a git repo. If `sourceRef` names a remote, verify that remote exists. If a setup command is proposed, state what it will do in one sentence.

### Step 4: Write the approved config

After approval, write `.humanlayer/workspace.json` with the approved shared content.

If local overrides are part of the proposal, write `.humanlayer/workspace.local.json` too and ensure it is ignored by git:

```text
.humanlayer/workspace.local.json
```

Read `.gitignore`. Add the ignore entry only when missing.

Repository config files are normal repo files. Do not call `hl_artifact_save` for them unless you also create a task artifact receipt in `.humanlayer/tasks/<slug>/`.

### Step 5: Confirm and summarize

Write a short confirmation covering:

- Files written.
- Repo count.
- Primary repo.
- Path template.
- Branch template.
- Source ref.
- Setup command and whether it runs.
- Files requested for copy.

Explain the next step in bb terms:

```text
The workspace configuration is ready.

When a task requests a workspace, bb creates or reuses the task environment. Then /rpi-setup-worktree verifies the environment, copies configured files, runs setup commands, and starts implementation in the primary repo.
```

For team repositories, remind the user to commit `.humanlayer/workspace.json` and not `.humanlayer/workspace.local.json`.

If you write a task receipt, call `hl_next_artifact_number`, write it from `references/workspace_template.md`, call `hl_artifact_save`, and include the returned directive in the final answer. Then read `references/workspace_final_answer.md` and use it exactly.

## Key Concepts for This Skill

### Template variables

Only two variables are supported:

- `{{ TASKSLUG }}`: the task slug, such as `eng-123-small-fix`.
- `{{ REPOBASENAME }}`: the basename of each resolved repository path, such as `api` or `web`.

Reject or ask about any other template variable.

### Repo precedence rules

Effective config is:

```text
defaults -> workspace.json -> workspace.local.json
```

For `repos[]`, entries with the same `localPath` merge, and later fields win. A new `localPath` adds a repo. A local override entry with `$patch: "delete"` removes the matching repo for this machine.

### copyGlobs semantics

Every `copyGlobs` list extends the inherited list. Build the effective list in order and drop duplicates while preserving the first occurrence.

Root lists apply to every repo. Repo-level lists add repo-specific files. There is no removal syntax for individual globs in v1.

### Primary repo

In a multi-repo workspace, one repo should usually be primary. That repo is the default launch directory for task sessions. A single-repo config is implicitly primary even if the field is omitted.

Choose the repo that should own local agent settings and day-to-day implementation commands. If no clear primary exists, ask the user rather than guessing.

### Coordination repos

A coordination repo may hold planning files while implementation lives in sibling repos. In that case, `localPath: "."` still means the coordination repo. Mark the implementation repo as primary when it should be the default session location.

### disabled field

`disabled: true` disables workspace setup. Use it when a project should always run in the selected checkout. A local override can set `disabled: false` to re-enable setup on one machine without changing shared config.

## Reference Files

Locate this skill through the skills tier listing. Read reference files relative to this skill directory:

- `references/workspace_template.md` for the receipt shape.
- `references/workspace_final_answer.md` for the final response.
