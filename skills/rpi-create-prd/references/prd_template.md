---
task: eng-xxxx-description
type: design-prd
repo: [repository name]
branch: [branch name]
sha: [current commit]
---

# [PRD Title]

### Problem to Solve

[Describe the product problem and user impact without implementation details.]

- [What users see today]
- [Where the current workflow breaks down]
- [Why the problem matters]

### Success Measures

- [Post-launch state]
- [Metric or observation that proves impact]
- [Behavioral, operational, benchmark, or review evidence]
- [Experiment or feature-flag reference if relevant]

### Proposed Solution

[High-level product direction. Fill this after foundation questions are resolved.]

- [Chosen path] - [rationale]

### Alternative Solutions Considered

[Paths considered but not chosen.]

- [Rejected path] - [reason]

### Solution Details

[Detailed product behavior, with mockups or diagrams embedded beside the prose they clarify.]

#### [Feature or flow title]

[Behavior and edge cases.]

::rpi-artifact{task="{task-id}" file="mockup-{description}.html"}

[Explain what the mockup demonstrates.]

### Out of Scope

- [Behavior explicitly not included]
- [Future work not needed for this version]
