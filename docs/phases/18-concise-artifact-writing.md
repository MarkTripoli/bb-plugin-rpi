# Phase 18: Concise artifact writing

All 33 RPI skills now load one [writing guide](../../skills/WRITING.md) before drafting, revising, or replying. Research and design-discussion templates also ask for shorter summaries and avoid repeating explanations.

## What the reference skills do

The reference prompts use several reinforcing techniques:

| Technique | Source in the reference checkout | Effect |
|---|---|---|
| Select the smallest useful visual | `third-party/show-me.SKILL.md`, opening and examples | Shows logic, call order, ownership, and changes directly. |
| Put visuals beside the text they explain | `third-party/skills/create-design-discussion/SKILL.md`, step 4 | Keeps the reader from matching a long explanation to a distant diagram. |
| Make headings state the takeaway | `third-party/skills/create-prd/SKILL.md`, opening rules; `create-research/SKILL.md`, Document Style and Format | Makes the argument readable by scanning headings. |
| Rewrite affected sections after decisions | `third-party/skills/create-prd/SKILL.md` and `create-tdd/SKILL.md`, opening rules | Prevents documents from accumulating a conversation log. |
| Use plain language and a structural change outline | `third-party/skills/describe-pr/SKILL.md`, steps 4 and guidance | Helps reviewers see changed behavior and implementation shape. |
| Require an exact final-answer template | `third-party/skills/create-design-discussion/SKILL.md`, steps 6 and 7 | Bounds the handoff instead of inviting another document summary. |

Paths above are relative to `~/PersonalDevelopment/bb-plugin-rpi-reference/`. These are the inspected local references, not a claim about the latest upstream release. Their research guidance also requires enough technical depth for the document to explain the system on its own. Brevity does not mean dropping evidence.

## What changed

- Added original writing guidance in `skills/WRITING.md`: direct language, short paragraphs, concrete headings, relevant visuals, no repeated explanations, and an editing pass before saving or replying.
- Added one relative reference to that guide in every phase and child-agent skill. Existing skill bodies and workflow rules are otherwise unchanged.
- Tightened the create/iterate research summary prompts. Methodology now asks which sources were actually inspected; architecture sections link to existing detail instead of repeating it.
- Tightened the create/iterate design-discussion prompts and removed introductory filler from the patterns section.
- Added coverage for every skill's guide reference and checked that the npm package contains the guide.

The guide preserves required sections, two-to-four-sentence frontmatter summaries, citations, contracts, failure paths, decision records, review receipts, approval gates, and final command fences. No runtime or dependency changes were needed. Reference text was studied and independently rewritten.

## Verification

`rtk npm test` passed. A final run after making the new test portable also passed:

```text
npm test
tests 243
pass 243
fail 0
skipped 0
```

This includes typechecking, final-answer extraction, registered-tool references, and the third-party shingle check.

```text
rtk bb plugin build
dist/server.js
dist/app.js
dist/app.css
```

```text
rtk npm run check:pack
npm pack contains 169 entries; dist/FEATURES.md/LICENSE/README.md and the writing guide present, docs/ and tests/ absent.
```

`bb skill list --json` resolved the installed RPI skills to this checkout. `bb skill show` for `rpi-create-design-discussion` returned the new guide instruction. A comparison against HEAD confirmed that each of the 33 skill bodies changed only by adding that instruction. `rtk git diff --check` passed.

## Limits and reviewer checks

These checks establish instruction coverage, packaging, and compatibility. No model-output comparison was run, and no install or reload was needed for the read-only skill lookup.

To measure writing quality, generate a research artifact, a design discussion, and a revision from identical inputs using the old and new skills on the same model. Check that every required fact and section survives, claims retain evidence, repeated explanations disappear, and visuals answer a concrete question. Compare output length only after checking completeness. Use the same cases after a model change.

A word-count ceiling or keyword linter would not establish those properties. The shared editing pass is the initial control; add automated model evaluations if these representative cases expose recurring failures.
