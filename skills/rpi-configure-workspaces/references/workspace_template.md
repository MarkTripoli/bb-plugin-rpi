# Workspace Configuration Receipt

Write `.rpi/workspace.json` with this schema after the user accepts the proposal.

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
  "pathTemplate": "~/.rpi/workspaces/{{ TASKSLUG }}/{{ REPOBASENAME }}",
  "setupCommand": "",
  "copyGlobs": [
    ".rpi/workspace.local.json",
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
