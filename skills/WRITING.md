# RPI writing guide

Applies to every artifact, revision, child-thread report, and final reply for the rest of the session. The active skill still owns scope, required sections, evidence, approvals, and the exact final-answer format. When a rule here would delete a required item, the skill wins.

Every sentence earns its place by carrying one of: a fact, a reason, a constraint, an uncertainty, evidence, or a next action. Delete the rest.

## Shape

1. First line states the result, decision, or finding. No lead-in, no plan of what the document will do.
2. One point per paragraph, one to three sentences. Bullets for separate items, numbered lists for order, tables for comparisons.
3. Custom headings state the finding: "Uploads resume from the last saved chunk", not "Upload behavior". Template headings stay as written.
4. Name the actor and the action: "The worker retries failed uploads." Replace praise words with the behavior that earns them.
5. Say each fact once, where it belongs. Elsewhere, link to that section. A summary points at detail; it does not repeat it.
6. Explain an unfamiliar term once, where the reader first needs it. Keep technical names exact. No em dashes.
7. Show, do not narrate, when a shape carries the point: pseudocode for a branch, a call or file tree for ownership, Mermaid for messages and states, a small diff for a change, a focused mockup for a layout. Put the view beside the claim it supports. A clear sentence needs no diagram.
8. Fill a required section with the smallest complete answer. An empty required section reads "None." Remove a section only when its template allows it.
9. On revision, replace stale text and its visual. Keep required decision records and review receipts. The document is the current state, not a conversation log.
10. Frontmatter `summary:` is two to four factual sentences: what this establishes and what a later phase needs from it. A final-answer `{summary}` is one or two sentences: result plus any material unresolved item. Command fences and artifact directives stay byte-exact.

## Delete on sight

`rpi_artifact_save` flags these and returns them as `writing_issues`; fix every line and save again.

| Kind | Examples |
|---|---|
| Meta commentary | it is important to note, note that, as mentioned above, in this section, this document describes |
| Recaps and transitions | in summary, in conclusion, overall, additionally, furthermore, moreover, finally |
| Empty adverbs | basically, essentially, obviously, clearly, of course |
| Wordy phrases | in order to, due to the fact that, the fact that, a number of, going forward |
| Praise words | robust, seamless, comprehensive, holistic, streamlined, leverage, utilize |
| Tour-guide voice | let's take a look, let us walk through |

Also delete: closing pleasantries, hedges that carry no real uncertainty, idioms and figurative phrases (write the literal action), and any sentence that restates the heading above it.

Keep a hedge that carries real uncertainty; deleting it fakes confidence. Keep citations, contracts, failure paths, decision rationale, and verification evidence even when they make the document longer. Length follows the evidence, never the other way around.

## Replies and child reports

- First line: what changed or what was found. Last line: the required command fence or the one next action.
- Number multi-step work. One bounded action per step.
- A second issue is a separate line at the end, not a tangent in the middle.
- Errors read as cause and fix: "Fails at `auth.spec.ts:42`: expected 200, got 401. Missing auth header."

## Before saving or replying

1. Delete the first sentence if it announces what follows.
2. Delete the last sentence if it recaps or asks "anything else".
3. Scan for the Delete-on-sight table. Rewrite each hit as the fact it was hiding, or drop it.
4. Check every required section and every citation survived the cuts.
5. Read only the first and last line. They must say what is true now and what happens next.

Example. Before:

> This enhancement provides a more robust upload experience through comprehensive recovery capabilities.

After:

> Failed uploads resume from the last saved chunk. Closing the app preserves progress; cancelling deletes it.

Write the second version only when the evidence or agreed design supports it.
