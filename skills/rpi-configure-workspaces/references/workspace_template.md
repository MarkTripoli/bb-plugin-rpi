# Workspace Configuration Receipt

Write `.humanlayer/workspace.json` with this schema after the user accepts the proposal.

{
  "repos": [
    {
      "localPath": ".",
      "description": "Selected repository",
      "primary": true
    }
  ],
  "sourceRef": "origin/main",
  "branchTemplate": "{{ TASKSLUG }}",
  "pathTemplate": "~/.humanlayer/workspaces/{{ TASKSLUG }}/{{ REPOBASENAME }}",
  "setupCommand": "",
  "copyGlobs": [
    ".humanlayer/workspace.local.json",
    ".env.local",
    ".env.development.local",
    ".claude/settings.local.json",
    ".env"
  ],
  "disabled": false
}

## Validation
- repo root:
- remotes:
- repo entries checked:
- setup command:
- local override:

Report requested path and branch templates as config intent. bb owns the actual managed-worktree path and branch.
