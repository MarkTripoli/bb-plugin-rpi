# RPI writing guide

Apply this guide to artifacts, revisions, and child-thread reports. The active skill still controls scope, required sections, evidence, approvals, and the exact final-answer format.

## State the useful fact first

- Start with the finding, decision, or changed behavior. Skip introductory promises and closing recaps.
- Use familiar words and direct verbs. Name the actor and action: "The worker retries failed uploads." Replace vague praise such as "robust" or "seamless" with the behavior that earns it.
- Keep necessary technical names exact. Explain an unfamiliar term once when the reader needs it. Avoid invented jargon and em dashes.
- Give each paragraph one point, usually in one to three sentences. Use bullets for separate items, numbered steps for order, and tables for comparisons.
- Make custom headings state a result: "Uploads resume from the last saved chunk." Preserve headings required by the template.

## Show the part the reader needs to understand

Use the smallest useful representation allowed by the phase:

| Reader needs to see | Use |
|---|---|
| A branch or algorithm | Pseudocode |
| Call order or ownership | Call, component, or shallow file tree |
| Messages, states, or data movement | Mermaid |
| A change to an existing shape | Small diff |
| A layout or interaction | Focused mockup |

Put the view beside the claim it explains. Add prose for the reason, constraint, or consequence the view cannot show. A clear sentence needs no diagram. Research views describe observed behavior; proposed shapes belong in design or planning.

## Say each thing once

- Explain a fact where it belongs. Elsewhere, link to that section instead of repeating its explanation. Keep summaries useful without duplicating the detail.
- Fill required sections with the smallest complete answer. Keep required empty sections explicit, for example "None." Remove a section only when its template permits omission.
- Preserve citations, contracts, failure paths, uncertainty, decision rationale, and verification evidence. Length follows the work; there is no whole-document word limit.
- On revision, replace outdated text and update its visual. Retain required decision records and review receipts, but keep the main document current rather than appending conversation history.
- Keep frontmatter summaries at two to four factual sentences for downstream sessions. Fill a final-answer `{summary}` with one or two sentences covering the result and any material unresolved item. Preserve the template's command fence and artifact directive exactly.

## Edit before saving or replying

Delete sentences that add no fact, reason, constraint, uncertainty, evidence, or next action. Replace vague claims with observable behavior. Check that cuts retained every required item and that observations remain distinct from proposals and unverified claims.

For example, replace "This enhancement provides a more reliable upload experience through improved recovery capabilities" with:

> Failed uploads resume from the last saved chunk. Closing the app preserves progress; cancelling the upload deletes it.

Use such specifics only when the source evidence or agreed design supports them.
