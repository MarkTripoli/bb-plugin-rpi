---
task: eng-xxxx-description
type: design-discussion
summary: "[Two to four sentences: what this document establishes, the decisions it fixes, and what a later phase needs from it. Downstream sessions read this instead of the full file.]"
repo: [repository name]
branch: [branch name]
sha: [current commit]
---

### Summary of change request

[Summarize the requested change from the task or ticket. Focus on user-visible behavior and the reason the work exists.]

### Current State

- [What users experience today.]
- [Current product behavior, UX gap, workflow pain, or operational limitation.]
- [Avoid implementation file paths unless the user-facing behavior depends on them.]

### Desired End State

- [What should be true after this work ships.]
- [What users can do, avoid, understand, or trust that they cannot today.]
- [How the behavior should feel in the workflow.]

### What we're not doing

- [Explicitly out-of-scope behavior, polish, migration, or platform support.]

### Proposed End State Architecture

[Concise design shape. Use a focused diagram, tree, pseudocode block, or inline HTML artifact when it makes the decision easier to review.]

### Design Questions

#### [Open decision title]

[The design question.]

- Option A: [choice, tradeoff, and impact]
- Option B: [choice, tradeoff, and impact]
- Option C: [optional third path]

Recommendation: [recommended option and why the research or product pattern supports it]

### Resolved Design Questions

#### [Resolved decision title]

[Chosen option] - [rationale] - [pattern or evidence that supports the decision]

[Brief note on alternatives not chosen and why.]

### Patterns to follow

These are existing product or codebase patterns that should constrain implementation.

#### [Pattern title]

[Summary of the pattern] - [path/to/file]

```
[short existing snippet]
```

```
[short target-shape snippet]
```
