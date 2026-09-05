import test from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { createFakePluginHost, makeThreadResponse } from "@get-bb/plugin-sdk/testing";
import plugin from "../server";
import { MIGRATIONS, parseJson } from "../db";
import { createDraftTask } from "../tasks";
import {
  applyStatusDerivation,
  createLaunchBindingMirror,
  deriveStatus,
  loadSessionMirror,
  mirrorSession,
  recordIdleCompletion,
  registerSessionRuntime,
  taskInstructions,
} from "../sessions";
import { TASK_CONTEXT_FIRST_ACTION } from "../instructions";

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

function delay(ms = 0) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function makeRuntimeBb(overrides: {
  get?: (input: { threadId: string }) => Promise<ReturnType<typeof makeThreadResponse>>;
  interactions?: (input: { threadId: string }) => Promise<unknown[]>;
  events?: (input: { threadId: string }) => Promise<unknown[]>;
} = {}) {
  const handlers = new Map<string, (payload: never) => void>();
  return {
    bb: {
      pluginId: "humanlayer",
      log: { warn: () => undefined, info: () => undefined },
      realtime: { publish: () => undefined },
      sdk: {
        subscribe: () => () => undefined,
        threads: {
          get: overrides.get ?? (async () => makeThreadResponse({ id: "thr_1", status: "idle", runtime: { displayStatus: "idle", hostReconnectGraceExpiresAt: null } })),
          interactions: { list: overrides.interactions ?? (async () => []) },
          events: { list: overrides.events ?? (async () => []) },
        },
      },
      events: {
        on: (name: string, handler: (payload: never) => void) => {
          handlers.set(name, handler);
        },
      },
      experimental_hooks: { on: () => undefined },
      onDispose: () => undefined,
    },
    handlers,
  };
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

test("contributed task instructions start with task context first-action line", () => {
  const text = taskInstructions({
    threadId: "thr_1",
    taskId: "task_1",
    taskName: "Task",
    taskSlug: "task",
    label: null,
    skillId: null,
    workflowType: "freeform",
    hydratedAt: null,
  } as never);
  assert.equal(text.split("\n")[0], TASK_CONTEXT_FIRST_ACTION);
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

test("runtime reconciliation sequence starts after persisted rows on reload", async () => {
  const db = makeDb();
  seedSession(db);
  db.prepare("UPDATE sessions SET last_reconcile_seq = 40 WHERE thread_id = ?").run("thr_1");
  const mirror = loadSessionMirror(db);
  const { bb } = makeRuntimeBb({
    get: async () => makeThreadResponse({ id: "thr_1", status: "idle", runtime: { displayStatus: "idle", hostReconnectGraceExpiresAt: null } }),
  });
  registerSessionRuntime(bb as never, db, mirror, createLaunchBindingMirror());
  for (let i = 0; i < 10; i += 1) {
    await delay();
    const stored = db.prepare("SELECT last_reconcile_seq AS seq FROM sessions WHERE thread_id = ?").get("thr_1") as { seq: number };
    if (stored.seq === 41) break;
  }
  const stored = db.prepare("SELECT hl_status, last_reconcile_seq FROM sessions WHERE thread_id = ?").get("thr_1") as { hl_status: string; last_reconcile_seq: number };
  assert.equal(stored.hl_status, "ready_for_input");
  assert.equal(stored.last_reconcile_seq, 41);
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

test("buffered idle replay preserves completion order", async () => {
  const db = makeDb();
  const mirror = new Map();
  seedSession(db);
  const bindings = createLaunchBindingMirror();
  let eventCalls = 0;
  const { bb } = makeRuntimeBb({
    events: async () => {
      eventCalls += 1;
      if (eventCalls === 1) await delay(20);
      return [];
    },
  });
  registerSessionRuntime(bb as never, db, mirror, bindings);
  mirrorSession(db, mirror, "thr_1");
  bindings.bufferedByThread.set("thr_1", [
    { kind: "idle", thread: thread({ numEvents: 1, updatedAt: 1 }), lastAssistantText: "first" },
    { kind: "idle", thread: thread({ numEvents: 2, updatedAt: 2 }), lastAssistantText: "second" },
  ]);
  await bindings.onBound?.("thr_1");
  const stored = db.prepare("SELECT completed_turn_key, summary_json FROM sessions WHERE thread_id = ?").get("thr_1") as { completed_turn_key: string | null; summary_json: string | null };
  assert.equal(stored.completed_turn_key, "2:2");
  assert.deepEqual(parseJson<{ summaryHistory?: string[] }>(stored.summary_json, {}).summaryHistory, ["first", "second"]);
  db.close();
});

test("interrupted idle skips summary and completed turn key", async () => {
  const db = makeDb();
  const mirror = new Map();
  seedSession(db);
  const bindings = createLaunchBindingMirror();
  const { bb } = makeRuntimeBb({
    events: async () => [{ type: "system/thread/interrupted" }],
  });
  registerSessionRuntime(bb as never, db, mirror, bindings);
  mirrorSession(db, mirror, "thr_1");
  bindings.bufferedByThread.set("thr_1", [
    { kind: "idle", thread: thread({ numEvents: 1, updatedAt: 1 }), lastAssistantText: "done" },
  ]);
  await bindings.onBound?.("thr_1");
  const stored = db.prepare("SELECT interrupted, completed_turn_key, summary_json FROM sessions WHERE thread_id = ?").get("thr_1") as { interrupted: number; completed_turn_key: string | null; summary_json: string | null };
  assert.equal(stored.interrupted, 1);
  assert.equal(stored.completed_turn_key, null);
  assert.equal(parseJson<{ summaryHistory?: string[] }>(stored.summary_json, {}).summaryHistory?.length ?? 0, 0);
  db.close();
});

test("thread archive evicts runtime mirror without deleting the session row", async () => {
  const db = makeDb();
  seedSession(db);
  const mirror = loadSessionMirror(db);
  let releaseGet = () => {};
  const getStarted = new Promise<void>((resolve) => {
    releaseGet = resolve;
  });
  const { bb, handlers } = makeRuntimeBb({
    get: async () => {
      await getStarted;
      return makeThreadResponse({ id: "thr_1", status: "idle", runtime: { displayStatus: "idle", hostReconnectGraceExpiresAt: null } });
    },
  });
  registerSessionRuntime(bb as never, db, mirror, createLaunchBindingMirror());
  handlers.get("thread.archived")?.({ thread: makeThreadResponse({ id: "thr_1" }) } as never);
  releaseGet();
  await delay();
  assert.equal(mirror.has("thr_1"), false);
  const count = db.prepare("SELECT COUNT(*) AS count FROM sessions WHERE thread_id = ?").get("thr_1") as { count: number };
  assert.equal(count.count, 1);
  db.close();
});

test("thread delete evicts runtime mirror without deleting the session row", () => {
  const db = makeDb();
  const mirror = new Map();
  seedSession(db);
  const { bb, handlers } = makeRuntimeBb();
  registerSessionRuntime(bb as never, db, mirror, createLaunchBindingMirror());
  mirrorSession(db, mirror, "thr_1");
  handlers.get("thread.deleted")?.({ thread: makeThreadResponse({ id: "thr_1" }) } as never);
  assert.equal(mirror.has("thr_1"), false);
  const count = db.prepare("SELECT COUNT(*) AS count FROM sessions WHERE thread_id = ?").get("thr_1") as { count: number };
  assert.equal(count.count, 1);
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
