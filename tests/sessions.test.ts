import test from "node:test";
import assert from "node:assert/strict";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import plugin from "../server";
import { deriveStatus } from "../sessions";

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
