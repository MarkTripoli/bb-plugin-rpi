import test from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { createFakePluginHost, makeThreadResponse } from "@get-bb/plugin-sdk/testing";
import plugin from "../server";
import { MIGRATIONS, parseJson } from "../db";
import { createDraftTask } from "../tasks";
import { applyStatusDerivation, deriveStatus, recordIdleCompletion } from "../sessions";

const row = { hadTurn: false, interrupted: false };

function thread(overrides: Partial<Parameters<typeof deriveStatus>[0]>): Parameters<typeof deriveStatus>[0] {
  return {
    id: "thr_1",
    status: "idle",
    runtime: { displayStatus: "idle" },
    ...overrides,
  };
}

function interaction(kind: string) {
  return [{ status: "pending", payload: { kind }, resolution: null }];
}

function makeDb() {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  for (const statement of MIGRATIONS) db.exec(statement);
  return db;
}

function seedSession(db: Database.Database, threadId = "thr_1") {
  const task = createDraftTask(db, {
    projectId: "proj_1",
    prompt: "prompt",
    name: "Task",
    workflowType: "freeform",
    worktreeTiming: "never",
    permissionMode: "default",
    autoAdvance: false,
    providerId: null,
    model: null,
    reasoningLevel: null,
    serviceTier: null,
  });
  db.prepare(`
    INSERT INTO sessions (
      thread_id, task_id, label, skill_id, launched_by, forked_from_thread_id,
      hl_status, hl_status_at, had_turn, interrupted, blocked_reason, created_at, updated_at
    ) VALUES (?, ?, NULL, NULL, 'user', NULL, 'running', 1, 1, 0, NULL, 1, 1)
  `).run(threadId, task.taskId);
}

test("deriveStatus covers Fable 5.1 rows in order", () => {
  assert.equal(deriveStatus(thread({ status: "active", runtime: { displayStatus: "waiting-for-host" } }), [], row).hlStatus, "lost");
  assert.equal(deriveStatus(thread({ status: "active", runtime: { displayStatus: "provisioning" } }), [], row).hlStatus, "waiting_for_workspace");
  assert.equal(deriveStatus(thread({ status: "active", environment: { status: "provisioning" } }), [], row).hlStatus, "waiting_for_workspace");
  assert.equal(deriveStatus(thread({ status: "pending", runtime: { displayStatus: "pending" } }), [], row).hlStatus, "ready_for_launch");
  assert.equal(deriveStatus(thread({ status: "starting", runtime: { displayStatus: "starting" } }), [], row).hlStatus, "launching");
  assert.equal(deriveStatus(thread({ status: "starting", runtime: { displayStatus: "starting" } }), [], { ...row, hadTurn: true }).hlStatus, "resuming");
  assert.equal(deriveStatus(thread({ status: "active", runtime: { displayStatus: "active" } }), interaction("approval"), row).hlStatus, "needs_approval");
  assert.equal(deriveStatus(thread({ status: "active", runtime: { displayStatus: "active" } }), interaction("user_question"), row).hlStatus, "ready_for_input");
  assert.equal(deriveStatus(thread({ status: "active", runtime: { displayStatus: "active" } }), interaction("plugin"), row).hlStatus, "ready_for_input");
  assert.equal(deriveStatus(thread({ status: "active", runtime: { displayStatus: "active" } }), [], row).hlStatus, "running");
  assert.equal(deriveStatus(thread({ status: "stopping", runtime: { displayStatus: "stopping" } }), [], row).hlStatus, "interrupt_requested");
  assert.equal(deriveStatus(thread({ status: "error", runtime: { displayStatus: "error" } }), [], row).hlStatus, "failed");
  assert.equal(deriveStatus(thread({ status: "idle", runtime: { displayStatus: "idle" } }), [], { ...row, interrupted: true }).hlStatus, "interrupted");
  assert.equal(deriveStatus(thread({ status: "idle", runtime: { displayStatus: "idle" } }), [], row).hlStatus, "ready_for_input");
});

test("lost is only derived from runtime displayStatus evidence", () => {
  assert.equal(deriveStatus(thread({ status: "active", runtime: { displayStatus: "active" } }), [], row).hlStatus, "running");
  assert.equal(deriveStatus(thread({ status: "error", runtime: { displayStatus: "error" } }), [], row).hlStatus, "failed");
  assert.equal(deriveStatus(thread({ status: "active", runtime: { displayStatus: "host-reconnecting" } }), [], row).hlStatus, "lost");
});

test("user_question stores blocked reason for executor skip", () => {
  const derived = deriveStatus(thread({ status: "idle", runtime: { displayStatus: "idle" } }), interaction("user_question"), row);
  assert.equal(derived.hlStatus, "ready_for_input");
  assert.equal(derived.blockedReason, "question");
});

test("interaction status precedence keeps terminal states", () => {
  assert.equal(deriveStatus(thread({ status: "error", runtime: { displayStatus: "error" } }), interaction("approval"), row).hlStatus, "failed");
  assert.equal(deriveStatus(thread({ status: "stopping", runtime: { displayStatus: "stopping" } }), interaction("approval"), row).hlStatus, "interrupt_requested");
  assert.equal(deriveStatus(thread({ status: "idle", runtime: { displayStatus: "idle" } }), interaction("approval"), row).hlStatus, "ready_for_input");
  const questionWithError = deriveStatus(thread({ status: "error", runtime: { displayStatus: "error" } }), interaction("user_question"), row);
  assert.equal(questionWithError.hlStatus, "failed");
  assert.equal(questionWithError.blockedReason, "question");
});

test("older reconciliation snapshots cannot regress a newer status", () => {
  const db = makeDb();
  const mirror = new Map();
  seedSession(db);
  applyStatusDerivation(db, mirror, thread({ status: "idle", runtime: { displayStatus: "idle" } }), [], 2);
  applyStatusDerivation(db, mirror, thread({ status: "active", runtime: { displayStatus: "active" } }), [], 1);
  const row = db.prepare("SELECT hl_status, last_reconcile_seq FROM sessions WHERE thread_id = ?").get("thr_1") as { hl_status: string; last_reconcile_seq: number };
  assert.equal(row.hl_status, "ready_for_input");
  assert.equal(row.last_reconcile_seq, 2);
  db.close();
});

test("idle with pending blocker records blocked reason and skips summary", async () => {
  const db = makeDb();
  const mirror = new Map();
  seedSession(db);
  const bb = {
    sdk: {
      threads: {
        interactions: { list: async () => interaction("user_question") },
      },
    },
  };
  await recordIdleCompletion(bb as never, db, mirror, thread({ updatedAt: 2 }), "done");
  const stored = db.prepare("SELECT blocked_reason, summary_json FROM sessions WHERE thread_id = ?").get("thr_1") as { blocked_reason: string | null; summary_json: string | null };
  assert.equal(stored.blocked_reason, "question");
  assert.equal(parseJson<{ summaryHistory?: string[] }>(stored.summary_json, {}).summaryHistory?.length ?? 0, 0);
  db.close();
});

test("idle summary deduplicates by completed turn key", async () => {
  const db = makeDb();
  const mirror = new Map();
  seedSession(db);
  const bb = {
    sdk: {
      threads: {
        interactions: { list: async () => [] },
      },
    },
  };
  const idleThread = thread({ updatedAt: 2 });
  await recordIdleCompletion(bb as never, db, mirror, idleThread, "done");
  await recordIdleCompletion(bb as never, db, mirror, idleThread, "done again");
  const stored = db.prepare("SELECT completed_turn_key, summary_json FROM sessions WHERE thread_id = ?").get("thr_1") as { completed_turn_key: string | null; summary_json: string | null };
  const summary = parseJson<{ summaryHistory?: string[] }>(stored.summary_json, {});
  assert.equal(stored.completed_turn_key, "events:2");
  assert.deepEqual(summary.summaryHistory, ["done"]);
  db.close();
});

test("agent callbacks return non-Promise values", async () => {
  const { bb, harness } = createFakePluginHost({
    pluginId: "humanlayer",
    sdk: { subscribe: () => () => undefined },
  });
  await plugin(bb);
  const configure = harness.inspection.registrations.agentConfigurationProvider;
  const instructions = harness.inspection.registrations.instructionProvider;
  assert.ok(configure);
  assert.ok(instructions);
  const configResult = configure({
    thread: { id: "thr_none", title: null, parentThreadId: null, sourceThreadId: null },
    project: { id: "proj_1", kind: "standard", name: "Project", gitRemoteUrl: null },
    environment: { id: "env_1", name: null, path: null, workspaceProvisionType: "unmanaged", branchName: null },
    host: { id: "host_1", name: "Host" },
    provider: { id: "codex", model: "gpt-5.4-mini", capabilities: { supportsNativeUserQuestion: true } },
    origin: { kind: null, pluginId: null },
  });
  const instructionResult = instructions({ threadId: "thr_none", projectId: "proj_1" });
  assert.equal(typeof (configResult as unknown as Promise<unknown>).then, "undefined");
  assert.equal(typeof (instructionResult as unknown as Promise<unknown> | null)?.then, "undefined");
  await harness.lifecycle.dispose();
});

test("launch marker binds dispatch before spawn returns", async () => {
  let resolveSpawn: (thread: ReturnType<typeof makeThreadResponse>) => void = () => undefined;
  const spawnWait = new Promise<ReturnType<typeof makeThreadResponse>>((resolve) => {
    resolveSpawn = resolve;
  });
  const threadResponse = makeThreadResponse({
    id: "thr_spawned",
    projectId: "proj_1",
    originPluginId: "humanlayer",
    status: "pending",
    runtime: { displayStatus: "pending", hostReconnectGraceExpiresAt: null },
  });
  const { bb, harness } = createFakePluginHost({
    pluginId: "humanlayer",
    sdk: {
      subscribe: () => () => undefined,
      threads: {
        spawn: async () => spawnWait,
        get: async () => ({ ...threadResponse, environment: { id: "env_1", path: "/tmp/repo", status: "ready" }, environmentId: "env_1" }),
      },
    },
  });
  await plugin(bb);
  const created = await harness.behavior.callRpc("createTask", {
    request: { text: "prompt", projectId: "proj_1", workflowType: "freeform", worktreeTiming: "never", permissionMode: "default", autoAdvance: false },
    name: "Task",
    draft: true,
  }) as { taskId: string };
  const launchPromise = harness.behavior.callRpc("launchDraft", { taskId: created.taskId });
  await new Promise((resolve) => setImmediate(resolve));
  const spawnCall = harness.inspection.sdk.callsTo("threads.spawn")[0];
  const prompt = (spawnCall?.[0] as { prompt: string }).prompt;
  const hook = harness.inspection.registrations.hooks["message.dispatch"];
  assert.ok(hook);
  const decision = await hook({
    thread: threadResponse,
    project: { id: "proj_1" },
    environment: null,
    host: null,
    input: { text: prompt, blocks: [] },
    requestedExecution: { providerId: "codex", model: null, reasoningLevel: null, serviceTier: null, permissionMode: null },
    executionSources: { providerId: null, model: null, reasoningLevel: null, serviceTier: null, permissionMode: null },
    attempt: "start-turn",
    queuedMessage: null,
    origin: null,
    originPluginId: "humanlayer",
    startedOnBehalfOf: null,
    parentThreadId: null,
  } as never);
  assert.deepEqual(decision, { action: "proceed" });
  const instructions = harness.inspection.registrations.instructionProvider?.({ threadId: "thr_spawned", projectId: "proj_1" });
  assert.match(instructions ?? "", /HumanLayer task: Task/);
  resolveSpawn(threadResponse);
  await launchPromise;
  await harness.lifecycle.dispose();
});
