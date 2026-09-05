import test from "node:test";
import assert from "node:assert/strict";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import plugin from "../server";

test("sessions list CLI paginates and truncates summaries", async () => {
  const { bb, harness } = createFakePluginHost({
    pluginId: "humanlayer",
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
        hl_status, hl_status_at, had_turn, interrupted, blocked_reason,
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
    pluginId: "humanlayer",
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
      hl_status, hl_status_at, had_turn, interrupted, blocked_reason,
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
    pluginId: "humanlayer",
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
    pluginId: "humanlayer",
    sdk: {
      subscribe: () => () => undefined,
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
      hl_status, hl_status_at, had_turn, interrupted, blocked_reason,
      next_step_json, completed_turn_key, next_step_turn_key, created_at, updated_at
    ) VALUES ('thr_source', ?, 'research-questions', 'create-research-questions', 'user', NULL, 'ready_for_input', 1, 1, 0, NULL, ?, 'turn_1', 'turn_1', 1, 1)
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
