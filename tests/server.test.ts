import test from "node:test";
import assert from "node:assert/strict";
import { createFakePluginHost, makeThreadResponse } from "@get-bb/plugin-sdk/testing";
import plugin from "../server";
import { listTasks } from "../tasks";
import { listSessions } from "../sessions";
import { attentionQueue } from "../status";

test("sessions can be marked done and reopened independently of the task and derived status", async (t) => {
  const { bb, harness } = createFakePluginHost({ pluginId: "rpi", sdk: { subscribe: () => () => undefined } });
  t.after(() => harness.lifecycle.dispose());
  await plugin(bb);
  const { taskId } = await harness.behavior.callRpc("createTask", {
    request: { text: "Session completion", projectId: "proj_1", workflowType: "freeform", worktreeTiming: "never" }, draft: true,
  }) as { taskId: string };
  const db = bb.storage.database();
  for (const id of ["one", "two"]) db.prepare(`INSERT INTO sessions (thread_id, task_id, label, launched_by, rpi_status, rpi_status_at, had_turn, created_at, updated_at)
    VALUES (?, ?, ?, 'user', 'needs_approval', 1, 1, 1, 1)`).run(id, taskId, id);
  assert.equal(listTasks(db)[0]?.attentionCount, 2);
  await assert.rejects(harness.behavior.callRpc("setSessionCompleted", { threadId: "one", completed: "true" }));
  await harness.behavior.callRpc("setSessionCompleted", { threadId: "one", completed: true });
  const detail = await harness.behavior.callRpc("getTask", { taskId }) as { task: { completed: boolean }; sessions: Array<{ threadId: string; completed: boolean; rpiStatus: string }> };
  assert.equal(detail.task.completed, false);
  assert.deepEqual(detail.sessions.map((session) => [session.threadId, session.completed, session.rpiStatus]), [
    ["one", true, "needs_approval"], ["two", false, "needs_approval"],
  ]);
  assert.equal(listTasks(db)[0]?.attentionCount, 1);
  db.prepare("UPDATE sessions SET rpi_status = 'ready_for_input' WHERE thread_id = 'one'").run();
  assert.equal(listSessions(db, taskId).find((session) => session.threadId === "one")?.completed, true);
  await harness.behavior.callRpc("setSessionCompleted", { threadId: "one", completed: false });
  assert.equal(listTasks(db)[0]?.attentionCount, 2);
  assert.deepEqual(db.prepare("SELECT thread_archived_at FROM sessions").all(), [{ thread_archived_at: null }, { thread_archived_at: null }]);
  assert.deepEqual(await harness.behavior.callRpc("setSessionCompleted", { threadId: "missing", completed: true }), { session: null });
  db.prepare("UPDATE sessions SET thread_archived_at = 2 WHERE thread_id = 'one'").run();
  assert.deepEqual(await harness.behavior.callRpc("setSessionCompleted", { threadId: "one", completed: true }), { session: null });
});

test("task deletion is atomic, preserves BB threads and other tasks, and reserves the old mirror slug", async (t) => {
  const { bb, harness } = createFakePluginHost({ pluginId: "rpi", sdk: { subscribe: () => () => undefined } });
  t.after(() => harness.lifecycle.dispose());
  await plugin(bb);
  const create = async (name: string) => await harness.behavior.callRpc("createTask", {
    request: { text: "Keep on disk", projectId: "proj_1", workflowType: "freeform", worktreeTiming: "never" }, name, draft: true,
  }) as { taskId: string };
  const { taskId } = await create("Remove me");
  const other = await create("Keep me");
  const db = bb.storage.database();
  db.prepare(`INSERT INTO sessions (thread_id, task_id, launched_by, rpi_status, rpi_status_at, created_at, updated_at)
    VALUES ('delete_session', ?, 'user', 'running', 1, 1, 1)`).run(taskId);
  await assert.rejects(harness.behavior.callRpc("deleteTask", { taskId }), /Stop running sessions/);
  db.prepare("UPDATE sessions SET rpi_status = 'ready_for_input' WHERE task_id = ?").run(taskId);
  db.prepare("INSERT INTO launch_attempts (id, task_id, status, created_at) VALUES ('pending_delete', ?, 'uncertain', 1)").run(taskId);
  await assert.rejects(harness.behavior.callRpc("deleteTask", { taskId }), /Resolve pending task launches/);
  db.prepare("UPDATE launch_attempts SET status = 'failed'").run();
  const artifact = db.prepare("SELECT id FROM artifacts WHERE task_id = ?").get(taskId) as { id: string };
  db.prepare("INSERT INTO comments (id, artifact_id, version_id, content_text, created_at, updated_at) VALUES ('delete_comment', ?, 'v1', 'Comment', 1, 1)").run(artifact.id);
  db.prepare("INSERT INTO send_receipts (request_id, artifact_id, thread_id, comment_ids_json, mode, sent_ids_json, created_at) VALUES ('delete_receipt', ?, 'delete_session', '[]', 'send', '[]', 1)").run(artifact.id);
  db.prepare("INSERT INTO child_threads (thread_id, task_id, parent_thread_id, role, created_at) VALUES ('delete_child', ?, 'delete_session', 'test', 1)").run(taskId);
  db.prepare("INSERT INTO notifications (id, thread_id, kind, dedupe_key, reason, created_at) VALUES ('delete_notification', 'delete_child', 'ready_for_input', 'test', 'test', 1)").run();
  db.prepare("INSERT INTO scratch_pads (task_id, text, updated_at) VALUES (?, 'notes', 1)").run(taskId);
  db.prepare("INSERT INTO task_ui_state (task_id, json) VALUES (?, '{}')").run(taskId);
  db.prepare("INSERT INTO mirror_state (task_id, file_name, updated_at) VALUES (?, 'task.md', 1)").run(taskId);
  db.exec("CREATE TRIGGER reject_task_delete BEFORE DELETE ON tasks BEGIN SELECT RAISE(ABORT, 'test rollback'); END");
  await assert.rejects(harness.behavior.callRpc("deleteTask", { taskId }), /test rollback/);
  assert.equal((db.prepare("SELECT COUNT(*) AS n FROM comments").get() as { n: number }).n, 1);
  assert.equal((db.prepare("SELECT COUNT(*) AS n FROM sessions").get() as { n: number }).n, 1);
  db.exec("DROP TRIGGER reject_task_delete");
  assert.deepEqual(await harness.behavior.callRpc("deleteTask", { taskId }), { deleted: true });
  for (const table of ["comments", "send_receipts", "sessions", "child_threads", "notifications", "launch_attempts", "scratch_pads", "task_ui_state", "mirror_state"]) {
    assert.equal((db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n, 0, table);
  }
  assert.deepEqual(listTasks(db).map((task) => task.id), [other.taskId]);
  assert.equal((db.prepare("SELECT COUNT(*) AS n FROM artifacts").get() as { n: number }).n, 1);
  assert.equal((db.prepare("SELECT COUNT(*) AS n FROM artifact_versions").get() as { n: number }).n, 1);
  assert.deepEqual(await harness.behavior.callRpc("deleteTask", { taskId }), { deleted: false });
  const replacement = await create("Remove me");
  assert.equal(listTasks(db).find((task) => task.id === replacement.taskId)?.slug, "remove-me-2");
  // An unstubbed SDK delete/archive call would throw in this fake host.
});

test("manual task completion persists, hides only that task, and reopens without archiving sessions or artifacts", async (t) => {
  const { bb, harness } = createFakePluginHost({
    pluginId: "rpi",
    sdk: { subscribe: () => () => undefined },
  });
  t.after(() => harness.lifecycle.dispose());
  await plugin(bb);
  const create = async (name: string, projectId = "proj_1") => await harness.behavior.callRpc("createTask", {
    request: { text: "Keep these artifacts", projectId, workflowType: "freeform", worktreeTiming: "never", autoAdvance: false },
    name,
    draft: true,
  }) as { taskId: string };
  const { taskId } = await create("Finish me");
  const other = await create("Still active");
  await create("Other project", "proj_2");
  const db = bb.storage.database();
  db.prepare(`INSERT INTO sessions (thread_id, task_id, launched_by, rpi_status, rpi_status_at, had_turn, created_at, updated_at)
    VALUES ('thr_done', ?, 'user', 'ready_for_input', 1, 1, 1, 1)`).run(taskId);
  const sessionsBefore = listSessions(db, taskId);
  const queueSessions = sessionsBefore.map((session) => ({ ...session, threadUpdatedAt: null }));
  const artifactsBefore = db.prepare("SELECT * FROM artifacts WHERE task_id = ?").all(taskId);
  assert.equal(listTasks(db).find((task) => task.id === taskId)?.attentionCount, 1);

  await assert.rejects(harness.behavior.callRpc("updateTask", { taskId, patch: { completed: "true" } }));
  await assert.rejects(harness.behavior.callRpc("listTasks", { completed: "all" }));
  await harness.behavior.callRpc("updateTask", { taskId, patch: { completed: true } });
  const active = await harness.behavior.callRpc("listTasks", { projectId: "proj_1" }) as { tasks: Array<{ id: string }> };
  assert.deepEqual(active.tasks.map((task) => task.id), [other.taskId]);
  const done = await harness.behavior.callRpc("listTasks", { projectId: "proj_1", completed: true }) as { tasks: Array<{ id: string; completed: boolean; archived: boolean; attentionCount: number }> };
  assert.deepEqual(done.tasks.map((task) => [task.id, task.completed, task.archived, task.attentionCount]), [[taskId, true, false, 0]]);
  const all = await harness.behavior.callRpc("listTasks", { projectId: "proj_1", completed: null }) as { tasks: Array<{ id: string }> };
  assert.equal(all.tasks.length, 2);
  assert.deepEqual(listSessions(db, taskId), sessionsBefore);
  assert.deepEqual(db.prepare("SELECT * FROM artifacts WHERE task_id = ?").all(taskId), artifactsBefore);
  assert.equal(attentionQueue(queueSessions, listTasks(db, { completed: null })).length, 0);
  assert.ok(harness.inspection.realtimeSignals.some((signal) => signal.channel === "tasks"));

  const persisted = await harness.behavior.callRpc("listTasks", { completed: true }) as { tasks: Array<{ id: string }> };
  assert.deepEqual(persisted.tasks.map((task) => task.id), [taskId]);
  await harness.behavior.callRpc("updateTask", { taskId, patch: { name: "Renamed while done" } });
  assert.equal(listTasks(db, { completed: true })[0]?.completed, true);
  await harness.behavior.callRpc("updateTask", { taskId, patch: { completed: false } });
  assert.equal(listTasks(db).find((task) => task.id === taskId)?.attentionCount, 1);
  assert.equal(attentionQueue(queueSessions, listTasks(db)).length, 1);
  assert.deepEqual(listSessions(db, taskId), sessionsBefore);
});

function toolText(result: string | { content: Array<{ type: string; text?: string }> }) {
  return typeof result === "string" ? result : result.content.find((part) => part.type === "text")?.text ?? "";
}

test("sessions list CLI paginates and truncates summaries", async () => {
  const { bb, harness } = createFakePluginHost({
    pluginId: "rpi",
    sdk: { subscribe: () => () => undefined },
  });
  await plugin(bb);
  const created = await harness.behavior.callRpc("createTask", {
    request: { text: "prompt", projectId: "proj_1", workflowType: "freeform", worktreeTiming: "never", permissionMode: "default", autoAdvance: false },
    name: "Task",
    draft: true,
  }) as { taskId: string };
  const db = bb.storage.database();
  const long = "x".repeat(250);
  for (let index = 0; index < 4; index += 1) {
    db.prepare(`
      INSERT INTO sessions (
        thread_id, task_id, label, skill_id, launched_by, forked_from_thread_id,
        rpi_status, rpi_status_at, had_turn, interrupted, blocked_reason,
        summary_json, created_at, updated_at
      ) VALUES (?, ?, NULL, NULL, 'user', NULL, 'ready_for_input', ?, 1, 0, NULL, ?, ?, ?)
    `).run(`thr_${index}`, created.taskId, index + 1, JSON.stringify({ summaryHistory: [`old-${index}`, long, "tail-a", "tail-b"] }), index + 1, index + 1);
  }
  const result = await harness.behavior.runCli(["sessions", "list", "--task", created.taskId, "--limit", "2", "--offset", "1", "--json"]);
  assert.equal(result.exitCode, 0);
  const body = JSON.parse(result.stdout) as { sessions: Array<{ threadId: string; summaryJson: string }>; limit: number; offset: number };
  assert.equal(body.limit, 2);
  assert.equal(body.offset, 1);
  assert.deepEqual(body.sessions.map((session) => session.threadId), ["thr_2", "thr_1"]);
  const summary = JSON.parse(body.sessions[0]!.summaryJson) as { summaryHistory: string[] };
  assert.equal(summary.summaryHistory.length, 3);
  assert.equal(summary.summaryHistory[0]!.length, 200);
  await harness.lifecycle.dispose();
});

test("notifications CLI validates args and the test path never touches real dedupe or suppression rows", async () => {
  const { bb, harness } = createFakePluginHost({
    pluginId: "rpi",
    sdk: { subscribe: () => () => undefined },
  });
  await plugin(bb);
  const created = await harness.behavior.callRpc("createTask", {
    request: { text: "prompt", projectId: "proj_1", workflowType: "freeform", worktreeTiming: "never", permissionMode: "default", autoAdvance: false },
    name: "Task",
    draft: true,
  }) as { taskId: string };
  const db = bb.storage.database();
  db.prepare(`
    INSERT INTO sessions (
      thread_id, task_id, label, skill_id, launched_by, forked_from_thread_id,
      rpi_status, rpi_status_at, had_turn, interrupted, blocked_reason,
      completed_turn_key, created_at, updated_at
    ) VALUES ('thr_test', ?, NULL, NULL, 'user', NULL, 'ready_for_input', 1, 1, 0, NULL, 'turn_real', 1, 1)
  `).run(created.taskId);
  db.prepare(`
    INSERT INTO notification_suppressions (thread_id, completed_turn_key, reason, created_at, consumed_at)
    VALUES ('thr_test', 'turn_real', 'auto_advance', 1, NULL)
  `).run();

  const badLimit = await harness.behavior.runCli(["notifications", "list", "--limit", "abc"]);
  assert.equal(badLimit.exitCode, 2);

  const missingThread = await harness.behavior.runCli(["notifications", "test"]);
  assert.equal(missingThread.exitCode, 2);

  // Unknown flags are rejected by .strict() on the raw parsed options, before projection to the
  // fields the command actually reads, instead of being silently dropped.
  const unknownFlag = await harness.behavior.runCli(["notifications", "list", "--limit", "5", "--bogus", "x"]);
  assert.equal(unknownFlag.exitCode, 2);
  const unknownTestFlag = await harness.behavior.runCli(["notifications", "test", "--thread", "thr_test", "--bogus", "x"]);
  assert.equal(unknownTestFlag.exitCode, 2);

  const result = await harness.behavior.runCli(["notifications", "test", "--thread", "thr_test", "--json"]);
  assert.equal(result.exitCode, 0);
  const body = JSON.parse(result.stdout) as { decision: { reason: string } };
  assert.equal(body.decision.reason, "notify");

  const rows = db.prepare("SELECT dedupe_key AS dedupeKey FROM notifications WHERE thread_id = 'thr_test'").all() as Array<{ dedupeKey: string }>;
  assert.equal(rows.length, 1);
  assert.match(rows[0]!.dedupeKey, /^test:thr_test:/);
  assert.equal(rows.some((row) => row.dedupeKey === "ready:thr_test:turn_real"), false);

  const suppression = db.prepare("SELECT consumed_at AS consumedAt FROM notification_suppressions WHERE thread_id = 'thr_test'").get() as { consumedAt: number | null };
  assert.equal(suppression.consumedAt, null, "the CLI test path must never consume a real suppression row");
  await harness.lifecycle.dispose();
});

test("artifact route forces attachment for html and sets security headers", async () => {
  const { bb, harness } = createFakePluginHost({
    pluginId: "rpi",
    sdk: { subscribe: () => () => undefined },
  });
  await plugin(bb);
  const created = await harness.behavior.callRpc("createTask", {
    request: { text: "prompt", projectId: "proj_1", workflowType: "freeform", worktreeTiming: "never", permissionMode: "default", autoAdvance: false },
    name: "Task",
    draft: true,
  }) as { taskId: string };
  await harness.behavior.callRpc("saveArtifact", {
    taskId: created.taskId,
    fileName: "preview.html",
    content: "<h1>unsafe</h1>",
  });
  const response = await harness.behavior.fetchHttp("GET", `/artifact?task=${created.taskId}&file=preview.html&inline=1`);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "text/html");
  assert.equal(response.headers.get("content-disposition"), "attachment; filename=\"preview.html\"");
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(response.headers.get("content-security-policy"), "sandbox; default-src 'none'");
  await harness.lifecycle.dispose();
});

test("RPI launch RPC and CLI paths are enabled", async () => {
  let spawns = 0;
  const { bb, harness } = createFakePluginHost({
    pluginId: "rpi",
    sdk: {
      subscribe: () => () => undefined,
      projects: {
        get: async ({ projectId }: { projectId: string }) => ({
          id: projectId,
          name: "Proj",
          kind: "standard" as const,
          gitRemoteUrl: null,
          createdAt: 1,
          updatedAt: 1,
          sources: [{ id: "src_1", projectId, hostId: "host_seed", path: "/repo", type: "local_path" as const, isDefault: true, createdAt: 1, updatedAt: 1 }],
        }),
      },
      threads: {
        spawn: async () => {
          spawns += 1;
          return { id: `thr_internal_${spawns}`, environmentId: "env_1" };
        },
        get: async ({ threadId }: { threadId: string }) => ({ id: threadId, environmentId: "env_1", title: "thread", titleFallback: null, updatedAt: 1, environment: { path: "/repo" } }),
        interactions: {
          list: async () => [],
        },
      },
    },
  });
  await plugin(bb);
  const created = await harness.behavior.callRpc("createTask", {
    request: { text: "prompt", projectId: "proj_1", workflowType: "freeform", worktreeTiming: "never", permissionMode: "default", autoAdvance: false },
    name: "Task",
    draft: true,
  }) as { taskId: string };
  const rpcLaunch = await harness.behavior.callRpc("launchSkill", { taskId: created.taskId, skillId: "create-research" }) as { threadId: string };
  assert.equal(rpcLaunch.threadId, "thr_internal_1");

  const createdForProceed = await harness.behavior.callRpc("createTask", {
    request: { text: "prompt", projectId: "proj_1", workflowType: "freeform", worktreeTiming: "never", permissionMode: "default", autoAdvance: false },
    name: "Task 2",
    draft: true,
  }) as { taskId: string };
  const db = bb.storage.database();
  db.prepare(`
    INSERT INTO sessions (
      thread_id, task_id, label, skill_id, launched_by, forked_from_thread_id,
      rpi_status, rpi_status_at, had_turn, interrupted, blocked_reason,
      next_step_json, completed_turn_key, next_step_turn_key, created_at, updated_at
    ) VALUES ('thr_source', ?, NULL, NULL, 'user', NULL, 'ready_for_input', 1, 1, 0, NULL, ?, 'turn_1', 'turn_1', 1, 1)
  `).run(createdForProceed.taskId, JSON.stringify({ parsedAt: 1, extraction: { type: "next_step_found", nextStepPrompt: "/rpi-create-research", nextStepSummary: "next", nextStepType: "create-research", taskReference: null, suggestedDirectory: null } }));
  const proceeded = await harness.behavior.callRpc("proceed", { threadId: "thr_source" }) as { threadId: string };
  assert.equal(proceeded.threadId, "thr_internal_2");

  const createdForCli = await harness.behavior.callRpc("createTask", {
    request: { text: "prompt", projectId: "proj_1", workflowType: "freeform", worktreeTiming: "never", permissionMode: "default", autoAdvance: false },
    name: "Task 3",
    draft: true,
  }) as { taskId: string };
  const launched = await harness.behavior.runCli(["launch-skill", "--task", createdForCli.taskId, "--skill", "create-research"]);
  assert.equal(launched.exitCode, 0);
  assert.equal(launched.stdout.trim(), "thr_internal_3");
  assert.equal(spawns, 3);
  await harness.lifecycle.dispose();
});

test("launchCompletion RPC one-click launches a completion action with task execution defaults", async (t) => {
  const spawnInputs: Array<Record<string, unknown>> = [];
  const { bb, harness } = createFakePluginHost({
    pluginId: "rpi",
    sdk: {
      subscribe: () => () => undefined,
      projects: {
        get: async ({ projectId }: { projectId: string }) => ({
          id: projectId,
          name: "Proj",
          kind: "standard" as const,
          gitRemoteUrl: null,
          createdAt: 1,
          updatedAt: 1,
          sources: [{ id: "src_1", projectId, hostId: "host_seed", path: "/repo", type: "local_path" as const, isDefault: true, createdAt: 1, updatedAt: 1 }],
        }),
      },
      threads: {
        spawn: async (input) => {
          spawnInputs.push(input as unknown as Record<string, unknown>);
          return makeThreadResponse({ id: `thr_quick_${spawnInputs.length}`, environmentId: "env_1", projectId: "proj_1", originPluginId: "rpi" });
        },
        get: async ({ threadId }: { threadId: string }) => makeThreadResponse({ id: threadId, environmentId: "env_1", projectId: "proj_1", originPluginId: "rpi" }),
        interactions: { list: async () => [] },
      },
    },
  });
  t.after(() => harness.lifecycle.dispose());
  await plugin(bb);
  const created = await harness.behavior.callRpc("createTask", {
    request: {
      text: "prompt",
      projectId: "proj_1",
      workflowType: "rpi",
      worktreeTiming: "never",
      permissionMode: "accept_edits",
      autoAdvance: false,
      providerId: "pi",
      model: "task-model",
      reasoningLevel: "low",
      serviceTier: "default",
    },
    name: "Task",
    draft: true,
  }) as { taskId: string };
  const db = bb.storage.database();
  db.prepare(`
    INSERT INTO sessions (
      thread_id, task_id, label, skill_id, launched_by, forked_from_thread_id,
      rpi_status, rpi_status_at, had_turn, interrupted, blocked_reason,
      next_step_json, summary_json, completed_turn_key, next_step_turn_key, last_summarized_turn_key, created_at, updated_at
    ) VALUES ('thr_source', ?, 'implementation', 'implement-plan', 'user', NULL, 'ready_for_input', 1, 1, 0, NULL, ?, ?, 'turn_1', 'turn_1', 'turn_1', 1, 1)
  `).run(
    created.taskId,
    JSON.stringify({ parsedAt: 1, extraction: { type: "next_step_found", nextStepPrompt: "/rpi-describe-pr", nextStepSummary: "next", nextStepType: "describe-pr", taskReference: null, suggestedDirectory: null } }),
    JSON.stringify({ primaryReviewArtifact: { fileName: "02-implementation-receipt.md" } }),
  );
  await import("../artifacts").then(({ upsertArtifact }) => upsertArtifact(db, created.taskId, "01-plan-demo.md", `---\ntype: plan\n---\n\n## Phase 1: Scaffold\n\n- [x] done\n\n## Phase 2: Wire server\n\n- [ ] todo\n`, { createdBy: "test", operation: "test" }));
  await import("../artifacts").then(({ upsertArtifact }) => upsertArtifact(db, created.taskId, "02-implementation-receipt.md", `---\ntype: implementation\ncompleted_phase: 1\n---\n`, { createdBy: "test", operation: "test" }));

  await assert.rejects(harness.behavior.callRpc("launchCompletion", {
    intent: { kind: "completion", threadId: "thr_source", skillId: "implement-plan", phase: 3 },
  }), /no longer available/);
  assert.equal((db.prepare("SELECT COUNT(*) AS count FROM launch_attempts WHERE task_id = ?").get(created.taskId) as { count: number }).count, 0);
  assert.equal((db.prepare("SELECT advanced_at AS advancedAt FROM sessions WHERE thread_id = 'thr_source'").get() as { advancedAt: number | null }).advancedAt, null);

  const launched = await harness.behavior.callRpc("launchCompletion", {
    intent: { kind: "completion", threadId: "thr_source", skillId: "implement-plan", phase: 2 },
  }) as { threadId: string };
  assert.equal(launched.threadId, "thr_quick_1");
  const spawnInput = spawnInputs[0]!;
  assert.equal(spawnInput.providerId, "pi");
  assert.equal(spawnInput.model, "task-model");
  assert.equal(spawnInput.permissionMode, "accept-edits");
});

test("manual launch RPC prepares read-only state, submits structured input, and returns typed relocation rejections", async (t) => {
  const spawnInputs: Array<Record<string, unknown>> = [];
  const { bb, harness } = createFakePluginHost({
    pluginId: "rpi",
    sdk: {
      subscribe: () => () => undefined,
      projects: {
        get: async ({ projectId }: { projectId: string }) => ({
          id: projectId,
          name: "Proj",
          kind: "standard" as const,
          gitRemoteUrl: null,
          createdAt: 1,
          updatedAt: 1,
          sources: [{ id: "src_1", projectId, hostId: "host_seed", path: "/repo", type: "local_path" as const, isDefault: true, createdAt: 1, updatedAt: 1 }],
        }),
      },
      threads: {
        spawn: async (input) => {
          spawnInputs.push(input as unknown as Record<string, unknown>);
          return makeThreadResponse({ id: `thr_manual_${spawnInputs.length}`, environmentId: "env_1", projectId: "proj_1", originPluginId: "rpi" });
        },
        get: async ({ threadId }: { threadId: string }) => makeThreadResponse({ id: threadId, environmentId: "env_1", projectId: "proj_1", originPluginId: "rpi" }),
        interactions: { list: async () => [] },
      },
    },
  });
  t.after(() => harness.lifecycle.dispose());
  await plugin(bb);
  const created = await harness.behavior.callRpc("createTask", {
    request: {
      text: "prompt",
      projectId: "proj_1",
      workflowType: "freeform",
      worktreeTiming: "never",
      permissionMode: "accept_edits",
      autoAdvance: false,
      providerId: "pi",
      model: "task-model",
      reasoningLevel: "low",
      serviceTier: "default",
    },
    name: "Task",
    draft: true,
  }) as { taskId: string };
  const intent = { kind: "skill" as const, taskId: created.taskId, skillId: "create-research" };
  const prepared = await harness.behavior.callRpc("prepareManualLaunch", { intent }) as {
    stateToken: string;
    projectId: string;
    environment: { type: "host"; hostId: string; workspace: { type: "unmanaged"; path: string | null } };
    displayPrompt: string;
  };
  assert.equal(prepared.displayPrompt, "/rpi-create-research");
  assert.equal(spawnInputs.length, 0);
  assert.equal((bb.storage.database().prepare("SELECT COUNT(*) AS count FROM launch_attempts").get() as { count: number }).count, 0);

  const request = {
    projectId: prepared.projectId,
    providerId: "codex",
    model: "session-model",
    reasoningLevel: "high" as const,
    permissionMode: "full" as const,
    serviceTier: "fast" as const,
    executionInputSources: { providerId: "explicit" as const, model: "explicit" as const, reasoningLevel: "explicit" as const, permissionMode: "explicit" as const, serviceTier: "explicit" as const },
    environment: { ...prepared.environment, workspace: { ...prepared.environment.workspace, path: null } },
    input: [{ type: "text" as const, text: "edited in the composer", mentions: [] }],
  };
  const submitted = await harness.behavior.callRpc("submitManualLaunch", { intent, stateToken: prepared.stateToken, request }) as { status: string; threadId?: string };
  assert.deepEqual(submitted, { status: "launched", threadId: "thr_manual_1" });
  assert.equal(spawnInputs.length, 1);
  assert.equal(spawnInputs[0]!.providerId, "codex");
  assert.equal(spawnInputs[0]!.model, "session-model");
  assert.equal(spawnInputs[0]!.reasoningLevel, "high");
  assert.equal(spawnInputs[0]!.permissionMode, "full");
  assert.deepEqual(spawnInputs[0]!.environment, prepared.environment, "the task path stays canonical after composer normalization");
  assert.deepEqual((spawnInputs[0]!.input as unknown[]).slice(1, -1), request.input);
  assert.deepEqual(bb.storage.database().prepare("SELECT provider_id, model, reasoning_level, service_tier, permission_mode FROM tasks WHERE id = ?").get(created.taskId), {
    provider_id: "pi",
    model: "task-model",
    reasoning_level: "low",
    service_tier: "default",
    permission_mode: "accept_edits",
  });

  const other = await harness.behavior.callRpc("createTask", {
    request: { text: "prompt", projectId: "proj_1", workflowType: "freeform", worktreeTiming: "never", permissionMode: "default", autoAdvance: false },
    name: "Other",
    draft: true,
  }) as { taskId: string };
  const otherIntent = { kind: "skill" as const, taskId: other.taskId, skillId: "create-research" };
  const otherPrepared = await harness.behavior.callRpc("prepareManualLaunch", { intent: otherIntent }) as { stateToken: string };
  const rejected = await harness.behavior.callRpc("submitManualLaunch", {
    intent: otherIntent,
    stateToken: otherPrepared.stateToken,
    request: { ...request, projectId: "proj_other" },
  }) as { status: string; rejection?: { code: string; message: string } };
  assert.equal(rejected.status, "rejected");
  assert.equal(rejected.rejection?.code, "project_mismatch");
  assert.match(rejected.rejection?.message ?? "", /different project/);
  assert.equal(spawnInputs.length, 1);
  assert.equal((bb.storage.database().prepare("SELECT COUNT(*) AS count FROM launch_attempts WHERE task_id = ?").get(other.taskId) as { count: number }).count, 0);

  await assert.rejects(harness.behavior.callRpc("prepareManualLaunch", {
    intent: { kind: "skill", taskId: other.taskId, skillId: "create-research", extra: true },
  }));

  for (const kind of ["draft", "skill"] as const) {
    const deleted = await harness.behavior.callRpc("createTask", {
      request: { text: "prompt", projectId: "proj_1", workflowType: "freeform", worktreeTiming: "never", permissionMode: "default", autoAdvance: false },
      name: `Deleted ${kind}`,
      draft: true,
    }) as { taskId: string };
    const deletedIntent = kind === "draft"
      ? { kind, taskId: deleted.taskId }
      : { kind, taskId: deleted.taskId, skillId: "create-research" };
    const deletedPrepared = await harness.behavior.callRpc("prepareManualLaunch", { intent: deletedIntent }) as {
      stateToken: string;
      projectId: string;
      environment: typeof request.environment;
    };
    await harness.behavior.callRpc("deleteTask", { taskId: deleted.taskId });
    const deletedResult = await harness.behavior.callRpc("submitManualLaunch", {
      intent: deletedIntent,
      stateToken: deletedPrepared.stateToken,
      request: { ...request, projectId: deletedPrepared.projectId, environment: deletedPrepared.environment },
    }) as { status: string; rejection?: { code: string } };
    assert.equal(deletedResult.status, "rejected");
    assert.equal(deletedResult.rejection?.code, "stale_intent");
  }
  assert.equal(spawnInputs.length, 1);
});

test("artifact context tools select a bounded manifest and page exact revisions", async () => {
  const thread = makeThreadResponse({ id: "thr_context", environmentId: "env_1", projectId: "proj_1", originPluginId: "rpi" });
  const { bb, harness } = createFakePluginHost({
    pluginId: "rpi",
    sdk: {
      subscribe: () => () => undefined,
      projects: {
        get: async ({ projectId }: { projectId: string }) => ({
          id: projectId,
          name: "Proj",
          kind: "standard" as const,
          gitRemoteUrl: null,
          createdAt: 1,
          updatedAt: 1,
          sources: [{ id: "src_1", projectId, hostId: "host_seed", path: "/repo", type: "local_path" as const, isDefault: true, createdAt: 1, updatedAt: 1 }],
        }),
      },
      threads: {
        spawn: async () => thread,
        get: async () => ({ ...thread, environment: { id: "env_1", path: "/repo", branchName: "feature/context", status: "ready" } }),
        interactions: { list: async () => [] },
      },
    },
  });
  await plugin(bb);
  const created = await harness.behavior.callRpc("createTask", {
    request: { text: "prompt", projectId: "proj_1", workflowType: "rpi", worktreeTiming: "never", permissionMode: "default", autoAdvance: false },
    name: "Task",
    draft: true,
  }) as { taskId: string };
  for (let index = 1; index <= 30; index += 1) {
    await harness.behavior.callRpc("saveArtifact", {
      taskId: created.taskId,
      fileName: `${String(index).padStart(2, "0")}-research-topic-${index}.md`,
      content: `---\ntype: research\nsummary: Topic ${index}.\n---\n# Topic ${index}\nbody`,
    });
  }
  await harness.behavior.callRpc("saveArtifact", {
    taskId: created.taskId,
    fileName: "99-plan-current.md",
    content: "---\ntype: plan\nsummary: Current plan.\n---\n# Plan\nintro\n## Phase 1\nwork\n## Phase 2\nlater",
  });
  await harness.behavior.callRpc("launchSkill", {
    taskId: created.taskId,
    skillId: "implement-plan",
    commandLine: "/rpi-implement-plan @99-plan-current.md",
  });
  bb.storage.database().prepare("UPDATE sessions SET hydrated_at = 1 WHERE thread_id = 'thr_context'").run();
  await harness.behavior.emitThreadEvent("thread.active", { thread: { ...thread, status: "active" } });

  const context = JSON.parse(toolText(await harness.behavior.callAgentTool("rpi_task_context", {}, { threadId: "thr_context", projectId: "proj_1" }))) as {
    artifacts: Array<{ name: string; version: number; sha256: string; reason: string }>;
    discovery: { total: number; selected: number; remaining: number };
    metrics: { emittedBytes: number };
    taskMd?: unknown;
  };
  assert.ok(context.artifacts.length <= 12);
  assert.deepEqual(context.artifacts[0]?.name, "99-plan-current.md");
  assert.equal(context.artifacts[0]?.reason, "command");
  assert.equal(context.artifacts[0]?.version, 1);
  assert.ok(context.artifacts[0]?.sha256);
  assert.equal(context.discovery.total, 32);
  assert.ok(context.discovery.remaining > 0);
  assert.ok(context.metrics.emittedBytes > 0);
  assert.equal("taskMd" in context, false);

  const page = JSON.parse(toolText(await harness.behavior.callAgentTool("rpi_artifacts_list", { offset: 25, limit: 5 }, { threadId: "thr_context" }))) as {
    artifacts: unknown[];
    nextOffset: number | null;
  };
  assert.equal(page.artifacts.length, 5);
  assert.equal(page.nextOffset, 30);

  const read = JSON.parse(toolText(await harness.behavior.callAgentTool("rpi_artifact_read", {
    file_name: "99-plan-current.md",
    version: 1,
    heading: "Phase 1",
    max_chars: 100,
  }, { threadId: "thr_context" }))) as { content: string; complete: boolean; currentVersion: number; sha256: string };
  assert.equal(read.content, "## Phase 1\nwork");
  assert.equal(read.complete, true);
  assert.equal(read.currentVersion, 1);
  assert.ok(read.sha256);
  await harness.lifecycle.dispose();
});

test("numeric approval carries its target and predecessor receipt into each successor context", async () => {
  const spawnInputs: Array<Record<string, unknown>> = [];
  let spawnNumber = 0;
  const { bb, harness } = createFakePluginHost({
    pluginId: "rpi",
    sdk: {
      subscribe: () => () => undefined,
      projects: {
        get: async ({ projectId }: { projectId: string }) => ({
          id: projectId,
          name: "Proj",
          kind: "standard" as const,
          gitRemoteUrl: null,
          createdAt: 1,
          updatedAt: 1,
          sources: [{ id: "src_1", projectId, hostId: "host_seed", path: "/repo", type: "local_path" as const, isDefault: true, createdAt: 1, updatedAt: 1 }],
        }),
      },
      threads: {
        spawn: async (input) => {
          spawnInputs.push(input as unknown as Record<string, unknown>);
          spawnNumber += 1;
          return makeThreadResponse({ id: `thr_successor_${spawnNumber}`, environmentId: "env_1", projectId: "proj_1", originPluginId: "rpi" });
        },
        get: async ({ threadId }: { threadId: string }) => makeThreadResponse({ id: threadId, environmentId: "env_1", projectId: "proj_1", originPluginId: "rpi" }),
        interactions: { list: async () => [] },
      },
    },
  });
  await plugin(bb);
  const created = await harness.behavior.callRpc("createTask", {
    request: { text: "prompt", projectId: "proj_1", workflowType: "rpi", worktreeTiming: "never", permissionMode: "default", autoAdvance: false },
    name: "Task",
    draft: true,
  }) as { taskId: string };
  const db = bb.storage.database();
  await harness.behavior.callRpc("saveArtifact", {
    taskId: created.taskId,
    fileName: "01-plan.md",
    content: "---\ntype: plan\n---\n## Phase 1: One\n## Phase 2: Two\n## Phase 3: Three",
  });
  for (const [threadId, fileName, phase] of [["thr_source_one", "02-receipt-one.md", 1], ["thr_source_two", "03-receipt-two.md", 2]] as const) {
    await harness.behavior.callRpc("saveArtifact", {
      taskId: created.taskId,
      fileName,
      content: `---\ntype: implementation\ncompleted_phase: ${phase}\n---\n`,
    });
    db.prepare(`
      INSERT INTO sessions (
        thread_id, task_id, label, skill_id, launched_by, rpi_status, rpi_status_at,
        had_turn, hydrated_at, summary_json, completed_turn_key, next_step_turn_key,
        last_summarized_turn_key, created_at, updated_at
      ) VALUES (?, ?, 'implementation', 'implement-plan', 'user', 'ready_for_input', 1, 1, 1, ?, 'turn_1', 'turn_1', 'turn_1', 1, 1)
    `).run(threadId, created.taskId, JSON.stringify({ primaryReviewArtifact: { fileName } }));
  }

  const first = await harness.behavior.callRpc("launchCompletion", {
    intent: { kind: "completion", threadId: "thr_source_one", skillId: "implement-plan", phase: 2 },
  }) as { threadId: string };
  const second = await harness.behavior.callRpc("launchCompletion", {
    intent: { kind: "completion", threadId: "thr_source_two", skillId: "implement-plan", phase: 3 },
  }) as { threadId: string };
  assert.deepEqual([first.threadId, second.threadId], ["thr_successor_1", "thr_successor_2"]);
  assert.match(String(spawnInputs[0]!.prompt), /Approved continuation target: Phase 2/);
  assert.match(String(spawnInputs[1]!.prompt), /Approved continuation target: Phase 3/);
  assert.deepEqual(db.prepare("SELECT target_phase AS targetPhase FROM launch_attempts WHERE thread_id = 'thr_successor_1'").get(), { targetPhase: 2 });
  assert.deepEqual(db.prepare("SELECT target_phase AS targetPhase FROM launch_attempts WHERE thread_id = 'thr_successor_2'").get(), { targetPhase: 3 });

  const readContext = async (threadId: string) => JSON.parse(toolText(await harness.behavior.callAgentTool("rpi_task_context", {}, { threadId, projectId: "proj_1" }))) as {
    assignment: { approvedPhase: number | null; primaryReviewArtifact: string | null };
    artifacts: Array<{ name: string; reason: string }>;
  };
  const firstContext = await readContext(first.threadId);
  const secondContext = await readContext(second.threadId);
  assert.equal(firstContext.assignment.approvedPhase, 2);
  assert.equal(firstContext.assignment.primaryReviewArtifact, "02-receipt-one.md");
  assert.equal(secondContext.assignment.approvedPhase, 3);
  assert.equal(secondContext.assignment.primaryReviewArtifact, "03-receipt-two.md");
  assert.equal(firstContext.artifacts.find((artifact) => artifact.name === "02-receipt-one.md")?.reason, "previous-session");
  assert.equal(secondContext.artifacts.find((artifact) => artifact.name === "03-receipt-two.md")?.reason, "previous-session");
  await harness.lifecycle.dispose();
});

test("task context prefs follow the phase model", async () => {
  const thread = makeThreadResponse({ id: "thr_phase_model", environmentId: "env_1", projectId: "proj_1", originPluginId: "rpi" });
  const { bb, harness } = createFakePluginHost({
    pluginId: "rpi",
    sdk: {
      subscribe: () => () => undefined,
      projects: {
        get: async ({ projectId }: { projectId: string }) => ({
          id: projectId,
          name: "Proj",
          kind: "standard" as const,
          gitRemoteUrl: null,
          createdAt: 1,
          updatedAt: 1,
          sources: [{ id: "src_1", projectId, hostId: "host_seed", path: "/repo", type: "local_path" as const, isDefault: true, createdAt: 1, updatedAt: 1 }],
        }),
      },
      threads: {
        spawn: async () => thread,
        get: async () => ({ ...thread, environment: { id: "env_1", path: "/repo", branchName: "feature/context", status: "ready" } }),
        interactions: { list: async () => [] },
      },
    },
  });
  await plugin(bb);
  const created = await harness.behavior.callRpc("createTask", {
    request: { text: "prompt", projectId: "proj_1", workflowType: "rpi", worktreeTiming: "never", permissionMode: "default", autoAdvance: false },
    name: "Task",
    draft: true,
  }) as { taskId: string };
  const db = bb.storage.database();
  await harness.behavior.callRpc("launchSkill", { taskId: created.taskId, skillId: "implement-plan" });
  db.prepare("UPDATE sessions SET hydrated_at = 1 WHERE thread_id = 'thr_phase_model'").run();
  await harness.behavior.emitThreadEvent("thread.active", {
    thread: { ...thread, id: "thr_phase_model", status: "active" },
  });

  const readPrefs = async () => JSON.parse(toolText(await harness.behavior.callAgentTool("rpi_task_context", {}, { threadId: "thr_phase_model", projectId: "proj_1" }))) as {
    prefs: { researchModel: string; researchSubagentModel: string; providerId: string | null; model: string | null };
  };

  // Without e2e mode or a phase entry, the output is the task's own model.
  const baseline = await readPrefs();
  assert.equal(baseline.prefs.providerId, null);
  assert.equal(baseline.prefs.model, null);

  // An explicit phase_models entry applies regardless of e2e mode.
  db.prepare("UPDATE tasks SET phase_models = ? WHERE id = ?").run(
    JSON.stringify({ implementation: { providerId: "codex", model: "gpt-explicit" } }),
    created.taskId,
  );
  const explicit = await readPrefs();
  assert.equal(explicit.prefs.providerId, "codex");
  assert.equal(explicit.prefs.model, "gpt-explicit");
  assert.equal(explicit.prefs.researchModel, "codex gpt-explicit");
  assert.equal(explicit.prefs.researchSubagentModel, "codex gpt-explicit");

  // With e2e mode on and no explicit entry, class defaults apply: implementation is fast,
  // code-review is reasoning.
  db.prepare("UPDATE tasks SET phase_models = NULL, e2e_mode = 1 WHERE id = ?").run(created.taskId);
  await harness.behavior.callRpc("setPrefs", {
    e2e: {
      fastModel: { providerId: "pi", model: "fast-one" },
      reasoningModel: { providerId: "pi", model: "reason-one", reasoningLevel: "high" },
    },
  });
  const fast = await readPrefs();
  assert.equal(fast.prefs.providerId, "pi");
  assert.equal(fast.prefs.model, "fast-one");
  assert.equal(fast.prefs.researchModel, "pi fast-one");

  db.prepare("UPDATE sessions SET label = 'code-review', skill_id = 'review-code' WHERE thread_id = 'thr_phase_model'").run();
  await harness.behavior.emitThreadEvent("thread.active", {
    thread: { ...thread, id: "thr_phase_model", status: "active" },
  });
  const reasoning = await readPrefs();
  assert.equal(reasoning.prefs.providerId, "pi");
  assert.equal(reasoning.prefs.model, "reason-one");
  assert.equal(reasoning.prefs.researchModel, "pi reason-one");

  // With e2e mode off the class defaults never apply, even with prefs set.
  db.prepare("UPDATE tasks SET e2e_mode = 0 WHERE id = ?").run(created.taskId);
  const off = await readPrefs();
  assert.equal(off.prefs.providerId, null);
  assert.equal(off.prefs.model, null);
  await harness.lifecycle.dispose();
});

test("saveScratchPad is compare-and-swap on revision: stale write conflicts and reloads server text", async () => {
  const { bb, harness } = createFakePluginHost({
    pluginId: "rpi",
    sdk: { subscribe: () => () => undefined },
  });
  await plugin(bb);
  const created = await harness.behavior.callRpc("createTask", {
    request: { text: "prompt", projectId: "proj_1", workflowType: "freeform", worktreeTiming: "never", permissionMode: "default", autoAdvance: false },
    name: "Task",
    draft: true,
  }) as { taskId: string };

  const initial = await harness.behavior.callRpc("getTaskUiState", { taskId: created.taskId }) as { scratch?: string; scratchRevision?: number };
  assert.equal(initial.scratch, "");
  assert.equal(initial.scratchRevision, 0);

  const saved = await harness.behavior.callRpc("saveScratchPad", {
    taskId: created.taskId,
    text: "first note",
    expectedRevision: 0,
  }) as { outcome: string; scratch?: string; scratchRevision?: number };
  assert.equal(saved.outcome, "saved");
  assert.equal(saved.scratch, "first note");
  assert.equal(saved.scratchRevision, 1);

  // Simulate a second tab racing on the stale (pre-save) revision.
  const stale = await harness.behavior.callRpc("saveScratchPad", {
    taskId: created.taskId,
    text: "stale note from tab two",
    expectedRevision: 0,
  }) as { outcome: string; scratch?: string; scratchRevision?: number };
  assert.equal(stale.outcome, "conflict");
  // Conflict response carries the current server copy so the caller can reload instead of guessing.
  assert.equal(stale.scratch, "first note");
  assert.equal(stale.scratchRevision, 1);

  // A save against the correct current revision still succeeds afterward.
  const retried = await harness.behavior.callRpc("saveScratchPad", {
    taskId: created.taskId,
    text: "second note",
    expectedRevision: 1,
  }) as { outcome: string; scratch?: string; scratchRevision?: number };
  assert.equal(retried.outcome, "saved");
  assert.equal(retried.scratch, "second note");
  assert.equal(retried.scratchRevision, 2);

  await harness.lifecycle.dispose();
});

test("listSessions never makes a per-session SDK call; getSession still fetches live contextUsage", async () => {
  const { bb, harness } = createFakePluginHost({
    pluginId: "rpi",
    sdk: {
      subscribe: () => () => undefined,
      threads: {
        get: async ({ threadId }: { threadId: string }) => ({ id: threadId, title: "Some thread", titleFallback: null, updatedAt: 42, environment: { path: "/repo" } }),
        timeline: async () => ({ contextWindowUsage: { usedTokens: 100, modelContextWindow: 1000, estimated: false } }),
        interactions: { list: async () => [] },
      },
    },
  });
  await plugin(bb);
  const created = await harness.behavior.callRpc("createTask", {
    request: { text: "prompt", projectId: "proj_1", workflowType: "freeform", worktreeTiming: "never", permissionMode: "default", autoAdvance: false },
    name: "Task",
    draft: true,
  }) as { taskId: string };

  const db = bb.storage.database();
  for (let index = 0; index < 5; index += 1) {
    db.prepare(`
      INSERT INTO sessions (
        thread_id, task_id, label, skill_id, launched_by, forked_from_thread_id,
        rpi_status, rpi_status_at, had_turn, interrupted, blocked_reason, created_at, updated_at
      ) VALUES (?, ?, NULL, NULL, 'user', NULL, 'ready_for_input', 1, 1, 0, NULL, 1, 1)
    `).run(`thr_${index}`, created.taskId);
  }

  const before = harness.inspection.sdk.callsTo("threads.get").length + harness.inspection.sdk.callsTo("threads.timeline").length;
  const listed = await harness.behavior.callRpc("listSessions", { taskId: created.taskId }) as { sessions: Array<{ threadId: string }> };
  const after = harness.inspection.sdk.callsTo("threads.get").length + harness.inspection.sdk.callsTo("threads.timeline").length;
  assert.equal(listed.sessions.length, 5);
  assert.equal(after, before, "listSessions must not call threads.get or threads.timeline per session");

  const beforeGet = harness.inspection.sdk.callsTo("threads.get").length;
  const beforeTimeline = harness.inspection.sdk.callsTo("threads.timeline").length;
  await harness.behavior.callRpc("getSession", { threadId: "thr_0" });
  assert.equal(harness.inspection.sdk.callsTo("threads.get").length, beforeGet + 1, "getSession fetches the thread directly");
  assert.equal(harness.inspection.sdk.callsTo("threads.timeline").length, beforeTimeline + 1, "getSession fetches live contextUsage directly");

  await harness.lifecycle.dispose();
});

test("launchSkill rejects while a launch_attempt for the task is already pending (item 5 duplicate-launch guard)", async () => {
  let spawns = 0;
  const { bb, harness } = createFakePluginHost({
    pluginId: "rpi",
    sdk: {
      subscribe: () => () => undefined,
      projects: {
        get: async ({ projectId }: { projectId: string }) => ({
          id: projectId,
          name: "Proj",
          kind: "standard" as const,
          gitRemoteUrl: null,
          createdAt: 1,
          updatedAt: 1,
          sources: [{ id: "src_1", projectId, hostId: "host_seed", path: "/repo", type: "local_path" as const, isDefault: true, createdAt: 1, updatedAt: 1 }],
        }),
      },
      threads: {
        spawn: async () => {
          spawns += 1;
          return { id: `thr_launch_${spawns}`, environmentId: "env_1" };
        },
        get: async ({ threadId }: { threadId: string }) => ({ id: threadId, environmentId: "env_1", title: "thread", titleFallback: null, updatedAt: 1, environment: { path: "/repo" } }),
        interactions: { list: async () => [] },
      },
    },
  });
  await plugin(bb);
  const created = await harness.behavior.callRpc("createTask", {
    request: { text: "prompt", projectId: "proj_1", workflowType: "freeform", worktreeTiming: "never", permissionMode: "default", autoAdvance: false },
    name: "Task",
    draft: true,
  }) as { taskId: string };

  // Simulate "a launch_attempt for this task is already pending": exactly the state
  // listLaunchAttempts surfaces to the Suggested-next button so it can disable itself.
  const db = bb.storage.database();
  db.prepare("INSERT INTO launch_attempts (id, task_id, from_thread_id, skill_id, status, thread_id, created_at) VALUES (?, ?, NULL, 'create-research', 'pending', NULL, ?)").run("attempt_1", created.taskId, Date.now());

  await assert.rejects(
    harness.behavior.callRpc("launchSkill", { taskId: created.taskId, skillId: "create-research" }),
    /Resolve launch attempt/,
  );
  assert.equal(spawns, 0, "launchSkill must not spawn while a launch_attempt for this task is pending");
  await harness.lifecycle.dispose();
});

test("createTask stores a composer reuse environment as the task base environment and rejects a stale one", async (t) => {
  const { bb, harness } = createFakePluginHost({
    pluginId: "rpi",
    sdk: {
      subscribe: () => () => undefined,
      environments: {
        get: async ({ environmentId }: { environmentId: string }) => {
          if (environmentId !== "env_good") throw new Error(`No such environment: ${environmentId}`);
          return { id: environmentId, hostId: "host_1", status: "ready" };
        },
      },
    },
  });
  t.after(() => harness.lifecycle.dispose());
  await plugin(bb);

  const created = await harness.behavior.callRpc("createTask", {
    request: {
      text: "Reuse base",
      projectId: "proj_1",
      workflowType: "freeform",
      worktreeTiming: "never",
      baseEnvironmentId: "env_good",
      autoAdvance: false,
    },
    draft: true,
  }) as { taskId: string };
  const db = bb.storage.database();
  assert.equal(
    (db.prepare("SELECT base_environment_id FROM tasks WHERE id = ?").get(created.taskId) as { base_environment_id: string | null }).base_environment_id,
    "env_good",
  );

  await assert.rejects(
    harness.behavior.callRpc("createTask", {
      request: {
        text: "Stale base",
        projectId: "proj_1",
        workflowType: "freeform",
        worktreeTiming: "never",
        baseEnvironmentId: "env_gone",
        autoAdvance: false,
      },
      draft: true,
    }),
    /No such environment/,
  );
  await harness.lifecycle.dispose();
});

async function waitFor(check: () => boolean, what: string, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs;
  while (!check()) {
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

// emitThreadEvent ships in the testing runtime but is missing from the bundled lifecycle types.
const emitThreadEvent = (lifecycle: unknown) => lifecycle as {
  emitThreadEvent: (event: "thread.idle", payload: { thread: Record<string, unknown>; lastAssistantText: string }) => Promise<unknown>;
};

test("advance failure on a full-auto task retries before notifying", async (t) => {
  const spawnInputs: Array<Record<string, unknown>> = [];
  let failProjectGet = false;
  const { bb, harness } = createFakePluginHost({
    pluginId: "rpi",
    sdk: {
      subscribe: () => () => undefined,
      projects: {
        get: async ({ projectId }: { projectId: string }) => {
          if (failProjectGet) {
            failProjectGet = false;
            throw new Error("host unreachable");
          }
          return {
            id: projectId,
            name: "Proj",
            kind: "standard" as const,
            gitRemoteUrl: null,
            createdAt: 1,
            updatedAt: 1,
            sources: [{ id: "src_1", projectId, hostId: "host_seed", path: "/repo", type: "local_path" as const, isDefault: true, createdAt: 1, updatedAt: 1 }],
          };
        },
      },
      threads: {
        spawn: async (input) => {
          spawnInputs.push(input as unknown as Record<string, unknown>);
          return makeThreadResponse({ id: `thr_s_${spawnInputs.length}`, environmentId: "env_1", projectId: "proj_1", originPluginId: "rpi" });
        },
        get: async ({ threadId }: { threadId: string }) => makeThreadResponse({ id: threadId, environmentId: "env_1", projectId: "proj_1", originPluginId: "rpi" }),
        interactions: { list: async () => [] },
        events: { list: async () => [] },
        timeline: async () => ({ rows: [] }),
      },
    },
  });
  t.after(() => harness.lifecycle.dispose());
  await plugin(bb);
  const db = bb.storage.database();

  const createE2eTask = async () => {
    const created = await harness.behavior.callRpc("createTask", {
      request: {
        text: "prompt",
        projectId: "proj_1",
        workflowType: "rpi",
        worktreeTiming: "never",
        permissionMode: "accept_edits",
        autoAdvance: false,
        e2eMode: true,
      },
      draft: true,
    }) as { taskId: string };
    // Launch the implementation phase through the plugin itself so the session is bound in the
    // runtime's mirror the way a real launch is; the idle event then drives the full pipeline.
    await harness.behavior.callRpc("launchSkill", { taskId: created.taskId, skillId: "implement-plan" });
    return created.taskId;
  };
  const completedTurnCount = (taskId: string) =>
    (db.prepare("SELECT COUNT(*) AS count FROM launch_attempts WHERE task_id = ?").get(taskId) as { count: number }).count;

  // Scenario 1: the advance's pre-spawn failure is auto-retried; the recovery notification must
  // not fire because the retry launched. The launch stored a base environment on the task, so
  // clear it to force the advance's environment selection through the failing pre-spawn path.
  const taskOne = await createE2eTask();
  db.prepare("UPDATE tasks SET base_environment_id = NULL WHERE id = ?").run(taskOne);
  failProjectGet = true;
  await emitThreadEvent(harness.lifecycle).emitThreadEvent("thread.idle", {
    thread: { id: "thr_s_1", numEvents: 2, updatedAt: 2 },
    lastAssistantText: "Phase 1 done.\n```text\n/rpi-describe-pr\n```",
  });
  await waitFor(() => completedTurnCount(taskOne) === 3, "the auto-retried attempt");
  const attempts = db.prepare(
    "SELECT id, status, launched_by AS launchedBy, retried_from AS retriedFrom FROM launch_attempts WHERE task_id = ? ORDER BY created_at, rowid"
  ).all(taskOne) as Array<{ id: string; status: string; launchedBy: string; retriedFrom: string | null }>;
  assert.deepEqual(attempts.map((attempt) => [attempt.launchedBy, attempt.status, attempt.retriedFrom === null]), [
    ["user", "spawned", true],
    ["auto_advance", "failed", true],
    ["auto_advance", "spawned", false],
  ]);
  assert.equal(attempts[2]!.retriedFrom, attempts[1]!.id);
  assert.equal((spawnInputs[1] as { permissionMode?: string }).permissionMode, "full");
  assert.equal(
    (db.prepare("SELECT COUNT(*) AS count FROM notifications WHERE kind = 'ready_after_failed_advance'").get() as { count: number }).count,
    0,
  );

  // Scenario 2: at the retry cap the recovery notification fires instead.
  await harness.behavior.callRpc("setPrefs", { e2e: { maxRetries: 0 } });
  const taskTwo = await createE2eTask();
  db.prepare("UPDATE tasks SET base_environment_id = NULL WHERE id = ?").run(taskTwo);
  failProjectGet = true;
  await emitThreadEvent(harness.lifecycle).emitThreadEvent("thread.idle", {
    thread: { id: "thr_s_3", numEvents: 2, updatedAt: 3 },
    lastAssistantText: "Phase 1 done.\n```text\n/rpi-describe-pr\n```",
  });
  await waitFor(() => completedTurnCount(taskTwo) === 2, "the capped task's failed attempt");
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.equal(
    (db.prepare("SELECT COUNT(*) AS count FROM launch_attempts WHERE task_id = ? AND status = 'failed'").get(taskTwo) as { count: number }).count,
    1,
  );
  assert.equal(
    (db.prepare("SELECT COUNT(*) AS count FROM notifications WHERE kind = 'ready_after_failed_advance' AND thread_id = 'thr_s_3'").get() as { count: number }).count,
    1,
  );
});
