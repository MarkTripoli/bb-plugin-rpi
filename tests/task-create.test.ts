import test from "node:test";
import assert from "node:assert/strict";
import { composerEnvironmentToTaskLocation, composerRequestToTaskCreate, sdkPermissionModeToTaskPermissionMode } from "../task-create";
import { manualLaunchRequestSchema, type ManualLaunchRequest } from "../contract";
import type { NewThreadRequest } from "@get-bb/plugin-sdk/app";

function request(overrides: Partial<ManualLaunchRequest> = {}): ManualLaunchRequest {
  return {
    projectId: "proj_1",
    providerId: "prov_1",
    model: "model-1",
    reasoningLevel: "high",
    permissionMode: "auto",
    executionInputSources: {},
    environment: { type: "project-default" },
    input: [{ type: "text", text: "Fix the login redirect", mentions: [] }],
    ...overrides,
  } as unknown as ManualLaunchRequest;
}

const extras = { workflowType: "rpi" as const, worktreeTiming: "later" as const, autoAdvance: false, e2eMode: false };

test("maps text inputs to the task prompt", () => {
  const mapped = composerRequestToTaskCreate(request(), extras);
  assert.equal(mapped.text, "Fix the login redirect");
  assert.equal(mapped.projectId, "proj_1");
});

test("joins multiple text inputs and trims", () => {
  const mapped = composerRequestToTaskCreate(
    request({ input: [{ type: "text", text: "First part", mentions: [] }, { type: "text", text: "Second part", mentions: [] }] }),
    extras,
  );
  assert.equal(mapped.text, "First part\n\nSecond part");
});

test("ignores image and file inputs when extracting text", () => {
  const mapped = composerRequestToTaskCreate(
    request({ input: [{ type: "image", url: "https://example.test/a.png", visibility: "agent-only" }, { type: "text", text: "Describe this", mentions: [] }] } as never),
    extras,
  );
  assert.equal(mapped.text, "Describe this");
});

test("project-default environment contributes no host, directory, or base environment", () => {
  assert.deepEqual(composerEnvironmentToTaskLocation(request()), { hostId: null, defaultDirectory: null, baseEnvironmentId: null });
});

test("unmanaged host workspace maps to hostId and defaultDirectory", () => {
  const mapped = composerEnvironmentToTaskLocation(request({
    environment: { type: "host", hostId: "host_1", workspace: { type: "unmanaged", path: "/repo/checkout" } },
  }));
  assert.deepEqual(mapped, { hostId: "host_1", defaultDirectory: "/repo/checkout", baseEnvironmentId: null });
});

test("unmanaged workspace with null path maps to hostId only", () => {
  const mapped = composerEnvironmentToTaskLocation(request({
    environment: { type: "host", hostId: "host_1", workspace: { type: "unmanaged", path: null } },
  }));
  assert.deepEqual(mapped, { hostId: "host_1", defaultDirectory: null, baseEnvironmentId: null });
});

test("managed-worktree workspace maps to hostId only; the timing select owns worktree policy", () => {
  const mapped = composerEnvironmentToTaskLocation(request({
    environment: { type: "host", hostId: "host_1", workspace: { type: "managed-worktree", baseBranch: { kind: "named", name: "main" } } },
  }));
  assert.deepEqual(mapped, { hostId: "host_1", defaultDirectory: null, baseEnvironmentId: null });
});

test("reuse environment becomes the task base environment", () => {
  const mapped = composerEnvironmentToTaskLocation(request({ environment: { type: "reuse", environmentId: "env_1" } }));
  assert.deepEqual(mapped, { hostId: null, defaultDirectory: null, baseEnvironmentId: "env_1" });
});

test("provider environment reusing an existing machine maps to that host only", () => {
  const mapped = composerEnvironmentToTaskLocation(request({
    environment: {
      type: "provider",
      environmentProviderId: "personal-workspace",
      inputs: null,
      machine: { type: "existing", hostId: "host_1" },
    },
  }));
  assert.deepEqual(mapped, { hostId: "host_1", defaultDirectory: null, baseEnvironmentId: null });
});

test("provider environment provisioning a new machine maps to nothing", () => {
  const mapped = composerEnvironmentToTaskLocation(request({
    environment: { type: "provider", environmentProviderId: "cloud", inputs: null, machine: { type: "new", machineProviderId: "prov_2", inputs: null } },
  }));
  assert.deepEqual(mapped, { hostId: null, defaultDirectory: null, baseEnvironmentId: null });
});

test("only a provider environment is persisted as the composer environment intent", () => {
  const provider = composerRequestToTaskCreate(request({
    environment: {
      type: "provider",
      environmentProviderId: "personal-workspace",
      machine: { type: "existing", hostId: "host_1" },
      inputs: null,
    },
  }), extras);
  assert.equal(provider.composerEnvironment?.type, "provider");
  assert.equal(composerRequestToTaskCreate(request(), extras).composerEnvironment, null);
});

test("the schema accepts the provider environment bb 0.43.0 composers submit", () => {
  const parsed = manualLaunchRequestSchema.safeParse({
    projectId: "proj_personal",
    providerId: "codex",
    model: "gpt-5.6-sol",
    reasoningLevel: "xhigh",
    permissionMode: "full",
    serviceTier: "fast",
    executionInputSources: { providerId: "explicit" },
    environment: {
      type: "provider",
      environmentProviderId: "personal-workspace",
      machine: { type: "existing", hostId: "host_1" },
      inputs: null,
    },
    input: [{ type: "text", text: "instrumented repro", mentions: [] }],
  });
  assert.equal(parsed.success, true, parsed.success ? undefined : JSON.stringify(parsed.error.issues));
});

test("personal workspace contributes nothing", () => {
  const mapped = composerEnvironmentToTaskLocation(request({
    environment: { type: "host", workspace: { type: "personal" } },
  }));
  assert.deepEqual(mapped, { hostId: null, defaultDirectory: null, baseEnvironmentId: null });
});

test("extras flow through and execution selections pass through", () => {
  const mapped = composerRequestToTaskCreate(
    request({ permissionMode: "full", serviceTier: "fast" }),
    { workflowType: "oneshot", worktreeTiming: "now", autoAdvance: true, e2eMode: true },
  );
  assert.equal(mapped.workflowType, "oneshot");
  assert.equal(mapped.worktreeTiming, "now");
  assert.equal(mapped.autoAdvance, true);
  assert.equal(mapped.e2eMode, true);
  assert.equal(mapped.permissionMode, "bypass");
  assert.equal(mapped.serviceTier, "fast");
  assert.equal(mapped.providerId, "prov_1");
  assert.equal(mapped.model, "model-1");
  assert.equal(mapped.reasoningLevel, "high");
});

test("default extras keep e2e mode off", () => {
  const mapped = composerRequestToTaskCreate(request(), extras);
  assert.equal(mapped.e2eMode, false);
});

test("sdk permission vocabulary maps onto the task record vocabulary", () => {
  assert.equal(sdkPermissionModeToTaskPermissionMode("full"), "bypass");
  assert.equal(sdkPermissionModeToTaskPermissionMode("accept-edits"), "accept_edits");
  assert.equal(sdkPermissionModeToTaskPermissionMode("auto"), "auto");
});

test("the mapped shape satisfies the SDK NewThreadRequest source type", () => {
  // Structural guard: the mapper's input accepts what the composer actually submits.
  const sdkRequest: NewThreadRequest = {
    projectId: "proj_1",
    providerId: "prov_1",
    model: "model-1",
    reasoningLevel: "high",
    permissionMode: "auto",
    executionInputSources: {},
    environment: {
      type: "provider",
      environmentProviderId: "personal-workspace",
      machine: { type: "existing", hostId: "host_1" },
      inputs: null,
    },
    input: [{ type: "text", text: "Prompt", mentions: [] }],
  };
  const mapped = composerRequestToTaskCreate(request(sdkRequest as unknown as Partial<ManualLaunchRequest>), extras);
  assert.equal(mapped.text, "Prompt");
});
