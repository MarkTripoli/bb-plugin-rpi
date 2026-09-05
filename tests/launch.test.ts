import test from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { makeThreadResponse } from "@get-bb/plugin-sdk/testing";
import { MIGRATIONS } from "../db";
import { createDraftTask } from "../tasks";
import { launchPhase, promoteStalePendingLaunchAttempts, resolveLaunchAttempt } from "../launch";
import { TASK_CONTEXT_FIRST_ACTION } from "../instructions";
import { bindPendingLaunch, createLaunchBindingMirror, registerPendingLaunch, type SessionMirrorRow } from "../sessions";

function makeDb() {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  for (const statement of MIGRATIONS) db.exec(statement);
  return db;
}

function seedTask(db: Database.Database) {
  return createDraftTask(db, {
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
  }).taskId;
}

test("resolved launch attempts are no-ops", async () => {
  const db = makeDb();
  const taskId = seedTask(db);
  db.prepare("INSERT INTO launch_attempts (id, task_id, from_thread_id, skill_id, status, thread_id, created_at) VALUES (?, ?, NULL, NULL, 'spawned', ?, ?)")
    .run("attempt_1", taskId, "thr_existing", 1);
  const mirror = new Map<string, SessionMirrorRow>();
  const result = await resolveLaunchAttempt({} as never, db, mirror, createLaunchBindingMirror(), "attempt_1", { type: "retry" });
  assert.deepEqual(result, { threadId: "thr_existing" });
  db.close();
});

test("launchPhase prompts start with marker then task context first-action line", async () => {
  const db = makeDb();
  const taskId = seedTask(db);
  const task = db.prepare("SELECT * FROM tasks WHERE id = ?").get(taskId);
  let prompt = "";
  const bb = {
    realtime: { publish: () => undefined },
    sdk: {
      threads: {
        spawn: async (input: { prompt: string }) => {
          prompt = input.prompt;
          return makeThreadResponse({ id: "thr_new", environmentId: "env_1", projectId: "proj_1", originPluginId: "humanlayer" });
        },
        get: async () => makeThreadResponse({ id: "thr_new", environmentId: "env_1", projectId: "proj_1", originPluginId: "humanlayer" }),
      },
    },
    log: { warn: () => undefined },
  };
  await launchPhase(bb as never, db, new Map(), createLaunchBindingMirror(), {
    id: (task as { id: string }).id,
    projectId: "proj_1",
    name: "Task",
    slug: "task",
    draftPrompt: "prompt",
    workflowType: "freeform",
    worktreeTiming: "never",
    isDraft: true,
    archived: false,
    hostId: null,
    baseEnvironmentId: null,
    worktreeEnvironmentId: null,
    defaultDirectory: null,
    providerId: null,
    model: null,
    reasoningLevel: null,
    serviceTier: null,
    permissionMode: "default",
    autoAdvance: false,
    aa_questions_to_research: true,
    aa_research_to_design: true,
    aa_plan_to_worktree: true,
    aa_worktree_to_implementation: true,
    aa_implementation_to_pr: false,
    createdAt: 1,
    updatedAt: 1,
  }, { skillId: null, prompt: "do work", launchedBy: "user", fromThreadId: null });
  const lines = prompt.split("\n");
  assert.match(lines[0]!, /^<!-- hl:launch:/);
  assert.equal(lines[1], TASK_CONTEXT_FIRST_ACTION);
  db.close();
});

test("adopt rejects a thread already bound to a session without resolving the attempt", async () => {
  const db = makeDb();
  const taskId = seedTask(db);
  db.prepare("INSERT INTO launch_attempts (id, task_id, from_thread_id, skill_id, status, thread_id, created_at) VALUES (?, ?, NULL, NULL, 'uncertain', NULL, ?)")
    .run("attempt_1", taskId, 1);
  db.prepare(`
    INSERT INTO sessions (
      thread_id, task_id, label, skill_id, launched_by, forked_from_thread_id,
      hl_status, hl_status_at, had_turn, interrupted, blocked_reason, created_at, updated_at
    ) VALUES ('thr_bound', ?, NULL, NULL, 'user', NULL, 'running', 1, 1, 0, NULL, 1, 1)
  `).run(taskId);
  const thread = makeThreadResponse({ id: "thr_bound", projectId: "proj_1", createdAt: 2, originPluginId: "humanlayer" });
  const bb = {
    pluginId: "humanlayer",
    sdk: {
      threads: {
        list: async () => [thread],
        get: async () => ({ ...thread, environmentId: "env_1", environment: { id: "env_1", path: "/tmp/repo", status: "ready" } }),
      },
    },
  };
  await assert.rejects(
    () => resolveLaunchAttempt(bb as never, db, new Map(), createLaunchBindingMirror(), "attempt_1", { type: "adopt", threadId: "thr_bound" }),
    /already bound/,
  );
  const attempt = db.prepare("SELECT status, thread_id FROM launch_attempts WHERE id = ?").get("attempt_1") as { status: string; thread_id: string | null };
  assert.equal(attempt.status, "uncertain");
  assert.equal(attempt.thread_id, null);
  db.close();
});

test("stale pending launch attempts promote to uncertain", () => {
  const db = makeDb();
  const taskId = seedTask(db);
  db.prepare("INSERT INTO launch_attempts (id, task_id, from_thread_id, skill_id, status, thread_id, created_at) VALUES (?, ?, NULL, NULL, 'pending', NULL, ?)")
    .run("attempt_old", taskId, Date.now() - 180_000);
  db.prepare("INSERT INTO launch_attempts (id, task_id, from_thread_id, skill_id, status, thread_id, created_at) VALUES (?, ?, NULL, NULL, 'pending', NULL, ?)")
    .run("attempt_new", taskId, Date.now());
  assert.deepEqual(promoteStalePendingLaunchAttempts(db), [taskId]);
  const statuses = db.prepare("SELECT id, status FROM launch_attempts ORDER BY id").all() as Array<{ id: string; status: string }>;
  assert.deepEqual(statuses, [
    { id: "attempt_new", status: "pending" },
    { id: "attempt_old", status: "uncertain" },
  ]);
  db.close();
});

test("dismissed attempt clears pending binding", async () => {
  const db = makeDb();
  const taskId = seedTask(db);
  db.prepare("INSERT INTO launch_attempts (id, task_id, from_thread_id, skill_id, status, thread_id, created_at) VALUES (?, ?, NULL, NULL, 'pending', NULL, ?)")
    .run("attempt_1", taskId, 1);
  const bindings = createLaunchBindingMirror();
  registerPendingLaunch(bindings, {
    token: "attempt_1",
    taskId,
    fromThreadId: null,
    skillId: null,
    launchedBy: "user",
    threadId: "thr_late",
  });
  await resolveLaunchAttempt({} as never, db, new Map(), bindings, "attempt_1", { type: "dismiss" });
  assert.equal(bindings.pendingByToken.has("attempt_1"), false);
  assert.equal(bindings.pendingByThread.has("thr_late"), false);
  db.close();
});

test("late spawn return cannot bind a resolved attempt", () => {
  const db = makeDb();
  const taskId = seedTask(db);
  db.prepare("INSERT INTO launch_attempts (id, task_id, from_thread_id, skill_id, status, thread_id, created_at) VALUES (?, ?, NULL, NULL, 'failed', NULL, ?)")
    .run("attempt_1", taskId, 1);
  const mirror = new Map<string, SessionMirrorRow>();
  const bindings = createLaunchBindingMirror();
  registerPendingLaunch(bindings, {
    token: "attempt_1",
    taskId,
    fromThreadId: null,
    skillId: null,
    launchedBy: "user",
    threadId: "thr_late",
  });
  assert.equal(bindPendingLaunch(db, mirror, bindings, "attempt_1", "thr_late"), null);
  assert.equal(mirror.has("thr_late"), false);
  const count = db.prepare("SELECT COUNT(*) AS count FROM sessions WHERE thread_id = ?").get("thr_late") as { count: number };
  assert.equal(count.count, 0);
  assert.equal(bindings.pendingByToken.has("attempt_1"), false);
  assert.equal(bindings.pendingByThread.has("thr_late"), false);
  db.close();
});

test("launchPhase selects environments by worktree timing and phase", async () => {
  const cases = [
    { timing: "never", skillId: "create-research", expected: "project-default" },
    { timing: "now", skillId: "create-research", expected: "managed-worktree" },
    { timing: "later", skillId: "create-research", expected: "project-default" },
    { timing: "later", skillId: "implement-outline", expected: "managed-worktree" },
  ] as const;
  for (const item of cases) {
    const db = makeDb();
    const taskId = createDraftTask(db, {
      projectId: "proj_1",
      prompt: "prompt",
      name: "Task",
      workflowType: "rpi",
      worktreeTiming: item.timing,
      hostId: "host_1",
      permissionMode: "default",
      autoAdvance: false,
      providerId: null,
      model: null,
      reasoningLevel: null,
      serviceTier: null,
    }).taskId;
    const task = db.prepare("SELECT id, project_id AS projectId, name, slug, draft_prompt AS draftPrompt, workflow_type AS workflowType, worktree_timing AS worktreeTiming, is_draft AS isDraft, archived, host_id AS hostId, base_environment_id AS baseEnvironmentId, worktree_environment_id AS worktreeEnvironmentId, default_directory AS defaultDirectory, provider_id AS providerId, model, reasoning_level AS reasoningLevel, service_tier AS serviceTier, permission_mode AS permissionMode, auto_advance AS autoAdvance, aa_questions_to_research, aa_research_to_design, aa_plan_to_worktree, aa_worktree_to_implementation, aa_implementation_to_pr, created_at AS createdAt, updated_at AS updatedAt FROM tasks WHERE id = ?").get(taskId) as never;
    let environment: unknown;
    const bb = {
      realtime: { publish: () => undefined },
      sdk: {
        threads: {
          spawn: async (input: { environment: unknown }) => {
            environment = input.environment;
            return makeThreadResponse({ id: "thr_new", environmentId: null, projectId: "proj_1", originPluginId: "humanlayer" });
          },
          get: async () => makeThreadResponse({ id: "thr_new", environmentId: "env_1", projectId: "proj_1", originPluginId: "humanlayer" }),
        },
      },
      log: { warn: () => undefined },
    };
    await launchPhase(bb as never, db, new Map(), createLaunchBindingMirror(), task, { skillId: item.skillId, launchedBy: "user", fromThreadId: null });
    const kind = (environment as { type: string; workspace?: { type: string } }).type === "host"
      ? (environment as { workspace: { type: string } }).workspace.type
      : (environment as { type: string }).type;
    assert.equal(kind, item.expected);
    const stored = db.prepare("SELECT base_environment_id, worktree_environment_id FROM tasks WHERE id = ?").get(taskId) as { base_environment_id: string | null; worktree_environment_id: string | null };
    if (item.expected === "managed-worktree") assert.equal(stored.worktree_environment_id, "env_1");
    else assert.equal(stored.base_environment_id, "env_1");
    db.close();
  }
});
