# Workspace Configuration

Write .humanlayer/workspace.json using this shape after the user accepts the proposal.

{
  "disabled": false,
  "pathTemplate": "~/.humanlayer/workspaces/{{ TASKSLUG }}/{{ REPOBASENAME }}",
  "branchTemplate": "{{ TASKSLUG }}",
  "sourceRef": "HEAD",
  "setupCommand": null,
  "copyGlobs": [],
  "repos": [
    { "localPath": ".", "description": "primary repository", "primary": true, "sourceRef": "HEAD", "setupCommand": null, "copyGlobs": [] }
  ]
}

Report unsupported path or branch template expectations as warnings, because bb owns actual managed-worktree names.