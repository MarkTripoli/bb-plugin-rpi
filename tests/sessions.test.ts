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
  archiveTaskThreads,
  createLaunchBindingMirror,
  deriveStatus,
  extractLaunchToken,
  loadSessionMirror,
  mirrorSession,
  recordIdleCompletion,
  registerSessionRuntime,
  taskInstructions,
  type SessionMirrorRow,
} from "../sessions";
import { TASK_CONTEXT_FIRST_ACTION } from "../instructions";
import {
  DEFAULT_NOTIFICATION_PREFS,
  approvalsFromInteractions,
  decideAndPublishNotification,
  notificationSummaryFromSession,
  recoverReadyAfterFailedAdvance,
} from "../notify";
import { latestLaunchAttemptLabel } from "../advance";

// Mirrors server.ts's real notifySnapshot wiring: evaluated on every derived snapshot, not just
// on rpiStatus transitions, so ready_for_input uses the persisted final completed_turn_key and
// needs_approval fires per pending interaction id.
function makeSnapshotHandler(db: Database.Database, mirror: Map<string, SessionMirrorRow>, bb: { realtime: { publish: (topic: string, payload: unknown) => void } }) {
  return async (threadId: string, interactions: readonly unknown[]) => {
    const row = mirror.get(threadId);
    if (!row) return;
    const context = { prefs: DEFAULT_NOTIFICATION_PREFS, owner: "unknown" as const, viewing: false };
    for (const approval of approvalsFromInteractions(interactions)) {
      await decideAndPublishNotification(bb as never, db, {
        type: "status_transition",
        threadId,
        previousStatus: null,
        nextStatus: "needs_approval",
        completedTurnKey: null,
        title: row.taskName,
        summary: notificationSummaryFromSession(row),
        approval,
      }, context);
    }
    if (row.rpiStatus === "ready_for_input" && !row.blockedReason && row.completedTurnKey) {
      await decideAndPublishNotification(bb as never, db, {
        type: "status_transition",
        threadId,
        previousStatus: "running",
        nextStatus: "ready_for_input",
        completedTurnKey: row.completedTurnKey,
        title: row.taskName,
        summary: notificationSummaryFromSession(row),
      }, context);
    }
  };
}

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
      rpi_status, rpi_status_at, had_turn, interrupted, blocked_reason, created_at, updated_at
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
      pluginId: "rpi",
      log: { warn: () => undefined, info: () => undefined },
      realtime: { publish: () => undefined },
      sdk: {
        subscribe: () => () => undefined,
        projects: { get: async ({ projectId }: { projectId: string }) => ({ id: projectId, name: "Proj", kind: "standard" as const, gitRemoteUrl: null, createdAt: 1, updatedAt: 1, sources: [{ id: "src_1", projectId, hostId: "host_seed", path: "/repo", type: "local_path" as const, isDefault: true, createdAt: 1, updatedAt: 1 }] }) },
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
  assert.equal(deriveStatus(thread({ status: "active", runtime: { displayStatus: "waiting-for-host" } }), [], row).rpiStatus, "lost");
  assert.equal(deriveStatus(thread({ status: "active", runtime: { displayStatus: "provisioning" } }), [], row).rpiStatus, "waiting_for_workspace");
  assert.equal(deriveStatus(thread({ status: "active", environment: { status: "provisioning" } }), [], row).rpiStatus, "waiting_for_workspace");
  assert.equal(deriveStatus(thread({ status: "pending", runtime: { displayStatus: "pending" } }), [], row).rpiStatus, "ready_for_launch");
  assert.equal(deriveStatus(thread({ status: "starting", runtime: { displayStatus: "starting" } }), [], row).rpiStatus, "launching");
  assert.equal(deriveStatus(thread({ status: "starting", runtime: { displayStatus: "starting" } }), [], { ...row, hadTurn: true }).rpiStatus, "resuming");
  assert.equal(deriveStatus(thread({ status: "active", runtime: { displayStatus: "active" } }), interaction("approval"), row).rpiStatus, "needs_approval");
  assert.equal(deriveStatus(thread({ status: "active", runtime: { displayStatus: "active" } }), interaction("user_question"), row).rpiStatus, "ready_for_input");
  assert.equal(deriveStatus(thread({ status: "active", runtime: { displayStatus: "active" } }), interaction("plugin"), row).rpiStatus, "ready_for_input");
  assert.equal(deriveStatus(thread({ status: "active", runtime: { displayStatus: "active" } }), [], row).rpiStatus, "running");
  assert.equal(deriveStatus(thread({ status: "stopping", runtime: { displayStatus: "stopping" } }), [], row).rpiStatus, "interrupt_requested");
  assert.equal(deriveStatus(thread({ status: "error", runtime: { displayStatus: "error" } }), [], row).rpiStatus, "failed");
  assert.equal(deriveStatus(thread({ status: "idle", runtime: { displayStatus: "idle" } }), [], { ...row, interrupted: true }).rpiStatus, "interrupted");
  assert.equal(deriveStatus(thread({ status: "idle", runtime: { displayStatus: "idle" } }), [], row).rpiStatus, "ready_for_input");
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
  assert.equal(deriveStatus(thread({ status: "active", runtime: { displayStatus: "active" } }), [], row).rpiStatus, "running");
  assert.equal(deriveStatus(thread({ status: "error", runtime: { displayStatus: "error" } }), [], row).rpiStatus, "failed");
  assert.equal(deriveStatus(thread({ status: "active", runtime: { displayStatus: "host-reconnecting" } }), [], row).rpiStatus, "lost");
});

test("user_question stores blocked reason for executor skip", () => {
  const derived = deriveStatus(thread({ status: "idle", runtime: { displayStatus: "idle" } }), interaction("user_question"), row);
  assert.equal(derived.rpiStatus, "ready_for_input");
  assert.equal(derived.blockedReason, "question");
});

test("interaction status precedence keeps terminal states", () => {
  assert.equal(deriveStatus(thread({ status: "error", runtime: { displayStatus: "error" } }), interaction("approval"), row).rpiStatus, "failed");
  assert.equal(deriveStatus(thread({ status: "stopping", runtime: { displayStatus: "stopping" } }), interaction("approval"), row).rpiStatus, "interrupt_requested");
  assert.equal(deriveStatus(thread({ status: "idle", runtime: { displayStatus: "idle" } }), interaction("approval"), row).rpiStatus, "ready_for_input");
  const questionWithError = deriveStatus(thread({ status: "error", runtime: { displayStatus: "error" } }), interaction("user_question"), row);
  assert.equal(questionWithError.rpiStatus, "failed");
  assert.equal(questionWithError.blockedReason, "question");
});

test("older reconciliation snapshots cannot regress a newer status", () => {
  const db = makeDb();
  const mirror = new Map();
  seedSession(db);
  applyStatusDerivation(db, mirror, thread({ status: "idle", runtime: { displayStatus: "idle" } }), [], 2);
  applyStatusDerivation(db, mirror, thread({ status: "active", runtime: { displayStatus: "active" } }), [], 1);
  const row = db.prepare("SELECT rpi_status, last_reconcile_seq FROM sessions WHERE thread_id = ?").get("thr_1") as { rpi_status: string; last_reconcile_seq: number };
  assert.equal(row.rpi_status, "ready_for_input");
  assert.equal(row.last_reconcile_seq, 2);
  db.close();
});

test("rpi_status_at only advances when derived status actually changes", () => {
  const db = makeDb();
  const mirror = new Map();
  seedSession(db);
  applyStatusDerivation(db, mirror, thread({ status: "idle", runtime: { displayStatus: "idle" } }), [], 1);
  db.prepare("UPDATE sessions SET rpi_status_at = 12345 WHERE thread_id = 'thr_1'").run();
  // Same derived status (ready_for_input) on a later sequence: last_reconcile_seq advances, rpi_status_at must not.
  applyStatusDerivation(db, mirror, thread({ status: "idle", runtime: { displayStatus: "idle" } }), [], 2);
  const second = db.prepare("SELECT rpi_status_at AS rpiStatusAt, last_reconcile_seq AS seq FROM sessions WHERE thread_id = ?").get("thr_1") as { rpiStatusAt: number; seq: number };
  assert.equal(second.seq, 2);
  assert.equal(second.rpiStatusAt, 12345);
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
  const stored = db.prepare("SELECT rpi_status, last_reconcile_seq FROM sessions WHERE thread_id = ?").get("thr_1") as { rpi_status: string; last_reconcile_seq: number };
  assert.equal(stored.rpi_status, "ready_for_input");
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
    "Wrote .rpi/tasks/task/01-research.md\n```text\n/rpi-create-design-discussion @01-research.md\n```",
  );
  const stored = db.prepare("SELECT next_step_json, summary_json FROM sessions WHERE thread_id = ?").get("thr_1") as { next_step_json: string; summary_json: string };
  const next = parseJson<{ extraction?: { type?: string; nextStepType?: string; nextStepPrompt?: string } }>(stored.next_step_json, {});
  assert.equal(next.extraction?.type, "next_step_found");
  assert.equal(next.extraction?.nextStepType, "create-design-discussion");
  assert.equal(next.extraction?.nextStepPrompt, "/rpi-create-design-discussion @01-research.md");
  const summary = parseJson<{ relevantRPIDocuments?: Array<{ localpath: string }> }>(stored.summary_json, {});
  assert.deepEqual(summary.relevantRPIDocuments, [{ localpath: ".rpi/tasks/task/01-research.md", permalink: `::rpi-artifact{task="${taskId}" file="01-research.md"}` }]);
  db.close();
});

test("system-injected initiating messages append summary without overwriting an existing next step", async () => {
  const db = makeDb();
  const mirror = new Map();
  seedSession(db);
  const priorNext = JSON.stringify({ parsedAt: 1, extraction: { type: "next_step_found", nextStepPrompt: "/rpi-create-research", nextStepSummary: "next", nextStepType: "create-research", taskReference: null, suggestedDirectory: null } });
  db.prepare("UPDATE sessions SET label = 'research-questions', rpi_status = 'ready_for_input', next_step_json = ?, next_step_turn_key = 'turn_old', completed_turn_key = 'turn_old', last_summarized_turn_key = 'turn_old' WHERE thread_id = 'thr_1'").run(priorNext);
  mirrorSession(db, mirror, "thr_1");
  let spawns = 0;
  const bb = {
    pluginId: "rpi",
    realtime: { publish: () => undefined },
    log: { warn: () => undefined },
    sdk: {
      projects: { get: async ({ projectId }: { projectId: string }) => ({ id: projectId, name: "Proj", kind: "standard" as const, gitRemoteUrl: null, createdAt: 1, updatedAt: 1, sources: [{ id: "src_1", projectId, hostId: "host_seed", path: "/repo", type: "local_path" as const, isDefault: true, createdAt: 1, updatedAt: 1 }] }) },
      threads: {
        interactions: { list: async () => [] },
        spawn: async () => {
          spawns += 1;
          return makeThreadResponse({ id: "thr_next", environmentId: "env_1", projectId: "proj_1", originPluginId: "rpi" });
        },
        get: async ({ threadId }: { threadId: string }) => makeThreadResponse({ id: threadId, environmentId: "env_1", projectId: "proj_1", originPluginId: "rpi" }),
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

test("idle-first: auto-advance spawns exactly once, suppression is recorded, and no ready toast fires", async () => {
  const db = makeDb();
  const mirror = new Map();
  seedSession(db);
  const taskId = (db.prepare("SELECT task_id AS taskId FROM sessions WHERE thread_id = 'thr_1'").get() as { taskId: string }).taskId;
  db.prepare("UPDATE tasks SET workflow_type = 'rpi', auto_advance = 1, aa_questions_to_research = 1 WHERE id = ?").run(taskId);
  db.prepare("UPDATE sessions SET label = 'research-questions' WHERE thread_id = 'thr_1'").run();
  const text = "done\n```text\n/rpi-create-research\n```";
  const publishChecks: boolean[] = [];
  let spawns = 0;
  const { bb, handlers } = makeRuntimeBb({
    get: async ({ threadId }) => ({ ...makeThreadResponse({ id: threadId, status: "idle", updatedAt: 2, environmentId: "env_1", projectId: "proj_1", originPluginId: "rpi", runtime: { displayStatus: "idle", hostReconnectGraceExpiresAt: null } }), numEvents: 2 }),
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
    spawn: async () => {
      spawns += 1;
      return makeThreadResponse({ id: "thr_next", environmentId: "env_1", projectId: "proj_1", originPluginId: "rpi" });
    },
  });
  Object.assign(bb.sdk, { files: { listPaths: async () => [] } });
  const onSnapshot = makeSnapshotHandler(db, mirror, bb);
  registerSessionRuntime(bb as never, db, mirror, createLaunchBindingMirror(), (row) => onCompletedTurn(bb as never, db, mirror, createLaunchBindingMirror(), row), undefined, onSnapshot);
  mirrorSession(db, mirror, "thr_1");
  handlers.get("thread.idle")?.({ thread: thread({ numEvents: 2, updatedAt: 2 }), lastAssistantText: text } as never);
  for (let i = 0; i < 10 && publishChecks.length === 0; i += 1) await delay();
  assert.deepEqual(publishChecks, [true]);
  assert.equal(spawns, 1, "auto-advance must spawn exactly once");
  const rows = db.prepare("SELECT reason FROM notifications").all() as Array<{ reason: string }>;
  assert.deepEqual(rows.map((row) => row.reason), ["auto_advance_suppressed"], "no user-visible ready toast for the auto-advanced turn");
  db.close();
});

test("a failed auto-advance launch and the following ready snapshot deliver exactly one notification; a racing reconcile does not duplicate it", async () => {
  const db = makeDb();
  const mirror = new Map();
  seedSession(db);
  const taskId = (db.prepare("SELECT task_id AS taskId FROM sessions WHERE thread_id = 'thr_1'").get() as { taskId: string }).taskId;
  // Astra's exact forced-failure case: worktree_timing 'now' with no host makes launchPhase throw
  // synchronously inside onCompletedTurn, after the notification_suppressions row has already been
  // claimed for this turn.
  db.prepare("UPDATE tasks SET workflow_type = 'rpi', auto_advance = 1, aa_plan_to_worktree = 1, worktree_timing = 'now', host_id = NULL WHERE id = ?").run(taskId);
  db.prepare("UPDATE sessions SET label = 'plan' WHERE thread_id = 'thr_1'").run();
  const text = "done\n```text\n/rpi-setup-worktree\n```";
  const published: unknown[] = [];
  const { bb, handlers } = makeRuntimeBb({
    get: async ({ threadId }) => ({ ...makeThreadResponse({ id: threadId, status: "idle", updatedAt: 2, environmentId: "env_1", projectId: "proj_1", originPluginId: "rpi", runtime: { displayStatus: "idle", hostReconnectGraceExpiresAt: null } }), numEvents: 2 }),
    events: async () => [],
  });
  // Only rpi:notify publishes are counted here; handleIdle also emits rpi:sessions on every
  // completion, which is irrelevant to this test's double-delivery assertion.
  Object.assign(bb.realtime, { publish: (topic: string, payload: unknown) => { if (topic === "rpi:notify") published.push(payload); } });
  Object.assign(bb.sdk.threads, {
    ...bb.sdk.threads,
    interactions: { list: async () => [] },
    timeline: async () => ({
      rows: [
        { kind: "conversation", role: "user", text: "start", turnId: "turn_1", sourceSeqStart: 1, senderThreadId: null, systemMessageKind: "unlabeled" },
        { kind: "conversation", role: "assistant", text, turnId: "turn_1", sourceSeqStart: 2 },
      ],
    }),
  });
  Object.assign(bb.sdk, { files: { listPaths: async () => [] } });
  const onSnapshot = makeSnapshotHandler(db, mirror, bb);
  const onAdvanceFailed = async (session: SessionMirrorRow) => {
    if (!session.completedTurnKey) return;
    await recoverReadyAfterFailedAdvance(bb as never, db, DEFAULT_NOTIFICATION_PREFS, {
      threadId: session.threadId,
      completedTurnKey: session.completedTurnKey,
      failedSkillLabel: latestLaunchAttemptLabel(db, session.threadId),
    });
  };
  registerSessionRuntime(
    bb as never,
    db,
    mirror,
    createLaunchBindingMirror(),
    (row) => onCompletedTurn(bb as never, db, mirror, createLaunchBindingMirror(), row),
    undefined,
    onSnapshot,
    onAdvanceFailed,
  );
  mirrorSession(db, mirror, "thr_1");
  handlers.get("thread.idle")?.({ thread: thread({ numEvents: 2, updatedAt: 2 }), lastAssistantText: text } as never);
  for (let i = 0; i < 20 && published.length === 0; i += 1) await delay();
  // Without the fix, the recovery path (ready-recover:...) and the normal ready snapshot check
  // that runs right after it (ready:...) would both publish for the same turn.
  assert.equal(published.length, 1, "recovery and the following ready snapshot must deliver exactly one notification");
  const rows = db.prepare("SELECT dedupe_key AS dedupeKey FROM notifications").all() as Array<{ dedupeKey: string }>;
  assert.equal(rows.length, 1);
  assert.match(rows[0].dedupeKey, /^ready-recover:thr_1:/);

  // A racing reconcile re-observing the same, already-recovered turn key must not duplicate it.
  await onSnapshot("thr_1", []);
  assert.equal(published.length, 1);
  const rowsAfter = db.prepare("SELECT dedupe_key AS dedupeKey FROM notifications").all() as Array<{ dedupeKey: string }>;
  assert.equal(rowsAfter.length, 1);
  db.close();
});

test("ready notification always uses the persisted final completed turn key, never a stale one observed by a racing reconcile", async () => {
  const db = makeDb();
  const mirror = new Map();
  seedSession(db);
  mirrorSession(db, mirror, "thr_1");
  const published: unknown[] = [];
  const bb = { realtime: { publish: (_topic: string, payload: unknown) => published.push(payload) } };
  const onSnapshot = makeSnapshotHandler(db, mirror, bb);
  const idleBb = { sdk: { threads: { interactions: { list: async () => [] }, get: async () => ({ environment: null }) } }, log: { info: () => undefined } };

  // Turn 1 completes normally: the idle handler appends the key, then the snapshot check notifies.
  await recordIdleCompletion(idleBb as never, db, mirror, thread({ updatedAt: 1 }), "first answer");
  applyStatusDerivation(db, mirror, thread({ status: "idle", runtime: { displayStatus: "idle" } }), [], 1);
  await onSnapshot("thr_1", []);
  assert.equal(published.length, 1);
  assert.equal(mirror.get("thr_1")?.completedTurnKey, "events:1");

  // Agent resumes for a second turn.
  db.prepare("UPDATE sessions SET rpi_status = 'running' WHERE thread_id = 'thr_1'").run();
  mirrorSession(db, mirror, "thr_1");

  // Astra's case: a racing reconcile (e.g. an interactions-changed event) observes the underlying
  // thread already idle BEFORE the idle completion handler has appended turn 2's key. It must not
  // fire a duplicate for the already-notified turn 1 key.
  applyStatusDerivation(db, mirror, thread({ status: "idle", runtime: { displayStatus: "idle" } }), [], 2);
  await onSnapshot("thr_1", []);
  assert.equal(published.length, 1, "a reconcile observing the previous, already-notified key must not fire again");

  // The idle handler now runs for real and appends the final key for turn 2.
  await recordIdleCompletion(idleBb as never, db, mirror, thread({ updatedAt: 2 }), "second answer");
  applyStatusDerivation(db, mirror, thread({ status: "idle", runtime: { displayStatus: "idle" } }), [], 3);
  await onSnapshot("thr_1", []);
  assert.equal(published.length, 2, "the final turn key must still be notified exactly once");
  const rows = db.prepare("SELECT dedupe_key AS dedupeKey FROM notifications ORDER BY created_at").all() as Array<{ dedupeKey: string }>;
  assert.deepEqual(rows.map((row) => row.dedupeKey), ["ready:thr_1:events:1", "ready:thr_1:events:2"]);
  db.close();
});

test("reconcile reconstructs a lost idle completion's completed_turn_key and delivers exactly one ready notification", async () => {
  const db = makeDb();
  const mirror = new Map();
  seedSession(db);
  mirrorSession(db, mirror, "thr_1");
  const published: unknown[] = [];
  const text = "second answer, no next step";
  const captured: { subscribeCallback: ((event: { id: string; changes: string[] }) => void) | null } = { subscribeCallback: null };
  const bb = {
    pluginId: "rpi",
    log: { warn: () => undefined, info: () => undefined },
    realtime: { publish: (topic: string, payload: unknown) => { if (topic === "rpi:notify") published.push(payload); } },
    onDispose: () => undefined,
    experimental_hooks: { on: () => undefined },
    events: { on: () => undefined },
    sdk: {
      subscribe: (opts: { callback: (event: { id: string; changes: string[] }) => void }) => {
        captured.subscribeCallback = opts.callback;
        return () => undefined;
      },
      threads: {
        get: async ({ threadId }: { threadId: string }) => ({
          ...makeThreadResponse({ id: threadId, status: "idle", updatedAt: 5, environmentId: "env_1", projectId: "proj_1", originPluginId: "rpi", runtime: { displayStatus: "idle", hostReconnectGraceExpiresAt: null } }),
          numEvents: 5,
        }),
        interactions: { list: async () => [] },
        timeline: async () => ({
          rows: [
            { kind: "conversation", role: "user", text: "go", turnId: "t1", sourceSeqStart: 1 },
            { kind: "conversation", role: "assistant", text, turnId: "t1", sourceSeqStart: 2 },
          ],
        }),
      },
    },
  };
  const onSnapshot = makeSnapshotHandler(db, mirror, bb);
  registerSessionRuntime(bb as never, db, mirror, createLaunchBindingMirror(), undefined, undefined, onSnapshot);
  // The thread.idle event that would normally have recorded completed_turn_key was dropped (e.g. a
  // restart between idle and reconcile): the session is still 'running' with no completed turn.
  captured.subscribeCallback?.({ id: "thr_1", changes: ["status-changed"] });
  for (let i = 0; i < 20 && published.length === 0; i += 1) await delay();
  assert.equal(published.length, 1, "reconcile must reconstruct the completed turn key and notify exactly once");
  const stored = db.prepare("SELECT completed_turn_key AS completedTurnKey FROM sessions WHERE thread_id = 'thr_1'").get() as { completedTurnKey: string | null };
  assert.equal(stored.completedTurnKey, "5:5");
  const rows = db.prepare("SELECT dedupe_key AS dedupeKey FROM notifications").all() as Array<{ dedupeKey: string }>;
  assert.deepEqual(rows.map((row) => row.dedupeKey), ["ready:thr_1:5:5"]);
  db.close();
});

test("reconcile-first: a reconcile racing ahead of the idle event still auto-advances exactly once with no user toast", async () => {
  const db = makeDb();
  const mirror = new Map();
  seedSession(db);
  const taskId = (db.prepare("SELECT task_id AS taskId FROM sessions WHERE thread_id = 'thr_1'").get() as { taskId: string }).taskId;
  db.prepare("UPDATE tasks SET workflow_type = 'rpi', auto_advance = 1, aa_questions_to_research = 1 WHERE id = ?").run(taskId);
  db.prepare("UPDATE sessions SET label = 'research-questions' WHERE thread_id = 'thr_1'").run();
  mirrorSession(db, mirror, "thr_1");
  const publishedNotify: unknown[] = [];
  let spawns = 0;
  const text = "done\n```text\n/rpi-create-research\n```";
  const captured: { subscribeCallback: ((event: { id: string; changes: string[] }) => void) | null } = { subscribeCallback: null };
  const bb = {
    pluginId: "rpi",
    log: { warn: () => undefined, info: () => undefined },
    realtime: { publish: (topic: string, payload: unknown) => { if (topic === "rpi:notify") publishedNotify.push(payload); } },
    onDispose: () => undefined,
    experimental_hooks: { on: () => undefined },
    events: { on: () => undefined },
    sdk: {
      subscribe: (opts: { callback: (event: { id: string; changes: string[] }) => void }) => {
        captured.subscribeCallback = opts.callback;
        return () => undefined;
      },
      projects: { get: async ({ projectId }: { projectId: string }) => ({ id: projectId, name: "Proj", kind: "standard" as const, gitRemoteUrl: null, createdAt: 1, updatedAt: 1, sources: [{ id: "src_1", projectId, hostId: "host_seed", path: "/repo", type: "local_path" as const, isDefault: true, createdAt: 1, updatedAt: 1 }] }) },
      threads: {
        get: async ({ threadId }: { threadId: string }) => ({
          ...makeThreadResponse({ id: threadId, status: "idle", updatedAt: 2, environmentId: "env_1", projectId: "proj_1", originPluginId: "rpi", runtime: { displayStatus: "idle", hostReconnectGraceExpiresAt: null } }),
          numEvents: 2,
        }),
        interactions: { list: async () => [] },
        timeline: async () => ({
          rows: [
            { kind: "conversation", role: "user", text: "start", turnId: "t1", sourceSeqStart: 1, senderThreadId: null, systemMessageKind: "unlabeled" },
            { kind: "conversation", role: "assistant", text, turnId: "t1", sourceSeqStart: 2 },
          ],
        }),
        spawn: async () => {
          spawns += 1;
          return makeThreadResponse({ id: "thr_next", environmentId: "env_1", projectId: "proj_1", originPluginId: "rpi" });
        },
      },
      files: { listPaths: async () => [] },
    },
  };
  const onSnapshot = makeSnapshotHandler(db, mirror, bb);
  registerSessionRuntime(
    bb as never,
    db,
    mirror,
    createLaunchBindingMirror(),
    (row) => onCompletedTurn(bb as never, db, mirror, createLaunchBindingMirror(), row),
    undefined,
    onSnapshot,
  );
  // The idle event that would normally have driven this never fires here: only a thread:changed
  // reconcile observes the thread already idle, with no completed_turn_key or processed_turn_key
  // recorded yet. Before the fix, reconstructing only stamped the summary, so recordIdleCompletion
  // (guarded on last_summarized_turn_key) never ran again for this key and auto-advance never
  // happened.
  captured.subscribeCallback?.({ id: "thr_1", changes: ["status-changed"] });
  for (let i = 0; i < 20 && spawns === 0; i += 1) await delay();
  assert.equal(spawns, 1, "reconcile alone must still trigger exactly one auto-advance spawn");
  const suppression = db.prepare("SELECT consumed_at AS consumedAt FROM notification_suppressions WHERE thread_id = 'thr_1'").get() as { consumedAt: number | null } | undefined;
  assert.ok(suppression, "an auto_advance suppression row must have been claimed");
  const reasons = (db.prepare("SELECT reason FROM notifications WHERE thread_id = 'thr_1'").all() as Array<{ reason: string }>).map((row) => row.reason);
  assert.deepEqual(reasons, ["auto_advance_suppressed"], "no user-visible toast for the auto-advanced turn");
  assert.equal(publishedNotify.length, 0, "a suppressed decision never publishes rpi:notify");
  db.close();
});

test("reconcile-first: an interrupted turn does not auto-advance and settles on interrupted status", async () => {
  const db = makeDb();
  const mirror = new Map();
  seedSession(db);
  const taskId = (db.prepare("SELECT task_id AS taskId FROM sessions WHERE thread_id = 'thr_1'").get() as { taskId: string }).taskId;
  db.prepare("UPDATE tasks SET workflow_type = 'rpi', auto_advance = 1, aa_questions_to_research = 1 WHERE id = ?").run(taskId);
  db.prepare("UPDATE sessions SET label = 'research-questions' WHERE thread_id = 'thr_1'").run();
  mirrorSession(db, mirror, "thr_1");
  let spawns = 0;
  const text = "done\n```text\n/rpi-create-research\n```";
  const captured: { subscribeCallback: ((event: { id: string; changes: string[] }) => void) | null } = { subscribeCallback: null };
  const bb = {
    pluginId: "rpi",
    log: { warn: () => undefined, info: () => undefined },
    realtime: { publish: () => undefined },
    onDispose: () => undefined,
    experimental_hooks: { on: () => undefined },
    events: { on: () => undefined },
    sdk: {
      subscribe: (opts: { callback: (event: { id: string; changes: string[] }) => void }) => {
        captured.subscribeCallback = opts.callback;
        return () => undefined;
      },
      threads: {
        get: async ({ threadId }: { threadId: string }) => ({
          ...makeThreadResponse({ id: threadId, status: "idle", updatedAt: 2, environmentId: "env_1", projectId: "proj_1", originPluginId: "rpi", runtime: { displayStatus: "idle", hostReconnectGraceExpiresAt: null } }),
          numEvents: 2,
        }),
        interactions: { list: async () => [] },
        events: { list: async () => [{ type: "system/thread/interrupted" }] },
        timeline: async () => ({
          rows: [
            { kind: "conversation", role: "user", text: "start", turnId: "t1", sourceSeqStart: 1, senderThreadId: null, systemMessageKind: "unlabeled" },
            { kind: "conversation", role: "assistant", text, turnId: "t1", sourceSeqStart: 2 },
          ],
        }),
        spawn: async () => {
          spawns += 1;
          return makeThreadResponse({ id: "thr_next", environmentId: "env_1", projectId: "proj_1", originPluginId: "rpi" });
        },
      },
      files: { listPaths: async () => [] },
    },
  };
  const onSnapshot = makeSnapshotHandler(db, mirror, bb);
  registerSessionRuntime(
    bb as never,
    db,
    mirror,
    createLaunchBindingMirror(),
    (row) => onCompletedTurn(bb as never, db, mirror, createLaunchBindingMirror(), row),
    undefined,
    onSnapshot,
  );
  // Reconcile observes the thread already idle with no completed_turn_key recorded yet, races
  // ahead of the idle event, and the event log already contains system/thread/interrupted: the
  // unified post-completion check (processCompletedTurn) must refuse to auto-advance here exactly
  // as the idle path would, and settle the session on "interrupted" instead of "ready_for_input".
  captured.subscribeCallback?.({ id: "thr_1", changes: ["status-changed"] });
  for (let i = 0; i < 20; i += 1) await delay();
  assert.equal(spawns, 0, "an interrupted turn must never auto-advance");
  const stored = db.prepare("SELECT rpi_status AS rpiStatus, interrupted FROM sessions WHERE thread_id = 'thr_1'").get() as { rpiStatus: string; interrupted: number };
  assert.equal(stored.rpiStatus, "interrupted");
  assert.equal(stored.interrupted, 1);
  const reasons = (db.prepare("SELECT reason FROM notifications WHERE thread_id = 'thr_1'").all() as Array<{ reason: string }>).map((row) => row.reason);
  assert.deepEqual(reasons, [], "no ready toast for an interrupted turn");
  db.close();
});

test("idle-first: an interrupted turn does not auto-advance", async () => {
  const db = makeDb();
  const mirror = new Map();
  seedSession(db);
  const taskId = (db.prepare("SELECT task_id AS taskId FROM sessions WHERE thread_id = 'thr_1'").get() as { taskId: string }).taskId;
  db.prepare("UPDATE tasks SET workflow_type = 'rpi', auto_advance = 1, aa_questions_to_research = 1 WHERE id = ?").run(taskId);
  db.prepare("UPDATE sessions SET label = 'research-questions' WHERE thread_id = 'thr_1'").run();
  const text = "done\n```text\n/rpi-create-research\n```";
  let spawns = 0;
  const { bb, handlers } = makeRuntimeBb({
    get: async ({ threadId }) => ({ ...makeThreadResponse({ id: threadId, status: "idle", updatedAt: 2, environmentId: "env_1", projectId: "proj_1", originPluginId: "rpi", runtime: { displayStatus: "idle", hostReconnectGraceExpiresAt: null } }), numEvents: 2 }),
    events: async () => [{ type: "system/thread/interrupted" }],
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
    spawn: async () => {
      spawns += 1;
      return makeThreadResponse({ id: "thr_next", environmentId: "env_1", projectId: "proj_1", originPluginId: "rpi" });
    },
  });
  Object.assign(bb.sdk, { files: { listPaths: async () => [] } });
  const onSnapshot = makeSnapshotHandler(db, mirror, bb);
  registerSessionRuntime(bb as never, db, mirror, createLaunchBindingMirror(), (row) => onCompletedTurn(bb as never, db, mirror, createLaunchBindingMirror(), row), undefined, onSnapshot);
  mirrorSession(db, mirror, "thr_1");
  handlers.get("thread.idle")?.({ thread: thread({ numEvents: 2, updatedAt: 2 }), lastAssistantText: text } as never);
  for (let i = 0; i < 20; i += 1) await delay();
  assert.equal(spawns, 0, "an interrupted turn must never auto-advance");
  const stored = db.prepare("SELECT rpi_status AS rpiStatus, interrupted FROM sessions WHERE thread_id = 'thr_1'").get() as { rpiStatus: string; interrupted: number };
  assert.equal(stored.rpiStatus, "interrupted");
  assert.equal(stored.interrupted, 1);
  db.close();
});

test("startup replay does not re-run the completion pipeline for an already-processed turn", async () => {
  const db = makeDb();
  const mirror = new Map();
  seedSession(db);
  const taskId = (db.prepare("SELECT task_id AS taskId FROM sessions WHERE thread_id = 'thr_1'").get() as { taskId: string }).taskId;
  db.prepare("UPDATE tasks SET workflow_type = 'rpi', auto_advance = 1, aa_questions_to_research = 1 WHERE id = ?").run(taskId);
  // Pre-seed the mirror as if a prior run already fully processed this turn: ingest/extract done,
  // the auto-advance suppression already claimed and consumed, and the ready notification already
  // recorded (auto_advance_suppressed, so no toast).
  db.prepare("UPDATE sessions SET label = 'research-questions', rpi_status = 'ready_for_input', completed_turn_key = '2:2', processed_turn_key = '2:2', advanced_at = 1, advanced_attempt_id = 'attempt_1' WHERE thread_id = 'thr_1'").run();
  db.prepare("INSERT INTO notification_suppressions (thread_id, completed_turn_key, reason, created_at, consumed_at) VALUES ('thr_1', '2:2', 'auto_advance', 1, 1)").run();
  db.prepare("INSERT INTO notifications (id, thread_id, kind, dedupe_key, reason, sound, created_at, delivered_at) VALUES ('n1', 'thr_1', 'ready_for_input', 'ready:thr_1:2:2', 'auto_advance_suppressed', 0, 1, NULL)").run();
  db.prepare("UPDATE sessions SET last_reconcile_seq = 40 WHERE thread_id = 'thr_1'").run();
  const seeded = loadSessionMirror(db);
  let spawns = 0;
  let timelineCalls = 0;
  const { bb } = makeRuntimeBb({
    get: async ({ threadId }) => ({ ...makeThreadResponse({ id: threadId, status: "idle", updatedAt: 2, environmentId: "env_1", projectId: "proj_1", originPluginId: "rpi", runtime: { displayStatus: "idle", hostReconnectGraceExpiresAt: null } }), numEvents: 2 }),
    events: async () => [],
  });
  Object.assign(bb.sdk.threads, {
    ...bb.sdk.threads,
    interactions: { list: async () => [] },
    timeline: async () => {
      timelineCalls += 1;
      return { rows: [] };
    },
    spawn: async () => {
      spawns += 1;
      return makeThreadResponse({ id: "thr_next", environmentId: "env_1", projectId: "proj_1", originPluginId: "rpi" });
    },
  });
  const onSnapshot = makeSnapshotHandler(db, seeded, bb);
  registerSessionRuntime(
    bb as never,
    db,
    seeded,
    createLaunchBindingMirror(),
    (row) => onCompletedTurn(bb as never, db, seeded, createLaunchBindingMirror(), row),
    undefined,
    onSnapshot,
  );
  for (let i = 0; i < 10; i += 1) await delay();
  assert.equal(spawns, 0, "an already-processed turn must not spawn again on startup replay");
  assert.equal(timelineCalls, 0, "an already-processed turn must not re-fetch the last assistant message");
  const notificationCount = (db.prepare("SELECT COUNT(*) AS count FROM notifications WHERE thread_id = 'thr_1'").get() as { count: number }).count;
  assert.equal(notificationCount, 1, "no duplicate notification row on startup replay");
  db.close();
});

test("needs_approval notifies again for a second pending approval id while status stays needs_approval", async () => {
  const db = makeDb();
  const mirror = new Map();
  seedSession(db);
  db.prepare("UPDATE sessions SET rpi_status = 'needs_approval' WHERE thread_id = 'thr_1'").run();
  mirrorSession(db, mirror, "thr_1");
  const published: unknown[] = [];
  const bb = { realtime: { publish: (_topic: string, payload: unknown) => published.push(payload) } };
  const onSnapshot = makeSnapshotHandler(db, mirror, bb);
  const approvalOne = [{ id: "pint_1", status: "pending", payload: { kind: "approval", toolName: "mcp__a__b", toolInput: "x" } }];
  await onSnapshot("thr_1", approvalOne);
  assert.equal(published.length, 1);
  // rpiStatus stays needs_approval (no transition), but a second, different approval id arrives.
  const approvalTwo = [{ id: "pint_2", status: "pending", payload: { kind: "approval", toolName: "mcp__a__b", toolInput: "y" } }];
  await onSnapshot("thr_1", approvalTwo);
  assert.equal(published.length, 2, "a second pending approval id must notify even though rpiStatus did not change");
  const rows = db.prepare("SELECT dedupe_key AS dedupeKey FROM notifications ORDER BY created_at").all() as Array<{ dedupeKey: string }>;
  assert.deepEqual(rows.map((row) => row.dedupeKey), ["approval:thr_1:pint_1", "approval:thr_1:pint_2"]);
  // Redelivering the same approval id must not duplicate.
  await onSnapshot("thr_1", approvalTwo);
  assert.equal(published.length, 2);
  db.close();
});

test("two simultaneously pending approvals in one snapshot both notify; a second reconcile of the same pair notifies neither", async () => {
  const db = makeDb();
  const mirror = new Map();
  seedSession(db);
  db.prepare("UPDATE sessions SET rpi_status = 'needs_approval' WHERE thread_id = 'thr_1'").run();
  mirrorSession(db, mirror, "thr_1");
  const published: unknown[] = [];
  const bb = { realtime: { publish: (_topic: string, payload: unknown) => published.push(payload) } };
  const onSnapshot = makeSnapshotHandler(db, mirror, bb);
  const bothPending = [
    { id: "pint_1", status: "pending", payload: { kind: "approval", toolName: "mcp__a__b", toolInput: "x" } },
    { id: "pint_2", status: "pending", payload: { kind: "approval", toolName: "mcp__a__b", toolInput: "y" } },
  ];
  await onSnapshot("thr_1", bothPending);
  assert.equal(published.length, 2, "both simultaneously pending approval ids must notify, not just the first");
  const rows = db.prepare("SELECT dedupe_key AS dedupeKey FROM notifications ORDER BY created_at").all() as Array<{ dedupeKey: string }>;
  assert.deepEqual(rows.map((row) => row.dedupeKey), ["approval:thr_1:pint_1", "approval:thr_1:pint_2"]);
  // A second reconcile observing the same still-pending pair must not duplicate either.
  await onSnapshot("thr_1", bothPending);
  assert.equal(published.length, 2);
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
    pluginId: "rpi",
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
    pluginId: "rpi",
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
      rpi_status, rpi_status_at, had_turn, interrupted, blocked_reason, created_at, updated_at
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
    pluginId: "rpi",
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
      rpi_status, rpi_status_at, had_turn, interrupted, blocked_reason, created_at, updated_at
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
    originPluginId: "rpi",
    status: "pending",
    runtime: { displayStatus: "pending", hostReconnectGraceExpiresAt: null },
  });
  const { bb, harness } = createFakePluginHost({
    pluginId: "rpi",
    sdk: {
      subscribe: () => () => undefined,
      projects: { get: async ({ projectId }: { projectId: string }) => ({ id: projectId, name: "Proj", kind: "standard" as const, gitRemoteUrl: null, createdAt: 1, updatedAt: 1, sources: [{ id: "src_1", projectId, hostId: "host_seed", path: "/repo", type: "local_path" as const, isDefault: true, createdAt: 1, updatedAt: 1 }] }) },
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
    originPluginId: "rpi",
    startedOnBehalfOf: null,
    parentThreadId: null,
  } as never);
  assert.deepEqual(decision, { action: "proceed" });
  const instructions = harness.inspection.registrations.instructionProvider?.({ threadId: "thr_spawned", projectId: "proj_1" });
  assert.match(instructions ?? "", /RPI task: Task/);
  resolveSpawn(threadResponse);
  await launchPromise;
  await harness.lifecycle.dispose();
});

test("extractLaunchToken finds the token when marker is the last line of a multi-line prompt", () => {
  const multilinePrompt = `First line of context
Second line
Some task instructions

<!-- rpi:launch:attempt-abc123 -->`;
  const token = extractLaunchToken(multilinePrompt);
  assert.equal(token, "attempt-abc123");
});

test("extractLaunchToken returns null when marker is absent", () => {
  const noMarker = `First line of context
Second line
Some task instructions`;
  const token = extractLaunchToken(noMarker);
  assert.equal(token, null);
});

test("extractLaunchToken finds the token at any position in the text", () => {
  const markerAtStart = `<!-- rpi:launch:start-marker -->
Context line`;
  assert.equal(extractLaunchToken(markerAtStart), "start-marker");

  const markerInMiddle = `Line 1
<!-- rpi:launch:middle-marker -->
Line 3`;
  assert.equal(extractLaunchToken(markerInMiddle), "middle-marker");
});

test("archiveTaskThreads archives only the task's unarchived session threads and tolerates one failure", async () => {
  const db = makeDb();
  seedSession(db, "thr_open");
  const taskId = (db.prepare("SELECT task_id AS taskId FROM sessions WHERE thread_id = 'thr_open'").get() as { taskId: string }).taskId;
  db.prepare(`
    INSERT INTO sessions (
      thread_id, task_id, label, skill_id, launched_by, forked_from_thread_id,
      rpi_status, rpi_status_at, had_turn, interrupted, blocked_reason, created_at, updated_at, thread_archived_at
    ) VALUES ('thr_done', ?, NULL, NULL, 'user', NULL, 'running', 1, 1, 0, NULL, 1, 1, 5),
             ('thr_fail', ?, NULL, NULL, 'user', NULL, 'running', 1, 1, 0, NULL, 1, 1, NULL)
  `).run(taskId, taskId);
  seedSession(db, "thr_other_task");
  const archived: string[] = [];
  const warnings: string[] = [];
  const bb = {
    log: { warn: (message: string) => warnings.push(message) },
    sdk: { threads: { archive: async ({ threadId }: { threadId: string }) => { if (threadId === "thr_fail") throw new Error("offline"); archived.push(threadId); return { ok: true }; } } },
  };
  const result = await archiveTaskThreads(bb as never, db, taskId);
  assert.deepEqual(archived, ["thr_open"]);
  assert.deepEqual(result, { archived: 1, failed: 1 });
  assert.equal(warnings.length, 1);
  assert.match(warnings[0]!, /thr_fail/);
});
