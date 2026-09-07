---
target: artifacts page + sidebar (ui/rpi.tsx)
total_score: 21
max_score: 40
na_heuristics: 
p0_count: 2
p1_count: 2
timestamp: 2026-09-07T18-35-54Z
slug: ui-rpi-tsx-artifacts-sidebar
---
Method: dual-agent (A: delegate e18392b8 · B: delegate d00fb93d), both isolated, both browser-inspected the live bb instance at 1440x900 and 390x844 (Dracula dark, real data). Scroll fix for the viewer landed before the run, so the scores describe the current tree.

## Design Health Score

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 2 | A collapsed task in the sidebar shows nothing while its Implementation session is Running; only the needs-you chip survives collapse. Saving a comment gives no confirmation beyond the rail growing. |
| 2 | Match System / Real World | 2 | "written by thr_s6i7rameph" (raw thread id); "line 10" in Preview is line 13 in Raw; YAML frontmatter renders as body text; "```diff" shows literally. |
| 3 | User Control and Freedom | 3 | Edit, delete, unresolve, restore, Escape all exist. "Send N comments" has no undo and its target cannot be verified. |
| 4 | Consistency and Standards | 1 | One session named four ways: "Implementation, attempt 7" (table, sidebar), "implementation: RPI Cleanup" (send select, six identical options), "Implementation" (send button), "session" (Needs-you band). Native select and checkbox next to shadcn everywhere else. Sidebar active row uses a darker `bg-card` while bb's own active nav row is a lighter `bg-sidebar-accent`. |
| 5 | Error Prevention | 2 | Send target defaults silently; six identical option labels make a wrong target likely and unverifiable. Delete has a confirm (good). |
| 6 | Recognition Rather Than Recall | 2 | Block ordinal vs source line forces the reader to translate when the agent replies. Which artifact the running phase is reading is not shown. |
| 7 | Flexibility and Efficiency | 3 | One Tab stop per document, ArrowUp/Down gutters, keyboard split handles with `aria-valuenow`, N/T/g-t hotkeys, persisted widths and collapse state. No jump-to-anchor from the rail, no shortcut to send. |
| 8 | Aesthetic and Minimalist Design | 1 | 434 px of chrome above the first line of text at 1440 (456 to the first paragraph, 684 to the document's own h1), 568 at 390 (h1 below the fold at load). Three concentric same-colour borders. A 320 px comments rail with two selects and a disabled button for zero comments. "Artifacts 11" appears as tab, heading and (phone) back button. |
| 9 | Error Recovery | 2 | Orphaned comments get an "Unanchored" section (good). Nothing tells the user a send target is superseded or that Preview cannot render a block faithfully. |
| 10 | Help and Documentation | 3 | Empty states teach, meta terms carry tooltips, the document's aria-label explains the keyboard model. Nothing explains why Save and Send are two steps. |
| **Total** | | **21/40** | **Acceptable (low end)** |

## Design Specificity Verdict

**LLM assessment (A, unanchored):** Mixed. The Sessions tab and the sidebar are authored for RPI: phase strip, "What it wants", "attempt 7 / forked from attempt 6", nested subagent rows, "N done sessions", needs-you chips that survive collapse. The Artifacts tab could be any file browser: filename, version select, Preview | Raw, a bordered pane, a Comments aside with two native selects. Nothing says "this is the plan the next phase reads"; no link from an artifact to the phase that wrote it or will consume it. Feels like bb only partially: tokens are bb's and the Raw view is bb's own `SourceCode` (which is why Raw looks more native than Preview), but the sidebar rows are 12px/24px against bb's 13px/28px, the active-row token is inverted, and there is a nested scrollbar inside the sidebar.

**Deterministic scan (B):** `detect.mjs --json ui/rpi.tsx components/ui` exits 0 with zero findings. The browser detector reported 525 anti-patterns at 1440, but 503 are `nested-cards` on the per-line block rows whose border is `border-transparent` at rest (false positive), 9 more are unselected artifact rows (same reason), and all 6 `layout-transition` hits are bb host chrome. Real hits: nested visible borders on the task tablist inside MAIN, the Preview/Raw segmented control inside the viewer card, and the send form inside the rail; `flat-type-hierarchy` on the landing page (11/12/13/16/18 px, ratio 1.6:1), which matches A's finding that document body, list rows and comment text all sit at 13px. The 20 `text-occlusion` hits at 390 are the host's closed sidebar drawer rendered at z-0 (false positive).

Where the detector caught what A missed: real horizontal overflow at 390 from long tokens in `<pre>` blocks (MAIN scrollWidth 375 vs 356, seven `pre` elements 246 to 296 vs 234); 30 unnamed disabled checkboxes rendered from GFM task lists; the artifact row's clickable button is 19 px tall inside a 41 px visual row because `px-3 py-2` sits on the non-interactive wrapper; every sidebar control is under 44 px (24 px rows, 24x24 icon buttons, 100 percent of 61 controls). Where A caught what the detector cannot: Markdown shredding, chrome height, naming inconsistencies, the missing running indicator, the ambiguous send target.

**Visual overlays:** injection succeeded on all three pages (1440 artifact, 390 artifact, landing) through the live server on port 8400; overlays were drawn in the assessment's own headless tab, not in your browser, and the server was stopped and confirmed closed. Screenshots with overlays: `/tmp/rpi-critique2/B/02-desktop-1440-overlay.png`, `04-phone-390-overlay.png`, `06-landing-1440-overlay.png`.

## Overall Impression

The status semantics, the keyboard model and the sidebar's information architecture are real product work. The artifact viewer is not: it renders one Markdown document per physical line, so paragraphs and lists break into orphan fragments, and it wraps that in three same-colour borders under 434 px of chrome, giving a 396x450 reading surface on a 1440x900 screen. "Way too bulky" is the felt version of both problems at once. The single biggest opportunity is to make the document the tab: one border, chrome collapsed to one row, comments deferred until they exist, and a renderer that keeps line anchors but draws Markdown blocks.

## What's Working

1. **The document's keyboard model.** One Tab stop for a 584-block document, ArrowUp/Down between gutters, Enter to comment, split handles exposed as named separators with `aria-valuenow`. The accessibility snapshot shows every icon-only control named (11 "Artifact actions", 584 "Add comment on line N", 24 "Thread actions", 4 "New chat on <task>").
2. **Status semantics.** Attention is yellow, running pulses green under `motion-safe:`, red is reserved for Delete and failure, and the sidebar chip, Needs-you band and Sessions table agree. Muted text measures 6.88:1 on the panel background.
3. **The sidebar's information architecture.** Task > live sessions > nested subagents > "N done sessions", needs-you count surviving collapse, drag-to-adopt, "New chat on this task" forking from the latest session. This is an RPI idea, not a restyle of bb's list.

## Priority Issues

**[P0] Preview shreds Markdown into per-line fragments.**
- Why it matters: `markdownBlocks` (blocks.ts) emits one block per non-blank physical line and each is rendered by `<Markdown>` on its own. A soft-wrapped list item becomes one bullet plus N bullet-less paragraphs, fences show "```diff" as text and lose their blank lines, frontmatter renders as two `<hr>` and five paragraphs. The artifact is the product's unit of review; if the plan cannot be read as prose, comments anchor to fragments, and the 25k px scroll height is mostly `mb-2` margins. Raw view (bb's `SourceCode`) renders the same file correctly, which is backwards for a Read surface.
- Fix: keep the per-line anchor model but render per Markdown block. Parse the document once, map each rendered block to its source line range, place one gutter per block carrying the block's first source line, and report that real line in "Add comment on line N" so it matches Raw. Collapse frontmatter into the meta line ("plan · rpi-cleanup · main @ 7bdc66e").
- Suggested command: `/impeccable typeset`, then `/impeccable harden` for anchor parity with Raw and the CLI.

**[P0] The reading surface is a 396x450 letterbox at 1440 and starts 568 px down at 390.**
- Why it matters: MAIN (rounded-2xl, p-4) > viewer card (border, p-3) > document pane (border, p-3), under plugin tabs, "All tasks", a 24px task name, the meta line, task tabs, "Artifacts 11 / Reimport files" and the viewer title row. `bg-card` and `bg-background` both compute to rgb(40,42,54) in Dracula, so the nesting produces only rings. The comments rail holds 320 px with zero comments. 48 percent of the desktop viewport and 68 percent of the phone viewport is chrome before the first line.
- Fix: drop the viewer card wrapper so the document pane is the only bordered box; merge title, version and Preview/Raw into the "Artifacts 11" row (move Reimport into the list's overflow menu); collapse the task header to one line when the Artifacts tab is active; render the rail as a 32 px "Comments 0 · +" strip until a comment or composer exists. Target: document text within 220 px of the viewport top at 1440 and 300 px at 390.
- Suggested command: `/impeccable distill`.

**[P1] The send target is ambiguous at the one high-stakes moment.**
- Why it matters: `CommentRail` lists `session.title ?? threadId`, producing six identical "implementation: RPI Cleanup" options for the same task; the Sessions table and sidebar call those sessions "Implementation, attempt 7 · forked from attempt 6". Comments are addressed to an agent; sending to attempt 3 (Done) instead of attempt 7 (Running) is silent, and the default cannot be verified before the click.
- Fix: label options with `attemptOrdinals` and `statusMeta` ("Implementation, attempt 7 · Running · 34m"), hide superseded sessions behind "Show older", carry the target name into the button and the toast, and show the send box only when there is an unresolved comment. Use `shortSessionTitle` for `versionAuthor` so "written by thr_s6i7rameph" disappears too.
- Suggested command: `/impeccable clarify`.

**[P1] The sidebar does not read as bb and hides running work.**
- Why it matters: RPI rows are 12px/24px against the host's 13px/28px; the active row uses `bg-card` (darker) while the host's active nav row uses `bg-sidebar-accent` (lighter), side by side in one sidebar; the RPI list is a nested scroller inside bb's scroller; a collapsed task header shows only the needs-you chip, never a running indicator, so "RPI Cleanup" looks identical idle or mid-implementation; 8 to 13 finished subagent rows stay expanded and push other tasks below the fold on the phone. PRODUCT.md's brand commitment is "must read as a native bb surface"; the owner's "doesn't feel like part of bb" is measurable here.
- Fix: adopt host row metrics and tokens (13px, h-7, `bg-sidebar-accent` active, `hover:bg-sidebar-accent/50`), remove the RPI root's `overflow-y-auto` so bb's scroller owns overflow, add a running dot to the task header when any live session is running, fold subagent rows once their parent is not busy.
- Suggested command: `/impeccable polish` for metrics and tokens; the running indicator belongs to `/impeccable clarify`.

**[P2] Phone: one 31,833 px scroll with the comment rail at the bottom, coarse-pointer gutters that overflow their column, and horizontal overflow from code.**
- Why it matters: stacked mode now has one scroll owner (correct), but the rail lands at y 31,730 and the send button with it. `pointer-coarse:size-9` puts a 36 px button in a 28 px grid column, so on a real phone every one of 584 lines shows a plus that touches the text. Seven `<pre>` blocks push MAIN to a horizontal scrollbar at 390.
- Fix: comments as a bottom sheet opened from a sticky "Comments N" pill (the vendored dialog already does bottom sheets); widen the gutter column to the coarse button or hide gutters on coarse pointers and comment by tapping a paragraph; `overflow-x-auto` or `break-all` on `pre`; make the viewer header sticky.
- Suggested command: `/impeccable adapt`.

## Persona Red Flags

**Alex (power user):** Six identical "implementation: RPI Cleanup" options; must count from the bottom to find attempt 7. Quotes "line 10" to the agent, the agent quotes line 13 back. Reads a 300-line plan through a 450 px pane with no hide-rail toggle (the handle stops at 260 px). No keyboard shortcut for Send. The row menu's "Copy path" copies a panel path, not the `.rpi/tasks/<slug>/<file>` path Alex would paste into a terminal.

**Sam (screen reader, keyboard):** Good: single Tab stop document, arrow-key gutters, named separators, sr-only status on sidebar rows, `aria-expanded` on groups. Fails: gutter labels report block ordinals, not lines; the group's aria-label promises "Enter to comment" but Enter on the container does nothing until an arrow key has moved focus; the version select reads "v1 · thr_s6i7rameph"; heading order runs h2 task > h3 "Artifacts" > h3 filename > document h1 > h4 "Comments"; 30 GFM task-list checkboxes have no name; the sidebar's 24 hover-only "Thread actions" buttons are all in the Tab order with no skip.

**Casey (one-handed phone through the remote shell):** 568 px before the document, the h1 below the fold at load, then a 31,833 px scroll to reach comments. "< Artifacts 11" back button sits directly under a tab that also says "Artifacts 11". Sidebar drawer: 13 finished subagent rows under one task fill the visible height while two tasks that need you sit below the fold. The "..." row menu is `opacity-0` with no coarse-pointer variant, so Fork, Archive and Move to task are unreachable by touch; "New chat on <task>" is a 24 px target.

**The owner returning between other work:** Pass: yellow count chips survive collapse and the landing band lists the four waiting sessions with Open. Fails: a task whose only live session is Running shows no signal at all when collapsed; inside a task the Artifacts tab carries no waiting state, so "which artifact has unsent comments" needs a scan of five group headers; two tasks named "SDK Dev" share a name in the band and the sidebar; the sidebar does not highlight the task whose detail page is open.

## Minor Observations

- `hover:bg-card/70` on artifact rows is invisible in Dracula (`bg-card` equals `bg-background`); the rows did not get the `bg-state-hover` treatment the harden pass gave the tables.
- Artifact names wrap to two lines after `middleEllipsis(40)` at a 300 px column; rows are 55 px tall while the clickable button inside is 19 px.
- Four of five artifact groups hold exactly one file; the group chrome is three times the payload.
- "Reimport files" is a repair action with primary placement at the top right of the list.
- `text-sm` computes to 13px in this host, not 14px; the whole panel's chrome uses only 12 and 13 px, and the document's body is also 13 px, so nothing in the document is larger than the UI around it except its own h1 (18 px) and h2 (15 px).
- "Show resolved" is an unstyled native checkbox; the send box uses two native selects; the rest of the panel is shadcn.
- In split-below mode the rail renders its own "Comments" h4 inside a wrapper that already has a "Comments N" header.
- Frontmatter `sha:` renders the full 40-character hash and wraps at 332 px.
- The version select shows "v1 · thr_s6i7rameph" even though the author's session is in the sessions list.
- The landing band says "session · 9m" for a freeform session the sidebar calls "freeform: SDK Dev".
- No reduced-motion problems found: pulses use `motion-safe:`.
- False positives to ignore in future detector runs: `nested-cards` on `border-transparent` block and artifact rows, `cramped-padding` on the `p-0.5` segmented controls, `layout-transition` on bb host chrome, `text-occlusion` on the closed phone drawer.

## Questions to Consider

1. If the document were the whole tab, with the list as a left drawer and comments as a right sheet, both closed by default, would anyone miss the three-column layout? Today's reading surface is 27 percent by 50 percent of the viewport.
2. Why does Preview need its own renderer? bb already renders Markdown in threads. What does a line-level anchor buy that a block-level anchor with a source line range does not, given the agent reads `.rpi/tasks/<slug>/<file>` and can quote either?
3. Should Send exist as a separate step, or should saving a comment on an artifact whose phase is running simply deliver it, with a five-second undo toast? Save-then-Send is the biggest trust moment and the one with the most ambiguous control.
4. The sidebar answers "who needs me" and not "what is running". Is a collapsed header without a running glyph a deliberate quieting or an omission? Both named references (bb workflows card, pi-subagents fleet view) always show a glyph.
5. One naming function (`shortSessionTitle` + `attemptOrdinals` + slug) routed through every surface would fix the send select, the version author, the band and the two "SDK Dev" tasks at once. What would it take?
