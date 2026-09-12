import test from "node:test";
import assert from "node:assert/strict";
import { findLegacyTaskDirTaskIds, mapSourceRefToBaseBranch, mergeWorkspaceConfigs, getWorkspaceView, validateWorkspaceForWorktreeLaunch } from "../workspace";

test("sourceRef maps HEAD and branches and rejects SHAs or unsupported refs", () => {
  assert.deepEqual(mapSourceRefToBaseBranch(undefined), { kind: "default" });
  assert.deepEqual(mapSourceRefToBaseBranch("HEAD"), { kind: "default" });
  assert.deepEqual(mapSourceRefToBaseBranch("origin/main"), { kind: "named", name: "main" });
  assert.deepEqual(mapSourceRefToBaseBranch("feature-x"), { kind: "named", name: "feature-x" });
  assert.deepEqual(mapSourceRefToBaseBranch("feature/x"), { kind: "named", name: "feature/x" });
  assert.throws(() => mapSourceRefToBaseBranch("abc1234"), /cannot be a SHA/);
  assert.throws(() => mapSourceRefToBaseBranch("refs/heads/main"), /is not a branch name/);
});

test("workspace config local overrides scalars, repos, copy globs, and delete patches", () => {
  const merged = mergeWorkspaceConfigs(
    {
      sourceRef: "origin/main",
      setupCommand: "npm install",
      copyGlobs: [".env"],
      repos: [
        { localPath: "/repo/a", primary: true, setupCommand: "a", copyGlobs: ["a.env"] },
        { localPath: "/repo/b", primary: false },
      ],
    },
    {
      sourceRef: "feature",
      copyGlobs: [".env", ".local"],
      repos: [
        { localPath: "/repo/a", description: "primary", copyGlobs: ["a.env", "a.local"] },
        { localPath: "/repo/b", $patch: "delete" },
      ],
    },
  );
  assert.deepEqual(merged.copyGlobs, [".env", ".local"]);
  assert.equal(merged.sourceRef, "feature");
  assert.deepEqual(merged.repos, [{ localPath: "/repo/a", primary: true, setupCommand: "a", copyGlobs: ["a.env", "a.local"], description: "primary" }]);
});

test("workspace view reports exactly-one-primary warnings and provisioning event kinds", async () => {
  const task = {
    id: "task_1",
    projectId: "proj_1",
    name: "Task",
    slug: "task",
    draftPrompt: "prompt",
    workflowType: "rpi",
    worktreeTiming: "later",
    isDraft: false,
    archived: false,
    completed: false,
    hostId: "host_1",
    baseEnvironmentId: "env_1",
    worktreeEnvironmentId: "env_2",
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
    e2eMode: false,
    parentTaskId: null,
    dependsOn: [] as string[],
    position: null,
    epicPaused: false,
    maxParallel: null,
    phaseModels: {},
    composerEnvironment: null,
    createdAt: 1,
    updatedAt: 1,
  } as const;
  const db = {
    prepare: () => ({
      get: () => ({ threadId: "thr_worktree" }),
      all: () => [],
    }),
  };
  const bb = {
    sdk: {
      environments: {
        get: async () => ({ id: "env_2", status: "provisioning", path: "/repo/a", branchName: "task", baseBranch: "main", workspaceProvisionType: "managed-worktree" }),
      },
      files: {
        read: async ({ path }: { path: string }) => {
          if (path.endsWith("workspace.json")) return { content: JSON.stringify({ repos: [{ localPath: "/repo/a" }, { localPath: "/repo/b" }] }) };
          throw new Error("missing");
        },
      },
      threads: {
        events: {
          list: async () => [
            { seq: 1, createdAt: 2, data: { status: "active", entries: [{ type: "step", key: "copy_globs", status: "started", text: "copy" }] } },
          ],
        },
      },
    },
  };
  const view = await getWorkspaceView(bb as never, db as never, task);
  assert.equal(view.environment.status, "provisioning");
  assert.equal(view.warnings.includes("Workspace config must mark exactly one primary repo."), true);
  assert.deepEqual(view.provisioningEventKinds, ["system/thread-provisioning", "step:copy_globs:started"]);
});

test("workspace view merges root .local.json overrides", async () => {
  const task = {
    id: "task_1",
    projectId: "proj_1",
    name: "Task",
    slug: "task",
    draftPrompt: "prompt",
    workflowType: "rpi",
    worktreeTiming: "later",
    isDraft: false,
    archived: false,
    completed: false,
    hostId: "host_1",
    baseEnvironmentId: "env_1",
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
    e2eMode: false,
    parentTaskId: null,
    dependsOn: [] as string[],
    position: null,
    epicPaused: false,
    maxParallel: null,
    phaseModels: {},
    composerEnvironment: null,
    createdAt: 1,
    updatedAt: 1,
  } as const;
  const db = { prepare: () => ({ get: () => null, all: () => [] }) };
  const bb = {
    sdk: {
      environments: {
        get: async () => ({ id: "env_1", status: "ready", path: "/repo", branchName: "main", baseBranch: null, workspaceProvisionType: "unmanaged" }),
      },
      files: {
        read: async ({ path }: { path: string }) => {
          if (path.endsWith(".rpi/workspace.json")) return { content: JSON.stringify({ sourceRef: "origin/main", copyGlobs: [".env"] }) };
          if (path.endsWith(".local.json")) return { content: JSON.stringify({ sourceRef: "feature/live", copyGlobs: [".env", ".env.local"] }) };
          throw new Error("missing");
        },
      },
      threads: { events: { list: async () => [] } },
    },
  };
  const view = await getWorkspaceView(bb as never, db as never, task);
  assert.equal(view.sourceRef, "feature/live");
  assert.deepEqual(view.copyGlobs, [".env", ".env.local"]);
});

test("workspace config reads are rooted under .rpi and invalid config is surfaced as absent", async () => {
  const task = {
    id: "task_1",
    projectId: "proj_1",
    name: "Task",
    slug: "task",
    draftPrompt: "prompt",
    workflowType: "rpi",
    worktreeTiming: "later",
    isDraft: false,
    archived: false,
    completed: false,
    hostId: "host_1",
    baseEnvironmentId: "env_1",
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
    e2eMode: false,
    parentTaskId: null,
    dependsOn: [] as string[],
    position: null,
    epicPaused: false,
    maxParallel: null,
    phaseModels: {},
    composerEnvironment: null,
    createdAt: 1,
    updatedAt: 1,
  } as const;
  const reads: Array<{ rootPath?: string; path: string }> = [];
  const db = { prepare: () => ({ get: () => null, all: () => [] }) };
  const bb = {
    sdk: {
      environments: {
        get: async () => ({ id: "env_1", status: "ready", path: "/repo", branchName: "main", baseBranch: null, workspaceProvisionType: "unmanaged" }),
      },
      files: {
        read: async (input: { rootPath?: string; path: string }) => {
          reads.push(input);
          if (input.path === "workspace.json") return { content: JSON.stringify({ repos: new Array(33).fill({ localPath: "/repo/a", primary: true }) }) };
          throw new Error("missing");
        },
      },
      threads: { events: { list: async () => [] } },
    },
  };
  const view = await getWorkspaceView(bb as never, db as never, task);
  assert.deepEqual(reads.map((read) => read.rootPath), ["/repo/.rpi", "/repo/.rpi"]);
  assert.equal(reads[0]?.path, "workspace.json");
  assert.equal(reads[1]?.path, ".local.json");
  assert.match(view.error ?? "", /workspace\.json/);
  assert.deepEqual(view.repos, [{ localPath: "/repo", description: null, primary: true, sourceRef: null, setupCommand: null, copyGlobs: [] }]);
});

test("workspace validation rejects invalid sourceRef for worktree launches", async () => {
  const bb = {
    sdk: {
      files: {
        read: async ({ path }: { path: string }) => {
          if (path === "workspace.json") return { content: JSON.stringify({ sourceRef: "refs/heads/main" }) };
          throw new Error("missing");
        },
      },
    },
  };
  await assert.rejects(
    () => validateWorkspaceForWorktreeLaunch(bb as never, { hostId: "host_1", defaultDirectory: "/repo", worktreeTiming: "later" }),
    /not a branch name/,
  );
});

test("findLegacyTaskDirTaskIds is a no-op unless RPI_LEGACY_TASK_ROOT_DIR is set", async () => {
  const bb = { sdk: { environments: { get: async () => ({ path: "/repo" }) }, files: { listPaths: async () => [] } } };
  const previous = process.env.RPI_LEGACY_TASK_ROOT_DIR;
  delete process.env.RPI_LEGACY_TASK_ROOT_DIR;
  try {
    const found = await findLegacyTaskDirTaskIds(bb as never, [{ id: "task_1", slug: "task", baseEnvironmentId: "env_1" }]);
    assert.deepEqual(found, []);
  } finally {
    if (previous !== undefined) process.env.RPI_LEGACY_TASK_ROOT_DIR = previous;
  }
});

test("findLegacyTaskDirTaskIds flags a task with the legacy dir but no current dir", async () => {
  const previous = process.env.RPI_LEGACY_TASK_ROOT_DIR;
  process.env.RPI_LEGACY_TASK_ROOT_DIR = ".legacy-marker";
  try {
    const bb = {
      sdk: {
        environments: { get: async () => ({ path: "/repo" }) },
        files: {
          listPaths: async ({ path }: { path: string }) => {
            if (path.startsWith(".legacy-marker/")) return [];
            throw new Error("not found");
          },
        },
      },
    };
    const tasks = [
      { id: "task_legacy", slug: "legacy-task", baseEnvironmentId: "env_1" },
      { id: "task_no_env", slug: "no-env-task", baseEnvironmentId: null },
    ];
    const found = await findLegacyTaskDirTaskIds(bb as never, tasks as never);
    assert.deepEqual(found, ["task_legacy"]);
  } finally {
    if (previous === undefined) delete process.env.RPI_LEGACY_TASK_ROOT_DIR;
    else process.env.RPI_LEGACY_TASK_ROOT_DIR = previous;
  }
});
