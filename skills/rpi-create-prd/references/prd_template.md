---
task: eng-xxxx-description
type: design-prd
repo: [current repository]
branch: [current branch name]
sha: [result of git rev-parse HEAD]
---

# [PRD Title]

### Problem to Solve

[State the user pain, product gap, or business need. Keep this in product language, not implementation language.]

- [What users see today]
- [Where the current workflow breaks down]
- [Why the problem matters]

### What does business success look like, and how can we measure it?

- [What will be true after shipping]
- [The signal that tells us the change helped]
- [Expected user behavior, operational outcome, benchmark, or qualitative review]
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

```task-artifact
.humanlayer/tasks/{task-slug}/mockup-{description}.html
```

[Explain what the mockup demonstrates.]

### Out of Scope

- [Behavior explicitly not included]
- [Future work not needed for this version]
