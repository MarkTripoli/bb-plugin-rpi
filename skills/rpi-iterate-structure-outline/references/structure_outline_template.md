---
task: eng-xxxx-description
type: structure-outline
repo: [repository name]
branch: [branch name]
sha: [current commit]
---

# [Plan Title]

[Two or three sentence outline summary.]

## Desired End State

- [What is true when the work is complete]
- [How the completed behavior can be recognized]

## Phase Checklist

- [ ] Step 1: [Work area]
- [ ] Step 2: [Work area]

---

## Step 1: [Work area]

[What this phase accomplishes and why it is independently useful.]

### Change Outline

[Explain the phase in the order that makes it easiest to review. Use only the views that clarify ownership, contracts, data flow, or verification.]

```diff
 path/to/root/
 ├── existing-area/
+│   └── changed-file.ts        ~ owns the new behavior
 └── tests/
+    └── changed-file.test.ts   + covers the first path
```

[Short description connecting the file shape to the behavior.]

```ts
interface TargetShape {
  id: string
  status: 'draft' | 'ready'
}
```

### Validation

#### Automated Verification

- [ ] [runnable command]

#### Manual Verification

- [ ] [specific manual check, only if needed]

---

## Step 2: [Work area]

[Repeat the same structure.]

---

## Open Questions

- [Question that affects phase structure or scope]
