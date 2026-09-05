# Phase 4: Comments

## Shipped

- Added `comments.ts` with comment create/reply/edit/resolve/unresolve/soft-delete/list operations, threaded root plus replies ordering, current-version re-anchoring, XML serialization, bounded XML output, and truncated id prefix resolution.
- Added comment RPC methods: `listComments`, `createComment`, `replyComment`, `editComment`, `resolveComments`, `deleteComment`, and `sendCommentsToSession`.
- Added the three native agent tools: `hl_get_artifact_comments`, `hl_update_artifact_comments`, and `hl_reply_to_artifact_comment`, selected only for HumanLayer task sessions through the existing synchronous `configure` callback.
- Added `sendCommentsMode` setting with default `send-and-resolve`.
- Added comment realtime publishes on create/reply/edit/update/delete/send and artifact badge refreshes through `hl:artifacts`.
- Replaced artifact comment count semantics with unresolved root discussion count.
- Added CLI commands: `bb humanlayer comments list|create|resolve --task --file`.
- Added artifact preview block selection, plus gutter composer, right-side comment rail, show-resolved toggle, reply/resolve/unresolve/edit/delete actions, unanchored grouping, session picker, and send mode picker.

## Verification

`npm test`

```text
> npm run typecheck
> tsc --noEmit
> node --test --import tsx
tests 54
pass 54
fail 0
```

Covered cases:

- re-anchor exact, context, fuzzy, and orphan
- XML escaping
- shortest unique prefixes extending two ids sharing 8 chars to 9 chars
- threaded chronological ordering
- truncated id ambiguity and not-found
- tool scoping error outside a HumanLayer task session
- send-and-resolve leaves comments unresolved when `threads.send` fails

`bb plugin build`

```text
dist/server.js
dist/server.js.map
dist/server.meta.json
dist/app.js
dist/app.css
dist/app.meta.json
```

`bb plugin types --check`

```text
This plugin uses the npm package @get-bb/plugin-sdk; pin is 0.4.34, host is 0.4.34.
```

Live check:

```text
bb plugin install . --yes
Installed:
humanlayer@0.1.0  running

bb plugin reload humanlayer
humanlayer@0.1.0  running
```

Created freeform task `20b5cb36-2f44-457d-b47b-e673940ff9f1`, thread `thr_vwghqa93bm`, using provider `codex` and model `gpt-5.4-mini`.

The launched agent created `01-notes-live-comments.md` with three markdown paragraphs and saved it through `hl_artifact_save`; artifact version 1 was visible through:

```text
bb humanlayer artifacts list --task 20b5cb36-2f44-457d-b47b-e673940ff9f1 --json
```

Added two comments through CLI:

```text
bb humanlayer comments create --task 20b5cb36-2f44-457d-b47b-e673940ff9f1 --file 01-notes-live-comments.md --block 0 --content "Please tighten the opening statement." --json
bb humanlayer comments create --task 20b5cb36-2f44-457d-b47b-e673940ff9f1 --file 01-notes-live-comments.md --block 1 --content "Please mark this paragraph as verified after review." --json
```

Steered the agent:

```text
bb thread tell thr_vwghqa93bm "Call hl_get_artifact_comments on 01-notes-live-comments.md, reply to the first comment with 'acknowledged', and resolve the second comment."
bb thread wait thr_vwghqa93bm --timeout 300
```

Verified through:

```text
bb humanlayer comments list --task 20b5cb36-2f44-457d-b47b-e673940ff9f1 --file 01-notes-live-comments.md --resolved --json
```

Observed:

- reply `0c0031fe-de35-4277-9e3f-bb1b44645227` with content `acknowledged`, `createdByAgent: true`, and `createdByThreadId: thr_vwghqa93bm`
- second root `29cbe737-a09b-4bc2-87db-4918f22e1844` had `isResolved: true`

Saved version 2 with one inserted paragraph at the top. Re-running comments list showed:

- first root anchor moved from block 0 to block 1 with `orphaned: false`
- second root anchor moved from block 1 to block 2 with `orphaned: false`
- artifact unresolved root `commentCount` was 1

Cleanup:

```text
bb thread archive thr_vwghqa93bm
Thread thr_vwghqa93bm archived

bb plugin remove humanlayer
Removed humanlayer.

bb plugin list
```

`humanlayer` was absent after removal.

## Deviations

- Fable §9 proposed no fuzzy matching. The phase request and Astra acceptance criteria required a simple fuzzy fallback, so `reanchor` includes normalized whitespace token-ratio matching at `>= 0.8`.
- CLI `comments list --resolved` needed a shared parser update for bare boolean flags; fixed during live verification and covered by the final `npm test`.

## Open Items

- UI behavior was typechecked and bundled, but not screenshot-tested in a browser session.
- Diff comments remain out of scope for this phase.

## Review fixes

Fixed all eleven Phase 4 review findings.

- Reworked re-anchor precedence: exact block plus full context, unique exact block, exact duplicates with one-sided context or a narrow old-index fallback, then fuzzy only with a single high-confidence candidate and clear runner-up margin.
- Built comment XML from artifact-wide id prefixes, stripped XML-invalid code points, accounted for the full envelope in byte budgets, paginated by root comments without skipping omitted threads, and marked single oversized threads with `truncated="true"` plus an offset hint.
- Changed send-to-session to use exactly the requested root ids, exclude resolved roots unless explicitly included, split oversized selections into ordered messages, reject single-thread oversize before sending, persist `send_receipts(request_id)`, and resolve only roots delivered through a successful send.
- Added restore support for `deleted:false`, root-only resolve and unresolve failures for replies, server validation for artifact version ownership, reply roots, anchor block range, user edit ownership, and typed `hl:comments` realtime event kinds.
- Moved markdown block segmentation into `blocks.ts` for both backend and UI use; the rail now uses paginated comment loading, load-more, pending send disablement, and anchor refetches on artifact version signals.

Verification:

```text
npm test
tests 60
pass 60
fail 0

npx tsc --noEmit
passed with no output

bb plugin build
dist/server.js
dist/server.js.map
dist/server.meta.json
dist/app.js
dist/app.css
dist/app.meta.json
```

Live check:

```text
bb plugin install . --yes
humanlayer@0.1.0 running

bb plugin reload humanlayer
humanlayer@0.1.0 running
```

Created task `d11e5bf8-53c0-469a-be3e-4b731517220d`, thread `thr_ht5xfu65ny`, and artifact `live-comments.md`. Sent two selected root comments through live RPC:

```text
{"ok":true,"result":{"sent":2}}
```

Then `bb humanlayer comments list --resolved --json` showed roots `2fba98f4` and `6630b9f1` resolved, while root `cc15f804` remained unresolved.

For the east/west re-anchor check, `live-reanchor.md` was changed from the original exact block to two similar blocks, `wind changed east marker` and `wind changed west marker`. Listing comments showed comment `cffd2962` with `anchor.orphaned: true`.

Cleanup:

```text
bb thread stop thr_ht5xfu65ny
bb thread archive thr_ht5xfu65ny
bb plugin remove humanlayer
```

## Review fixes round 2

Astra item status:

1. Fixed: exact block re-anchor still prefers full context, then unique exact block.
2. Fixed in round 2: `Alpha / Beta old / Gamma` now reattaches to `Beta new` by unique previous and next context and sets `anchor.rewritten=true`.
3. Fixed: east/west ambiguous similar text remains orphaned when context is absent or non-unique.
4. Fixed: truncated id resolution rejects ambiguous prefixes and accepts the shortest unique prefix.
5. Fixed: agent XML escapes comment content, block text, and invalid XML code points.
6. Fixed in round 2: bounded XML now stays within the 40,000 byte cap for huge single threads and many small roots, truncates single oversized roots, caps replies with `replies_omitted`, and avoids empty trailing fetches.
7. Fixed: send-to-session uses exactly the selected root ids and does not drop requested roots while splitting messages.
8. Fixed in round 2: request id is the receipt primary key, inserted as pending before send; concurrent repeats return pending, delivered chunk indexes are recorded, retries resume from the first undelivered chunk, and receipts are swept after 30 days by the existing 60s background service.
9. Fixed: `send-and-resolve` resolves only roots that were delivered by a successful `threads.send`.
10. Fixed: RPC/server validation covers artifact version ownership, reply roots, root-only resolve, deleted restore behavior, agent edit ownership, and typed realtime comment event kinds.
11. Fixed in round 2: the rail sends at most the first 100 loaded unresolved roots, labels `Send first 100 of N` or `Sending first 100 of N`, and the RPC schema keeps the 100-comment cap.

Verification:

```text
npm test
tests 64
pass 64
fail 0

npx tsc --noEmit
TypeScript: No errors found

bb plugin build
dist/server.js
dist/server.js.map
dist/server.meta.json
dist/app.js
dist/app.css
dist/app.meta.json
```
