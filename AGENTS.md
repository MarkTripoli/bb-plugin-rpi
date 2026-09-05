# bb-plugin-rpi: agent conventions

This repo is a bb plugin implementing a task/session/artifact/workflow system inside bb: tasks
move through phase skills (research, design, plan, implementation, ...), each phase runs in a
fresh session hydrated from a persisted artifact manifest, and session status is derived from bb
state rather than tracked separately.

## Read first, every time
1. `~/PersonalDevelopment/bb-plugin-rpi-reference/design-record/research/`, merged plan doc: the plan. Your phase is one row of section 3. Sections 1.1 and 2 are binding decisions.
2. Same directory, spike-results doc: verified SDK behavior. Do not re-verify; do not contradict.
3. Same directory, research-ground-truth doc: ground truth for the reference workflow's behavior (statuses, tables, notification rules, naming).
4. Plan details referenced as "per Fable §N" or "per Astra §N" live in the design-record's `03-*.md` and `02-*.md`.
5. bb Plugin SDK: `ls ~/.bb/runtime/global-skills/*/skills/bb-plugin-authoring/` (SKILL.md + references/). Exact types: `node_modules/@get-bb/plugin-sdk/bundled-types`. Run `bb plugin types --check` if in doubt.
6. `RPI_REFERENCE_DIR` (default `~/PersonalDevelopment/bb-plugin-rpi-reference/third-party`) holds third-party original skills/agents/hooks material. **Reference only. Never copy text from it into `skills/`** (All Rights Reserved). Rewrite in your own words; preserve structure, rules, and template shape. `tests/skills.test.ts`'s shingle test enforces this whenever that directory is present.

## Hard rules
- `bb.agents.contributeInstructions` and `bb.agents.configure` callbacks are **synchronous**. No `async`, no `await`, no Promise return. Read from an in-memory mirror kept current by event handlers. An async callback silently breaks provisioning for every thread on the bb instance.
- After a `managed-worktree` spawn, read `environmentId` via `threads.get({threadId, include:"environment"})`, not from the spawn response.
- `projectId` is required on every `threads.spawn`, including `environment:{type:"reuse"}`.
- Session status is **derived** from bb state (plan §1, Fable §5.1), never set by the plugin.
- Every `bb.sdk.files.write` into a task dir passes `rootPath` and a CAS `expectedSha256`.
- Migrations (`bb.storage.migrate`) are append-only from the first tagged release. Before that release, a shipped statement may be edited in place only alongside a schema-version guard that resets any stale local dev database it would otherwise silently corrupt (see `db.ts` `needsPreRenameReset`); after the first tagged release, never edit a shipped statement again, only push new ones.
- Pure logic lives in pure modules (`transitions.ts`, `extraction.ts`, `notify.ts` decisions, `sessions.ts` derive, `artifacts.ts` naming) with `node:test` coverage. `server.ts` is wiring only.
- Frontend: host token classes only (`bg-card`, `text-muted-foreground`, `border-border`...). No hardcoded colors. `toast` from `sonner`. Vendored shadcn under `components/ui`.
- RPC: `defineRpcContract` with strict zod input/output. Frontend imports the contract **type-only** from `./contract`.
- Return bounded output from tools and CLI. Treat frontend params and persisted values as untrusted.
- Dispose everything you register (`bb.onDispose`, service signals, subscriptions).
- No em dashes in prose or UI copy.

## Workflow per phase
- Work in your assigned worktree branch. Commit in small, described commits. Do not touch other phases' files unless the plan row says so.
- `npm test` (node:test) and `bb plugin build` must pass before you report done. Install live only when the plan row's reviewer checks need it: `bb plugin install .` (path install) then `bb plugin reload rpi`.
- Finish by writing `docs/phases/NN-<phase>.md`: what shipped, how it was verified (commands + output excerpts), deviations from the plan and why, open items for the reviewer checklist in the plan row.
- End your final reply with the path of that file only.

## Names
Plugin id `rpi`. Tools prefixed `rpi_`. Skills named `rpi-<skill>` (invoked `/rpi-create-research`). CLI `bb rpi`. Task artifact dir `.rpi/tasks/<slug>/` relative to the workspace root (`constants.ts` `TASK_ROOT_DIR`).
