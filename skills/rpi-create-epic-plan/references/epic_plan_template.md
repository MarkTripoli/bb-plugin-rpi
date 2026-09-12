---
task: eng-xxxx-description
type: epic-plan
summary: "[Two to four sentences: what this epic delivers, how many children it creates, and which children gate the rest. Downstream sessions read this instead of the full file.]"
repo: [repository name]
branch: [branch name]
sha: [current commit]
---

# [Epic name] Epic Plan

## Goal

[Outcome the epic delivers once every child has merged.]

## Current State

[What exists now and the constraints that matter, taken from research with source locations.]

## Decomposition

[Why these children, at this granularity, in this order. Name the boundary that makes each child mergeable on its own.]

## Children

```json
[
  { "name": "[Child outcome]", "workflow": "oneshot", "depends_on": [], "prompt": "[Self-contained task description]" },
  { "name": "[Child outcome]", "workflow": "rpi", "depends_on": ["[Child outcome]"], "prompt": "[Self-contained task description]" }
]
```

## Ordering

- Wave 1: [children with no dependencies]
- Wave 2: [children whose dependencies are all in wave 1]

## Human Review

### Review targets

- [Child boundaries, dependency edges, and workflow type choices to inspect.]

### Verify

- [ ] [Exact check required before delivery starts.]

### Known limits

- [Known limit, or `None.`]
