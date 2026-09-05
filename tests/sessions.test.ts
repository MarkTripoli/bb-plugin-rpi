import test from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { createFakePluginHost, makeThreadResponse } from "@get-bb/plugin-sdk/testing";
import plugin from "../server";
import { MIGRATIONS, parseJson } from "../db";
import { createDraftTask } from "../tasks";
import {
  onCompletedTurn,
  proceed,
} from "../advance";
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

test("hl_status_at only advances when derived status actually changes", () => {
  const db = makeDb();
  const mirror = new Map();
  seedSession(db);
  applyStatusDerivation(db, mirror, thread({ status: "idle", runtime: { displayStatus: "idle" } }), [], 1);
  db.prepare("UPDATE sessions SET hl_status_at = 12345 WHERE thread_id = 'thr_1'").run();
  // Same derived status (ready_for_input) on a later sequence: last_reconcile_seq advances, hl_status_at must not.
  applyStatusDerivation(db, mirror, thread({ status: "idle", runtime: { displayStatus: "idle" } }), [], 2);
  const second = db.prepare("SELECT hl_status_at AS hlStatusAt, last_reconcile_seq AS seq FROM sessions WHERE thread_id = ?").get("thr_1") as { hlStatusAt: number; seq: number };
  assert.equal(second.seq, 2);
  assert.equal(second.hlStatusAt, 12345);
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
        get: async () => ({ environment: null }),
      },
    },
    log: { info: () => undefined },
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

test("idle completion stores next step and relevant RPI documents", async () => {
  const db = makeDb();
  const mirror = new Map();
  seedSession(db);
  db.prepare("UPDATE tasks SET slug = 'task' WHERE id = (SELECT task_id FROM sessions WHERE thread_id = 'thr_1')").run();
  const taskId = (db.prepare("SELECT task_id AS taskId FROM sessions WHERE thread_id = 'thr_1'").get() as { taskId: string }).taskId;
  db.prepare(`
    INSERT INTO artifacts (
      id, task_id, file_name, frontmatter_json, content_type, is_deleted,
      current_version, created_at, updated_at
    ) VALUES ('artifact_1', ?, '01-research.md', '{}', 'text/markdown', 0, 1, 1, 1)
  `).run(taskId);
  mirrorSession(db, mirror, "thr_1");
  const bb = { sdk: { threads: { interactions: { list: async () => [] }, get: async () => ({ environment: null }) } }, log: { info: () => undefined } };
  await recordIdleCompletion(
    bb as never,
    db,
    mirror,
    thread({ updatedAt: 2 }),
    "Wrote .humanlayer/tasks/task/01-research.md\n```text\n/rpi-create-design-discussion @01-research.md\n```",
  );
  const stored = db.prepare("SELECT next_step_json, summary_json FROM sessions WHERE thread_id = ?").get("thr_1") as { next_step_json: string; summary_json: string };
  const next = parseJson<{ extraction?: { type?: string; nextStepType?: string; nextStepPrompt?: string } }>(stored.next_step_json, {});
  assert.equal(next.extraction?.type, "next_step_found");
  assert.equal(next.extraction?.nextStepType, "create-design-discussion");
  assert.equal(next.extraction?.nextStepPrompt, "/rpi-create-design-discussion @01-research.md");
  const summary = parseJson<{ relevantRPIDocuments?: Array<{ localpath: string }> }>(stored.summary_json, {});
  assert.deepEqual(summary.relevantRPIDocuments, [{ localpath: ".humanlayer/tasks/task/01-research.md", permalink: `::hl-artifact{task="${taskId}" file="01-research.md"}` }]);
  db.close();
});

test("system-injected initiating messages append summary without overwriting an existing next step", async () => {
  const db = makeDb();
  const mirror = new Map();
  seedSession(db);
  const priorNext = JSON.stringify({ parsedAt: 1, extraction: { type: "next_step_found", nextStepPrompt: "/rpi-create-research", nextStepSummary: "next", nextStepType: "create-research", taskReference: null, suggestedDirectory: null } });
  db.prepare("UPDATE sessions SET label = 'research-questions', hl_status = 'ready_for_input', next_step_json = ?, next_step_turn_key = 'turn_old', completed_turn_key = 'turn_old', last_summarized_turn_key = 'turn_old' WHERE thread_id = 'thr_1'").run(priorNext);
  mirrorSession(db, mirror, "thr_1");
  let spawns = 0;
  const bb = {
    pluginId: "humanlayer",
    realtime: { publish: () => undefined },
    log: { warn: () => undefined },
    sdk: {
      threads: {
        interactions: { list: async () => [] },
        spawn: async () => {
          spawns += 1;
          return makeThreadResponse({ id: "thr_next", environmentId: "env_1", projectId: "proj_1", originPluginId: "humanlayer" });
        },
        get: async ({ threadId }: { threadId: string }) => makeThreadResponse({ id: threadId, environmentId: "env_1", projectId: "proj_1", originPluginId: "humanlayer" }),
        timeline: async () => ({
          rows: [
            { kind: "conversation", role: "user", text: "child finished", turnId: "turn_new", sourceSeqStart: 10, senderThreadId: "thr_child", systemMessageKind: "child-completed" },
            { kind: "conversation", role: "assistant", text: "noted", turnId: "turn_new", sourceSeqStart: 11 },
          ],
        }),
      },
    },
  };
  await recordIdleCompletion(bb as never, db, mirror, thread({ updatedAt: 2 }), "noted");
  const stored = db.prepare("SELECT completed_turn_key, next_step_turn_key, next_step_json, summary_json FROM sessions WHERE thread_id = ?").get("thr_1") as { completed_turn_key: string | null; next_step_turn_key: string | null; next_step_json: string | null; summary_json: string | null };
  assert.equal(stored.completed_turn_key, "turn_old");
  assert.equal(stored.next_step_turn_key, "turn_old");
  assert.equal(stored.next_step_json, priorNext);
  assert.deepEqual(parseJson<{ summaryHistory?: string[] }>(stored.summary_json, {}).summaryHistory, ["noted"]);
  const result = await proceed(bb as never, db, new Map(), createLaunchBindingMirror(), "thr_1");
  assert.deepEqual(result, { threadId: "thr_next" });
  assert.equal(spawns, 1);
  db.close();
});

test("unlabeled plugin-spawn messages still update next step extraction", async () => {
  const db = makeDb();
  const mirror = new Map();
  seedSession(db);
  mirrorSession(db, mirror, "thr_1");
  const text = "ready\n```text\n/rpi-create-research\n```";
  const bb = {
    sdk: {
      threads: {
        interactions: { list: async () => [] },
        get: async () => ({ environment: null }),
        timeline: async () => ({
          rows: [
            { kind: "conversation", role: "user", text: "start", turnId: "turn_new", sourceSeqStart: 1, senderThreadId: null, systemMessageKind: "unlabeled" },
            { kind: "conversation", role: "assistant", text, turnId: "turn_new", sourceSeqStart: 2 },
          ],
        }),
      },
    },
    log: { warn: () => undefined, info: () => undefined },
  };
  await recordIdleCompletion(bb as never, db, mirror, thread({ updatedAt: 2 }), text);
  const stored = db.prepare("SELECT next_step_turn_key, next_step_json FROM sessions WHERE thread_id = ?").get("thr_1") as { next_step_turn_key: string | null; next_step_json: string | null };
  assert.equal(stored.next_step_turn_key, "events:2");
  assert.equal(parseJson<{ extraction?: { type?: string; nextStepType?: string } }>(stored.next_step_json, {}).extraction?.nextStepType, "create-research");
  db.close();
});

test("ingest failure leaves the completed turn unrecorded for retry", async () => {
  const db = makeDb();
  const mirror = new Map();
  seedSession(db);
  mirrorSession(db, mirror, "thr_1");
  let failIngest = true;
  const warnings: string[] = [];
  const bb = {
    log: { warn: (message: string) => warnings.push(message), info: () => undefined },
    realtime: { publish: () => undefined },
    sdk: {
      threads: {
        interactions: { list: async () => [] },
        timeline: async () => ({ rows: [] }),
        get: async () => ({ environment: { path: "/repo", hostId: "host_1" } }),
      },
      files: {
        listPaths: async () => {
          if (failIngest) throw new Error("ingest failed");
          return [];
        },
      },
    },
  };
  const idleThread = thread({ updatedAt: 2 });
  await recordIdleCompletion(bb as never, db, mirror, idleThread, "done");
  let stored = db.prepare("SELECT completed_turn_key, ingest_error FROM sessions WHERE thread_id = ?").get("thr_1") as { completed_turn_key: string | null; ingest_error: string | null };
  assert.equal(stored.completed_turn_key, null);
  assert.equal(stored.ingest_error, "ingest failed");
  assert.match(warnings[0] ?? "", /ingest failed/);

  failIngest = false;
  await recordIdleCompletion(bb as never, db, mirror, idleThread, "done");
  stored = db.prepare("SELECT completed_turn_key, ingest_error FROM sessions WHERE thread_id = ?").get("thr_1") as { completed_turn_key: string | null; ingest_error: string | null };
  assert.equal(stored.completed_turn_key, "events:2");
  assert.equal(stored.ingest_error, null);
  db.close();
});

test("idle publishes ready signal after auto-advance suppression exists", async () => {
  const db = makeDb();
  const mirror = new Map();
  seedSession(db);
  const taskId = (db.prepare("SELECT task_id AS taskId FROM sessions WHERE thread_id = 'thr_1'").get() as { taskId: string }).taskId;
  db.prepare("UPDATE tasks SET workflow_type = 'rpi', auto_advance = 1, aa_questions_to_research = 1 WHERE id = ?").run(taskId);
  db.prepare("UPDATE sessions SET label = 'research-questions' WHERE thread_id = 'thr_1'").run();
  const text = "done\n```text\n/rpi-create-research\n```";
  const publishChecks: boolean[] = [];
  const { bb, handlers } = makeRuntimeBb({
    get: async ({ threadId }) => ({ ...makeThreadResponse({ id: threadId, status: "idle", updatedAt: 2, environmentId: "env_1", projectId: "proj_1", originPluginId: "humanlayer", runtime: { displayStatus: "idle", hostReconnectGraceExpiresAt: null } }), numEvents: 2 }),
    events: async () => [],
  });
  Object.assign(bb.realtime, {
    publish: (_topic: string, payload: { threadId?: string | null }) => {
      if (payload.threadId !== "thr_1") return;
      const row = db.prepare("SELECT 1 FROM notification_suppressions WHERE thread_id = 'thr_1' AND completed_turn_key = '2:2'").get();
      publishChecks.push(Boolean(row));
    },
  });
  Object.assign(bb.sdk.threads, {
    ...bb.sdk.threads,
    interactions: { list: async () => [] },
    timeline: async () => ({
      rows: [
        { kind: "conversation", role: "user", text: "start", turnId: "turn_1", sourceSeqStart: 1, senderThreadId: null, systemMessageKind: "unlabeled" },
        { kind: "conversation", role: "assistant", text, turnId: "turn_1", sourceSeqStart: 2 },
      ],
    }),
    spawn: async () => makeThreadResponse({ id: "thr_next", environmentId: "env_1", projectId: "proj_1", originPluginId: "humanlayer" }),
  });
  Object.assign(bb.sdk, { files: { listPaths: async () => [] } });
  registerSessionRuntime(bb as never, db, mirror, createLaunchBindingMirror(), (row) => onCompletedTurn(bb as never, db, mirror, createLaunchBindingMirror(), row));
  mirrorSession(db, mirror, "thr_1");
  handlers.get("thread.idle")?.({ thread: thread({ numEvents: 2, updatedAt: 2 }), lastAssistantText: text } as never);
  for (let i = 0; i < 10 && publishChecks.length === 0; i += 1) await delay();
  assert.deepEqual(publishChecks, [true]);
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

test("agent child skills require a task parent and survive reload", async () => {
  const { bb, harness } = createFakePluginHost({
    pluginId: "humanlayer",
    sdk: {
      subscribe: () => () => undefined,
      threads: {
        get: async ({ threadId }) => makeThreadResponse({
          id: threadId,
          parentThreadId: threadId === "thr_child" ? "thr_parent" : "thr_plain_parent",
        }),
      },
    },
  });
  await plugin(bb);
  const configure = () => harness.inspection.registrations.agentConfigurationProvider;
  const context = (threadId: string) => ({
    thread: { id: threadId, title: null, parentThreadId: null, sourceThreadId: null },
    project: { id: "proj_1", kind: "standard", name: "Project", gitRemoteUrl: null },
    environment: { id: "env_1", name: null, path: "/repo", workspaceProvisionType: "unmanaged", branchName: null },
    host: { id: "host_1", name: "Host" },
    provider: { id: "codex", model: "gpt-5.4-mini", capabilities: { supportsNativeUserQuestion: true } },
    origin: { kind: null, pluginId: null },
  } as never);
  const hook = harness.inspection.registrations.hooks["message.dispatch"];
  assert.ok(hook);

  await hook({
    thread: { id: "thr_plain_child", parentThreadId: "thr_plain_parent" },
    input: { text: "/rpi-agent-codebase-locator find files", blocks: [] },
    parentThreadId: "thr_plain_parent",
    originPluginId: null,
  } as never);
  assert.deepEqual(configure()?.(context("thr_plain_child")), { tools: [], skills: [] });

  const created = await harness.behavior.callRpc("createTask", {
    request: { text: "prompt", projectId: "proj_1", workflowType: "freeform", worktreeTiming: "never", permissionMode: "default", autoAdvance: false },
    name: "Task",
    draft: true,
  }) as { taskId: string };
  bb.storage.database().prepare(`
    INSERT INTO sessions (
      thread_id, task_id, label, skill_id, launched_by, forked_from_thread_id,
      hl_status, hl_status_at, had_turn, interrupted, blocked_reason, created_at, updated_at
    ) VALUES ('thr_parent', ?, 'research', 'create-research', 'user', NULL, 'running', 1, 1, 0, NULL, 1, 1)
  `).run(created.taskId);

  await hook({
    thread: { id: "thr_child", parentThreadId: "thr_parent" },
    input: { text: "/rpi-agent-codebase-locator find files", blocks: [] },
    parentThreadId: "thr_parent",
    originPluginId: null,
  } as never);
  let childConfig = configure()?.(context("thr_child"));
  assert.ok(childConfig?.skills.includes("rpi-agent-codebase-locator"));
  assert.equal(childConfig?.skills.includes("rpi-create-research"), false);

  await harness.lifecycle.reload(plugin);
  childConfig = configure()?.(context("thr_child"));
  assert.ok(childConfig?.skills.includes("rpi-agent-codebase-locator"));
  assert.equal(childConfig?.skills.includes("rpi-create-research"), false);
  await harness.lifecycle.dispose();
});

test("agent child classification uses the thread record's actual parent", async () => {
  const actualParents = new Map<string, string | null>();
  const { bb, harness } = createFakePluginHost({
    pluginId: "humanlayer",
    sdk: {
      subscribe: () => () => undefined,
      threads: {
        get: async ({ threadId }) => makeThreadResponse({
          id: threadId,
          parentThreadId: actualParents.get(threadId) ?? null,
        }),
      },
    },
  });
  await plugin(bb);
  const hook = harness.inspection.registrations.hooks["message.dispatch"];
  assert.ok(hook);
  const created = await harness.behavior.callRpc("createTask", {
    request: { text: "prompt", projectId: "proj_1", workflowType: "freeform", worktreeTiming: "never", permissionMode: "default", autoAdvance: false },
    name: "Task",
    draft: true,
  }) as { taskId: string };
  bb.storage.database().prepare(`
    INSERT INTO sessions (
      thread_id, task_id, label, skill_id, launched_by, forked_from_thread_id,
      hl_status, hl_status_at, had_turn, interrupted, blocked_reason, created_at, updated_at
    ) VALUES ('thr_task_parent', ?, 'research', 'create-research', 'user', NULL, 'running', 1, 1, 0, NULL, 1, 1)
  `).run(created.taskId);

  actualParents.set("thr_claimed_child", "thr_plain_parent");
  await hook({
    thread: { id: "thr_claimed_child", parentThreadId: "thr_task_parent" },
    input: { text: "/rpi-agent-codebase-locator find files", blocks: [] },
    parentThreadId: "thr_task_parent",
    originPluginId: null,
  } as never);
  let stored = bb.storage.database().prepare("SELECT COUNT(*) AS count FROM child_threads WHERE thread_id = ?").get("thr_claimed_child") as { count: number };
  assert.equal(stored.count, 0);

  actualParents.set("thr_actual_child", "thr_task_parent");
  await hook({
    thread: { id: "thr_actual_child", parentThreadId: "thr_plain_parent" },
    input: { text: "/rpi-agent-codebase-locator find files", blocks: [] },
    parentThreadId: "thr_plain_parent",
    originPluginId: null,
  } as never);
  stored = bb.storage.database().prepare("SELECT COUNT(*) AS count FROM child_threads WHERE thread_id = ? AND parent_thread_id = ? AND task_id = ?").get("thr_actual_child", "thr_task_parent", created.taskId) as { count: number };
  assert.equal(stored.count, 1);
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
