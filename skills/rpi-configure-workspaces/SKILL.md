---
name: rpi-configure-workspaces
description: Run for /rpi-configure-workspaces requests. Propose, write, and validate RPI workspace config files for bb-managed task environments.
---

After the task-context step, read the [RPI writing guide](../WRITING.md), resolved relative to this installed skill directory. Apply it before drafting or revising artifacts and before replying.

# Configure Workspaces

## Purpose

Propose, write, and validate `.rpi/workspace.json` (shared, committable) and `.rpi/workspace.local.json` (machine-specific overrides, gitignored). These configure source refs, setup commands, file-copy requests, and multi-repo intent for `/rpi-setup-worktree`.

## Steps to Follow

### Step 0: Select the repository

Call `rpi_task_context` first. No task context: continue as repo config session, no artifact saved.

Check location:

```bash
pwd
printf '%s\n' "$HOME"
git rev-parse --path-format=absolute --show-toplevel
```

If git confirms a repo, use it. If home or not git, ask once:

```text
Which repository should I configure? Send its path.
```

Confirm given path:

```bash
git -C <path> rev-parse --show-toplevel
```

Use returned root.

### Step 1: Read the project

Read current config:

```text
.rpi/workspace.json
.rpi/workspace.local.json
```

Inspect setup signals:

```text
.claude/settings.json
package.json
Makefile
README.md
```

Check siblings and remotes:

```bash
ls -la ../
git remote -v
```

Multiple plausible remotes and no clear base: ask which remote.

Read task.md, ticket.md, or @file artifacts only when they change the proposal.

### Step 2: Draft workspace config

Defaults:

- Single repo unless siblings clearly needed.
- `localPath: "."`, `primary: true` for one repo.
- One primary in multi-repo.
- Repo with shared agent settings or team policy is usually primary.
- `pathTemplate: "~/.rpi/workspaces/{{ TASKSLUG }}/{{ REPOBASENAME }}"`.
- `branchTemplate: "{{ TASKSLUG }}"`.
- `sourceRef: "origin/main"` when it exists, else `HEAD`.
- Setup command from package.json, Makefile, or README.
- `copyGlobs`: env files, machine settings, `.rpi/workspace.local.json`.
- Machine-specific paths, secrets, local-only commands go in `.rpi/workspace.local.json`.

Multi-repo: mark one repo `primary: true`, add siblings as `../api`, `../web`.

Present shared config as `json` fence. Machine overrides as separate `json` fence.

End:

```text
Tell me what to change, or approve this config.
```

Changes requested: print full updated JSON. Do not write before approval.

### Step 3: Validate the proposal

Single-repo shape:

```json
{
  "repos": [{"localPath": ".", "description": "Selected repository", "primary": true}],
  "disabled": false,
  "sourceRef": "origin/main",
  "branchTemplate": "{{ TASKSLUG }}",
  "pathTemplate": "~/.rpi/workspaces/{{ TASKSLUG }}/{{ REPOBASENAME }}",
  "copyGlobs": [".rpi/workspace.local.json", ".env.local", ".claude/settings.local.json", ".env"],
  "setupCommand": ""
}
```

Multi-repo: list all repos with one `primary: true`.

Rules:

- `localPath: "."` is this repo.
- Only `{{ TASKSLUG }}` and `{{ REPOBASENAME }}` template variables.
- `copyGlobs` merges additively with de-duplication.
- Repo entry can override `sourceRef`, `setupCommand`, `copyGlobs`, `primary`.
- `branchTemplate` on root only.
- `.rpi/workspace.local.json` may use `{"$patch": "delete"}` to remove a repo locally.
- `disabled: true` disables setup.
- `sourceRef` valid for launch: `HEAD`, absent, `origin/<branch>`, named branch. Raw SHAs invalid.

Validate:

```bash
git remote -v
ls -la <localPath>
git -C <localPath> rev-parse --git-dir
git -C <localPath> remote -v
```

Confirm directory exists, is git repo. Verify remote exists if named. State setup command intent.

### Step 4: Write the approved config

Write `.rpi/workspace.json`.

If local overrides needed, write `.rpi/workspace.local.json` and ensure it is ignored by git:

```text
.rpi/workspace.local.json
```

Read `.gitignore`. Add the ignore entry only when missing.

Repo config files are normal files. Do not call `rpi_artifact_save` unless you also create a task artifact receipt in `.rpi/tasks/<slug>/`.

### Step 5: Confirm and summarize

Confirm: files written, repo count, primary repo, path/branch templates, source ref, setup command, copy files.

Next step:

```text
Workspace configuration ready. Task launch: bb creates/reuses environment, /rpi-setup-worktree verifies, copies files, runs setup, starts implementation.
```

Team repos: commit `.rpi/workspace.json`, not `.rpi/workspace.local.json`.

Task receipt: call `rpi_next_artifact_number`, write from `references/workspace_template.md`, call `rpi_artifact_save`, read and use `references/workspace_final_answer.md` exactly.

## Key Concepts

### Template variables

- `{{ TASKSLUG }}`: task slug.
- `{{ REPOBASENAME }}`: repo basename.

Reject others.

### Config precedence

```text
defaults -> workspace.json -> workspace.local.json
```

`repos[]`: same `localPath` merges, later wins. New `localPath` adds repo. `$patch: "delete"` removes locally.

### copyGlobs

Lists extend inherited, de-duplicate. Root lists apply to all repos. Repo lists add specific files. No removal syntax.

### Primary repo

Default launch directory. Single-repo implicitly primary. Multi-repo: mark one. Choose repo owning agent settings and implementation. Unclear: ask.

### disabled

`disabled: true` disables setup. Local override can re-enable.

## References

Read from this skill directory:

- `references/workspace_template.md`
- `references/workspace_final_answer.md`
