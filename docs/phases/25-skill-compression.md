# Phase 25: Skill compression

All 33 `SKILL.md` files went from 32,459 words to 16,562 (49% cut) with the same rules. Shared operational rules moved from ten pasted copies into the session prompt. A word budget test holds the gain.

## What changed

| Change | Where | Effect |
|---|---|---|
| Session contract | `sessions.ts` `SESSION_RULES`, `CHILD_THREAD_RECIPE` in `taskInstructions()` | The ten phase skills no longer carry "bb Task Setup", "Artifact and Reading Rules", "Markdown Formatting", "Document Precedence", or the `bb thread spawn` recipe. The plugin injects them once per session. Child threads (`rpi-agent-*`) are not in `sessionMirror`, so agent skills keep their own operational rules. |
| Contradiction resolved | same | Skills said "read task artifacts fully"; the session said "primary input fully, others by summary" (phase 19 noted the conflict). Only the session rule remains. |
| Every skill rewritten | `skills/*/SKILL.md` | Imperative, one rule per line, articles kept, no filler, no examples that duplicate a `references/` template. Frontmatter and the writing-guide line are byte-identical. `references/` untouched. |
| Budget test | `tests/writing.test.ts` | Each `SKILL.md` at most 850 words, all skills at most 18,000 words, no `≠` or `→` in skill prose. |

## How the rewrite was checked

Eight parallel lanes (one writer per file, `claude-sonnet-4-5`) compressed the skills under a contract: keep every tool name, reference file, command, gate, stop-and-ask rule, workflow branch, and boundary; delete only words and the shared blocks above.

A second pass of eight lanes diffed each rewrite against `git show HEAD:` and classified every original rule as kept, weakened, or dropped, then restored drops as one terse line each. The first pass lost real rules: the research lane alone had 13 and 16 drops per file (for example "do not write the artifact until all child threads finish", "spawn children again at most once", "never repeat the current command as the next step"). The review pass restored them. It also re-added a few shared rules to phase skills; those seven duplicates were removed by hand.

## Verification

```text
npm test        tests 248, pass 248, fail 0
bb plugin build dist/server.js dist/app.js dist/app.css
```

Passing suites that guard behavior: final-answer templates still parse to the expected next skill, every referenced `rpi_*` tool is registered, every skill loads the writing guide once, the third-party shingle test ran against the sibling checkout, no em dashes, no product-name leaks.

Largest files after: create-tdd 791, iterate-tdd 768, implement-plan 721, create-research 719.

## Open items

- No live run yet. The first RPI session on each phase is the real test; watch for a skill that asks for something the session prompt now owns, or a gate that no longer fires.
- `references/` templates (6,089 words) were left alone. Their placeholder text is what agents fill, so compressing them is a different exercise from this one.
- The 850-word cap has 60 words of headroom on create-tdd. Raise it only with a phase doc.

## Rebase onto main

Main merged bounded artifact access (`rpi_artifact_read`, `rpi_artifacts_list`, `handoff.md`, phases 19 to 23) while this work was in flight. The compressed skills were rebased on top: every `ls -La` listing became `rpi_artifacts_list`, "read fully" became `rpi_artifact_read` on the exact selected revision, implementers read only the assigned phase, and research skills do not read `task.md`, `ticket.md`, or a withheld checkpoint. `SESSION_RULES` carries the discovery rule; main's artifact-context and handoff rules stay as written.
