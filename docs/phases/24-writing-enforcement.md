# Phase 24: Writing enforcement at the save chokepoint

Generated artifacts stayed verbose after phase 18 because the guide was advice with no check behind it. This phase rewrites the guide as hard rules and adds one mechanical check where every artifact already passes: `rpi_artifact_save`.

## What changed

| Change | File | Effect |
|---|---|---|
| Filler lint | `writing.ts` (new, pure) | `lintWriting(markdown)` returns up to 20 `{line, match, text}` hits for meta commentary, recap transitions, empty adverbs, wordy phrases, praise words, tour-guide voice, and em dashes. Skips fenced code and blockquotes. |
| Save returns issues | `tools.ts` `rpi_artifact_save` | For `.md` artifacts, the result gains `writing_issues` and a `writing_action` line telling the agent to fix each line and save again. Ingest still succeeds; the check is a loop, not a gate. |
| Session rule | `sessions.ts` `taskInstructions()` | One sentence: fix every listed `writing_issues` line and save again before replying. |
| Guide rewrite | `skills/WRITING.md` | Ten numbered shape rules, a Delete-on-sight table mirroring the lint, a replies-and-reports section (first line result, last line next action, numbered steps, no mid-work tangents), and a five-step pre-save check. Persistence stated up front. |
| Template fix | `rpi-describe-pr/references/pr_description_template.md` | The lint caught "keep in mind" in a placeholder. |
| Naming fix | `docs/phases/18-concise-artifact-writing.md` | Removed three mentions of the third-party product name that failed `tests/naming.test.ts`. |

Ideas taken from the caveman and i-have-adhd skills: a concrete forbidden list instead of principles, a pre-send deletion checklist, "first and last line must stand alone", persistence across the session, and bad/good pairs. Not taken: dropped articles and fragments (artifacts are read by later sessions and humans), time estimates, and the five-item list cap (inventories such as code references need completeness).

## Why a phrase lint and not a length cap

Phase 18 rejected word counts because they do not measure completeness. A phrase list is precise: each hit is text that carries no fact, so removing it never drops evidence. The list is the extension point; add a pattern when a phrase keeps surviving review.

## Verification

```text
npm test
tests 247, pass 247, fail 0
bb plugin build
dist/server.js dist/app.js dist/app.css
```

`tests/writing.test.ts` covers: each pattern class with line numbers, fenced code and blockquote skipping, the 20-issue bound, and that every shipped `*_template.md` passes the lint. The shingle test ran against the sibling reference checkout.

## Open items

- No model-output comparison was run. Generate one research and one design artifact from identical inputs and count `writing_issues` on first save; a nonzero count that reaches zero on the second save shows the loop works.
- The skills themselves total 6,605 lines of markdown and are loaded per session. Compressing `SKILL.md` bodies is the next token win and a separate phase; a per-skill line budget test would hold the gain.
- Research and plan templates repeat frontmatter fields (date, commit, branch, repository) in the body. Removing the body block depends on whether the artifact panel renders frontmatter.
