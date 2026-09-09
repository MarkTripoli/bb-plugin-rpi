---
date: [ISO timestamp]
git_commit: [commit]
branch: [branch]
repository: [repo]
topic: "[topic]"
type: research
summary: "[Two to four sentences: what this document establishes, the decisions it fixes, and what a later phase needs from it. Downstream sessions read this instead of the full file.]"
tags: [research, codebase]
status: complete
---

# Research: [topic]

**Date**: [timestamp]
**Git Commit**: [commit]
**Branch**: [branch]
**Repository**: [repo]

## Research Question

[Copy the research question or questions that drove this pass. Use a numbered list when there is more than one.]

## Research Methodology

This document records current behavior only. It does not recommend implementation work, refactors, optimizations, or future changes.

[Name the sources actually examined and any limit that affects the findings. One sentence is usually enough.]

## Summary

[Lead with the answer in a short paragraph. Add detail only for distinct findings the reader needs before the evidence below.]

## Detailed Findings

[Organize by concept or behavior, not by source file and not by original question. Each section heading should state a concrete finding.]

### 1. [Takeaway heading that states what is true]

[Explain the current behavior. Cite code, tests, docs, or external sources inline. Use tables, Mermaid diagrams, call trees, file trees, component trees, endpoint or type shapes, and pseudocode when they make the current system easier to understand.]

#### Testing patterns

[List the test files, test type, fixtures, mocks, or harnesses that cover this area. If none were found, say so directly.]

### 2. [Next takeaway heading]

[Continue the same pattern.]

#### Testing patterns

[Testing evidence for this section.]

## Code References

[Group the important files and directories by subsystem. Mark whether a group is exhaustive for the researched area or a representative set.]

### [Group name]

- `path/to/file.ts:10-40` - [What evidence lives here.]
- `path/to/directory/` - [What this directory owns; note whether additional files exist.]

## Architecture Documentation

[Explain how the findings fit together. Link to details already covered above; add only relationships or constraints not yet explained.]

## Open Questions

[List remaining factual unknowns after the optional second pass. Use "None." when the research answered the relevant questions.]
