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
