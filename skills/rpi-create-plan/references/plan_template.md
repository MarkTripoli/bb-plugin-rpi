---
task: eng-xxxx-description
type: plan
repo: [current repository]
branch: [current branch name]
sha: [result of git rev-parse HEAD]
---

# [Feature or Task Name] Implementation Plan

## Overview

[Brief description of what is being implemented and why.]

## Current State Analysis

[What exists now, what is missing, and the constraints that matter.]

### Key Discoveries:

- [Finding with file:line reference]
- [Pattern to follow]
- [Constraint to respect]

## Desired End State

[Specification of the completed state and how it will be verified.]

## What We're NOT Doing

[Out-of-scope items that prevent drift.]

## Implementation Approach

[High-level strategy and reasoning.]

---

## Phase 1: [Descriptive Name]

### Overview

[What this phase accomplishes.]

### Changes Required:

#### 1.1 [Component or File Group]

**File**: `path/to/file.ext`
**Changes**: [Specific change and location.]

```diff
+ [specific code shape to add]
~ [specific existing shape to change]
```

### Success Criteria:

#### Automated Verification:

- [ ] [runnable command]

#### Manual Verification:

- [ ] [specific manual step, only if useful]

**Implementation Note**: If manual validation is required, pause after automated checks pass and wait for human confirmation before the next phase.

---

## Phase 2: [Descriptive Name]

[Repeat this structure.]
