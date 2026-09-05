---
name: rpi-create-plan
description: Only use when the user explicitly invokes /rpi-create-plan. Create a detailed implementation plan from the structure outline.
---

# Create Plan

You are in the plan-writing phase. Expand the structure outline into a detailed implementation plan with concrete edits, examples, and verification. The plan is the last artifact before worktree setup or implementation.

## bb Task Setup

0. Call `hl_task_context` before reading files, spawning child threads, or choosing an artifact path. Use its task directory, task slug, artifact manifest, repository, branch, thread id, provider, and model preferences. If it fails, stop.
1. Use the task directory returned by the tool. Do not guess a sibling under `.humanlayer/tasks` from an old session or a remembered slug.
2. Locate this installed skill through the skills tier listing, then read reference files relative to this skill directory: `references/plan_template.md`, `references/plan_final_answer.md`, `references/plan_in_worktree_answer.md`, `references/plan_disabled_answer.md`.
3. After every artifact write or edit, call `hl_artifact_save` with the relative file name and keep the returned `::hl-artifact{...}` directive for the final answer.

## Steps

1. **Read all input files fully**:
   - Read supplied paths without partial reads.
   - List the task directory with `ls -La <task-dir>` and read relevant artifacts.
   - Read task or ticket, research, design discussion, PRD, TDD, and structure outline if present.
   - Exclude research-question artifacts; use completed research instead.

2. **Read relevant source files**:
   - Open source files named in research, design, or outline artifacts.
   - Verify file paths and examples before including them.
   - Use existing test patterns when planning tests.

3. **Read the plan template**:
   - Read `references/plan_template.md`.

4. **Write the implementation plan**:
   - Call `hl_next_artifact_number`.
   - Write `NN-plan-<slug>.md` in the task directory.
   - Convert each structure-outline phase into implementation steps.
   - Include concrete code examples where they clarify the change.
   - Include automated verification commands and real manual checks when needed.

## Plan Writing Guidelines

- Every phase should be independently testable.
- Prefer specific file edits, target functions, and short code examples over broad descriptions.
- Automated verification must be runnable commands.
- Manual verification must be concrete steps a person can perform.
- Pause for human confirmation between phases when manual validation is required.
- If research found testing patterns, include test additions or modified test examples that follow those patterns.
- Do not add manual validation just to fill a section.

## Output

1. Check whether worktree setup should be skipped or already satisfied:

```text
Read .humanlayer/workspace.json if present
Read .humanlayer/workspace.local.json if present
git rev-parse --git-dir
```

2. Choose the final answer template:
   - If the git dir includes `.git/worktrees/`, read `references/plan_in_worktree_answer.md`.
   - Else if workspace config disables setup, check out the task branch for the user using the task slug as the default branch name, then read `references/plan_disabled_answer.md`.
   - Otherwise read `references/plan_final_answer.md`.
3. Save the plan with `hl_artifact_save` and follow the selected template exactly.

## Artifact and Reading Rules

- Read task artifacts fully. Do not use partial reads for task files, user-mentioned files, or the artifact you are editing.
- List task directories with `ls -La <task-dir>`. Avoid plain `ls`, `ls -l`, search, and glob expansion inside `.humanlayer/tasks` because the path may be a linked directory.
- Do not read research-question artifacts during design, outline, or plan work. They guide the research phase only; use completed research instead.
- Do not inspect unrelated task directories unless the user explicitly asks.
- Treat failed artifact saves, failed comment calls, or unavailable task context as blockers. Do not work around them by writing untracked side files.
- Use `hl_next_artifact_number` when creating a new numbered artifact. The file name format is `NN-<type>-<2-4-word-kebab-slug>.md`.

## Markdown Formatting

When an artifact needs to show markdown that itself contains fenced code, wrap the outer example in four backticks so inner three-backtick blocks remain valid.

## Document Precedence

When documents disagree, the latest phase artifact wins:

**plan > structure outline > TDD > PRD > design discussion > research > ticket**

Earlier material provides context. The artifact from this phase records the current decision and should absorb later user feedback instead of leaving contradictions in place.
