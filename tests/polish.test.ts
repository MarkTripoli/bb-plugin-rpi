import test from "node:test";
import assert from "node:assert/strict";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import plugin from "../server";

test("scratch pad round trips through task_ui_state without disturbing dismissed tips", async () => {
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

  await harness.behavior.callRpc("dismissTaskTip", { taskId: created.taskId, label: "research" });
  const afterScratch = await harness.behavior.callRpc("saveScratchPad", { taskId: created.taskId, text: "hello world", expectedRevision: 0 }) as { scratch?: string; scratchRevision?: number; dismissedTips?: Record<string, boolean> };
  assert.equal(afterScratch.scratch, "hello world");
  assert.equal(afterScratch.scratchRevision, 1);
  assert.equal(afterScratch.dismissedTips?.research, true, "saving scratch must not drop other task_ui_state fields");

  const refetched = await harness.behavior.callRpc("getTaskUiState", { taskId: created.taskId }) as { scratch?: string };
  assert.equal(refetched.scratch, "hello world");

  const overwritten = await harness.behavior.callRpc("saveScratchPad", { taskId: created.taskId, text: "", expectedRevision: 1 }) as { scratch?: string };
  assert.equal(overwritten.scratch, "");
  await harness.lifecycle.dispose();
});

test("context warning dismissal is scoped per thread within one task", async () => {
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

  const state = await harness.behavior.callRpc("dismissContextWarning", { taskId: created.taskId, threadId: "thr_a" }) as { contextWarningDismissed?: Record<string, boolean> };
  assert.deepEqual(state.contextWarningDismissed, { thr_a: true });
  const again = await harness.behavior.callRpc("getTaskUiState", { taskId: created.taskId }) as { contextWarningDismissed?: Record<string, boolean> };
  assert.equal(again.contextWarningDismissed?.thr_a, true);
  assert.equal(again.contextWarningDismissed?.thr_b, undefined);
  await harness.lifecycle.dispose();
});

test("getSession reports context usage percent from threads.timeline summaryOnly, and null on failure", async () => {
  const { bb, harness } = createFakePluginHost({
    pluginId: "humanlayer",
    sdk: {
      subscribe: () => () => undefined,
      threads: {
        timeline: async ({ threadId }: { threadId: string }) => {
          if (threadId === "thr_high") {
            return { contextWindowUsage: { estimated: false, modelContextWindow: 100, usedTokens: 71 } };
          }
          if (threadId === "thr_zero") {
            return { contextWindowUsage: { estimated: false, modelContextWindow: 0, usedTokens: 0 } };
          }
          throw new Error("no usage reported yet");
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
  const db = bb.storage.database();
  for (const threadId of ["thr_high", "thr_zero", "thr_missing"]) {
    db.prepare(`
      INSERT INTO sessions (
        thread_id, task_id, label, skill_id, launched_by, forked_from_thread_id,
        hl_status, hl_status_at, had_turn, interrupted, blocked_reason,
        summary_json, created_at, updated_at
      ) VALUES (?, ?, NULL, NULL, 'user', NULL, 'ready_for_input', 1, 1, 0, NULL, NULL, 1, 1)
    `).run(threadId, created.taskId);
  }

  const high = await harness.behavior.callRpc("getSession", { threadId: "thr_high" }) as { session: { contextUsage: { percent: number; usedTokens: number; modelContextWindow: number } | null } };
  assert.ok(high.session.contextUsage);
  assert.equal(high.session.contextUsage!.usedTokens, 71);
  assert.equal(high.session.contextUsage!.percent, 0.71);

  const zero = await harness.behavior.callRpc("getSession", { threadId: "thr_zero" }) as { session: { contextUsage: unknown } };
  assert.equal(zero.session.contextUsage, null, "a zero context window must not divide by zero into a bogus percent");

  const missing = await harness.behavior.callRpc("getSession", { threadId: "thr_missing" }) as { session: { contextUsage: unknown } };
  assert.equal(missing.session.contextUsage, null, "a timeline lookup failure degrades to null instead of throwing");
  await harness.lifecycle.dispose();
});

test("setPrefs merges workflowDefaults per workflow type instead of replacing the whole map", async () => {
  const { bb, harness } = createFakePluginHost({
    pluginId: "humanlayer",
    sdk: { subscribe: () => () => undefined },
  });
  await plugin(bb);
  await harness.behavior.callRpc("setPrefs", { workflowDefaults: { rpi: { providerId: "anthropic", model: "claude" } } });
  const afterFirst = await harness.behavior.callRpc("getPrefs", {}) as { workflowDefaults: Record<string, { providerId?: string | null; model?: string | null; reasoningLevel?: string | null }> };
  assert.equal(afterFirst.workflowDefaults.rpi?.providerId, "anthropic");

  await harness.behavior.callRpc("setPrefs", { workflowDefaults: { oneshot: { providerId: "openai" } } });
  const afterSecond = await harness.behavior.callRpc("getPrefs", {}) as { workflowDefaults: Record<string, { providerId?: string | null; model?: string | null }> };
  assert.equal(afterSecond.workflowDefaults.rpi?.providerId, "anthropic", "an update to a different workflow type must not drop an earlier one");
  assert.equal(afterSecond.workflowDefaults.oneshot?.providerId, "openai");

  await harness.behavior.callRpc("setPrefs", { workflowDefaults: { rpi: { reasoningLevel: "high" } } });
  const afterThird = await harness.behavior.callRpc("getPrefs", {}) as { workflowDefaults: Record<string, { providerId?: string | null; reasoningLevel?: string | null }> };
  assert.equal(afterThird.workflowDefaults.rpi?.providerId, "anthropic", "a partial patch to one workflow type must not drop its other fields");
  assert.equal(afterThird.workflowDefaults.rpi?.reasoningLevel, "high");
  await harness.lifecycle.dispose();
});
