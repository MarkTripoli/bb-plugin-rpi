---
task: eng-xxxx-description
type: plan
summary: "[Two to four sentences: what this document establishes, the decisions it fixes, and what a later phase needs from it. Downstream sessions read this instead of the full file.]"
repo: [repository name]
branch: [branch name]
sha: [current commit]
---

# [Feature or Task Name] Implementation Plan

## Overview

[Brief description of what is being implemented and why.]

## Current State Analysis

[What exists now, what is missing, and the constraints that matter.]

### Key Discoveries:

- [Observed repository fact with source location]
- [Existing approach this should match]
- [Limit or risk to preserve]

## Desired End State

[Specification of the completed state and how it will be verified.]

## What We're NOT Doing

[Out-of-scope items that prevent drift.]

## Execution Strategy

[Implementation path and tradeoffs.]

---

## Phase 1: [Phase title]

### Goal

[Result this phase must produce.]

### Required Edits:

#### 1.1 [Area to modify]

**File**: `path/to/file.ext`
**Changes**: [Concrete edit and where it belongs.]

```diff
+ [specific code shape to add]
~ [specific existing shape to change]
```

### Success Criteria:

#### Automated Verification:

- [ ] [runnable command]

#### Manual Verification:

- [ ] [specific manual step, only if useful]

**Implementation Note**: Pause after each phase's automated checks pass and wait for human confirmation before the next phase.

---

## Phase 2: [Phase title]

[Repeat this structure.]

## Human Review

### Review targets

- [Phase boundaries, dependencies, and changed-file ownership to inspect.]

### Verify

- [ ] [Exact plan or acceptance check required before implementation.]

### Known limits

- [Known limit, or `None.`]
