# bb-plugin-humanlayer: agent conventions

This repo is a bb plugin that replicates HumanLayer's task/session/artifact/workflow system inside bb.

## Read first, every time
1. `docs/research/04-plan-merged-humanlayer-bb-plugin.md`: the plan. Your phase is one row of section 3. Sections 1.1 and 2 are binding decisions.
2. `docs/research/05-spike-results.md`: verified SDK behavior. Do not re-verify; do not contradict.
3. `docs/research/01-research-humanlayer-system.md`: ground truth for HL behavior (statuses, tables, notification rules, naming).
4. Plan details referenced as "per Fable §N" or "per Astra §N" live in `docs/research/03-*.md` and `docs/research/02-*.md`.
5. bb Plugin SDK: `ls ~/.bb/runtime/global-skills/*/skills/bb-plugin-authoring/` (SKILL.md + references/). Exact types: `node_modules/@get-bb/plugin-sdk/bundled-types`. Run `bb plugin types --check` if in doubt.
6. `docs/hl-reference/` holds HumanLayer's original skills/agents/hooks. **Reference only. Never copy text from them into `skills/`** (All Rights Reserved). Rewrite in your own words; preserve structure, rules, and template shape.

## Hard rules
- `bb.agents.contributeInstructions` and `bb.agents.configure` callbacks are **synchronous**. No `async`, no `await`, no Promise return. Read from an in-memory mirror kept current by event handlers. An async callback silently breaks provisioning for every thread on the bb instance.
- After a `managed-worktree` spawn, read `environmentId` via `threads.get({threadId, include:"environment"})`, not from the spawn response.
- `projectId` is required on every `threads.spawn`, including `environment:{type:"reuse"}`.
- HL status is **derived** from bb state (plan §1, Fable §5.1), never set by the plugin.
- Every `bb.sdk.files.write` into a task dir passes `rootPath` and a CAS `expectedSha256`.
- Migrations (`bb.storage.migrate`) are append-only. Never edit a shipped statement.
- Pure logic lives in pure modules (`transitions.ts`, `extraction.ts`, `notify.ts` decisions, `sessions.ts` derive, `artifacts.ts` naming) with `node:test` coverage. `server.ts` is wiring only.
- Frontend: host token classes only (`bg-card`, `text-muted-foreground`, `border-border`...). No hardcoded colors. `toast` from `sonner`. Vendored shadcn under `components/ui`.
- RPC: `defineRpcContract` with strict zod input/output. Frontend imports the contract **type-only** from `./contract`.
- Return bounded output from tools and CLI. Treat frontend params and persisted values as untrusted.
- Dispose everything you register (`bb.onDispose`, service signals, subscriptions).
- No em dashes in prose or UI copy.

## Workflow per phase
- Work in your assigned worktree branch. Commit in small, described commits. Do not touch other phases' files unless the plan row says so.
- `npm test` (node:test) and `bb plugin build` must pass before you report done. Install live only when the plan row's reviewer checks need it: `bb plugin install .` (path install) then `bb plugin reload humanlayer`.
- Finish by writing `docs/phases/NN-<phase>.md`: what shipped, how it was verified (commands + output excerpts), deviations from the plan and why, open items for the reviewer checklist in the plan row.
- End your final reply with the path of that file only.

## Names
Plugin id `humanlayer`. Tools prefixed `hl_`. Skills named `rpi-<skill>` (invoked `/rpi-create-research`). CLI `bb humanlayer`. Task artifact dir `.humanlayer/tasks/<slug>/` relative to the workspace root.
