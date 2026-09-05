# Workspace Configuration Receipt

Write `.humanlayer/workspace.json` with this schema after the user accepts the proposal.

{
  "disabled": false,
  "pathTemplate": "~/.humanlayer/workspaces/{{ TASKSLUG }}/{{ REPOBASENAME }}",
  "branchTemplate": "{{ TASKSLUG }}",
  "sourceRef": "origin/main",
  "setupCommand": "",
  "copyGlobs": [
    ".env",
    ".env.local",
    ".env.development.local",
    ".claude/settings.local.json",
    ".humanlayer/workspace.local.json"
  ],
  "repos": [
    {
      "localPath": ".",
      "description": "Selected repository",
      "primary": true
    }
  ]
}

## Validation
- repo root:
- remotes:
- repo entries checked:
- setup command:
- local override:

Report requested path and branch templates as config intent. bb owns the actual managed-worktree path and branch.
