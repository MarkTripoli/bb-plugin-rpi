import test from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { makeThreadResponse } from "@get-bb/plugin-sdk/testing";
import { MANUAL_LAUNCH_REQUEST_BYTES_LIMIT, manualLaunchRequestSchema, type ManualLaunchRequest } from "../contract";
import { MIGRATIONS } from "../db";
import { createDraftTask, getTask } from "../tasks";
import { launchDraft, launchPhase, LaunchRejectedError, listLaunchAdoptionCandidates, listLaunchAttempts, promoteStalePendingLaunchAttempts, resolveLaunchAttempt } from "../launch";
import { START_LINKED_TICKET_ACTION, TASK_CONTEXT_FIRST_ACTION } from "../instructions";
import { bindPendingLaunch, createLaunchBindingMirror, registerPendingLaunch, type SessionMirrorRow } from "../sessions";

function makeDb() {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  for (const statement of MIGRATIONS) db.exec(statement);
  return db;
}

function seedTask(db: Database.Database, workflowType: "freeform" | "rpi" = "freeform") {
  return createDraftTask(db, {
    projectId: "proj_1",
    prompt: "prompt",
    name: "Task",
    workflowType,
    worktreeTiming: "never",
    permissionMode: "default",
    autoAdvance: false,
    providerId: null,
    model: null,
    reasoningLevel: null,
    serviceTier: null,
  }).taskId;
}

function stubDefaultSource() {
  return { get: async () => ({ id: "proj_1", name: "Proj", kind: "standard" as const, gitRemoteUrl: null, createdAt: 1, updatedAt: 1, sources: [{ id: "src_1", projectId: "proj_1", hostId: "host_seed", path: "/repo", type: "local_path" as const, isDefault: true, createdAt: 1, updatedAt: 1 }] }) };
}

function manualRequest(input: ManualLaunchRequest["input"] = [{ type: "text", text: "edited prompt", mentions: [] }]): ManualLaunchRequest {
  return {
    projectId: "composer_project",
    providerId: "codex",
    model: "gpt-test",
    reasoningLevel: "high",
    permissionMode: "full",
    serviceTier: "fast",
    executionInputSources: {
      providerId: "explicit",
      model: "explicit",
      reasoningLevel: "explicit",
      permissionMode: "explicit",
      serviceTier: "client-preference",
    },
    environment: { type: "reuse", environmentId: "composer_env" },
    input,
    sendAt: 123_456,
  };
}

test("manual launch request validation is strict and bounded", () => {
  const request = manualRequest([{ type: "text", text: "@source", mentions: [{ start: 0, end: 7, resource: { kind: "thread", label: "source", threadId: "thr_source" } }] }]);
  assert.equal(manualLaunchRequestSchema.safeParse(request).success, true);
  assert.equal(manualLaunchRequestSchema.safeParse({ ...request, extra: true }).success, false);
  assert.equal(manualLaunchRequestSchema.safeParse(manualRequest([{ type: "text", text: "short", mentions: [{ start: 0, end: 6, resource: { kind: "thread", label: "source", threadId: "thr_source" } }] }])).success, false);

  const oversized = manualRequest(Array.from({ length: 64 }, (_, index) => ({ type: "image" as const, url: `${index}${"x".repeat(8190)}` })));
  assert.ok(new TextEncoder().encode(JSON.stringify(oversized)).byteLength > MANUAL_LAUNCH_REQUEST_BYTES_LIMIT);
  assert.equal(manualLaunchRequestSchema.safeParse(oversized).success, false);
});

test("a failed attempt not yet retried can be retried; an already-retried failed attempt cannot", async () => {
  const db = makeDb();
  const taskId = seedTask(db);
  db.prepare("INSERT INTO launch_attempts (id, task_id, from_thread_id, skill_id, command_line, label, environment_role, launched_by, status, thread_id, created_at) VALUES (?, ?, 'thr_source', 'setup-worktree', '/rpi-setup-worktree', 'worktree-setup', 'worktree', 'auto_advance', 'failed', NULL, ?)")
    .run("attempt_1", taskId, 1);
  let spawns = 0;
  const bb = {
    realtime: { publish: () => undefined },
    sdk: { projects: stubDefaultSource(), threads: { spawn: async () => { spawns += 1; return makeThreadResponse({ id: "thr_retry", environmentId: "env_1", projectId: "proj_1", originPluginId: "rpi" }); }, get: async () => makeThreadResponse({ id: "thr_retry", environmentId: "env_1", projectId: "proj_1", originPluginId: "rpi" }) } },
    log: { warn: () => undefined },
  };
  await resolveLaunchAttempt(bb as never, db, new Map(), createLaunchBindingMirror(), "attempt_1", { type: "retry" });
  assert.equal(spawns, 1);
  const attempts = db.prepare("SELECT id, status, retried_from AS retriedFrom FROM launch_attempts ORDER BY created_at, id").all() as Array<{ id: string; status: string; retriedFrom: string | null }>;
  assert.equal(attempts[0]!.status, "failed");
  assert.equal(attempts[1]!.status, "spawned");
  assert.equal(attempts[1]!.retriedFrom, "attempt_1");
  // The now-superseded failed attempt cannot be retried a second time.
  await resolveLaunchAttempt(bb as never, db, new Map(), createLaunchBindingMirror(), "attempt_1", { type: "retry" });
  assert.equal(spawns, 1);
  db.close();
});

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
      projects: stubDefaultSource(),
      threads: {
        spawn: async (input: { prompt: string }) => {
          prompt = input.prompt;
          return makeThreadResponse({ id: "thr_new", environmentId: "env_1", projectId: "proj_1", originPluginId: "rpi" });
        },
        get: async () => makeThreadResponse({ id: "thr_new", environmentId: "env_1", projectId: "proj_1", originPluginId: "rpi" }),
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
    completed: false,
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
    e2eMode: false,
    phaseModels: {},
    createdAt: 1,
    updatedAt: 1,
  }, { skillId: null, prompt: "do work", launchedBy: "user", fromThreadId: null });
  const lines = prompt.split("\n");
  assert.equal(lines[0], TASK_CONTEXT_FIRST_ACTION);
  assert.match(lines[lines.length - 1]!, /^<!-- rpi:launch:/);
  db.close();
});

test("structured launches preserve composer input and execution choices through retry", async () => {
  const db = makeDb();
  const taskId = seedTask(db);
  db.prepare("UPDATE tasks SET provider_id = 'pi', model = 'task-model', reasoning_level = 'low', service_tier = 'default', permission_mode = 'accept_edits' WHERE id = ?").run(taskId);
  const task = getTask(db, taskId)!.task;
  const request = manualRequest([
    {
      type: "text",
      text: "@source edited prompt",
      mentions: [{ start: 0, end: 7, resource: { kind: "thread", label: "source", projectId: "proj_1", threadId: "thr_source" } }],
    },
    { type: "localFile", path: "attachments/spec.pdf", name: "spec.pdf", mimeType: "application/pdf", sizeBytes: 1024 },
  ]);
  const spawnInputs: Array<Record<string, unknown>> = [];
  const bb = {
    realtime: { publish: () => undefined },
    sdk: {
      projects: stubDefaultSource(),
      threads: {
        spawn: async (input: Record<string, unknown>) => {
          spawnInputs.push(input);
          if (spawnInputs.length === 1) throw new Error("spawn response lost");
          return makeThreadResponse({ id: "thr_retry", environmentId: "env_1", projectId: "proj_1", originPluginId: "rpi" });
        },
        get: async () => makeThreadResponse({ id: "thr_retry", environmentId: "env_1", projectId: "proj_1", originPluginId: "rpi" }),
      },
    },
    log: { warn: () => undefined },
  };

  await assert.rejects(
    launchPhase(bb as never, db, new Map(), createLaunchBindingMirror(), task, {
      skillId: "create-research",
      launchedBy: "user",
      fromThreadId: "thr_source",
      request,
    }),
    /spawn response lost/,
  );
  const firstAttempt = db.prepare("SELECT id, request_json AS requestJson, status FROM launch_attempts WHERE task_id = ?").get(taskId) as { id: string; requestJson: string; status: string };
  assert.equal(firstAttempt.status, "uncertain");
  assert.deepEqual(JSON.parse(firstAttempt.requestJson), request);

  await resolveLaunchAttempt(bb as never, db, new Map(), createLaunchBindingMirror(), firstAttempt.id, { type: "retry" });
  assert.equal(spawnInputs.length, 2);
  for (const spawnInput of spawnInputs) {
    assert.equal(spawnInput.projectId, "proj_1");
    assert.deepEqual(spawnInput.environment, { type: "host", hostId: "host_seed", workspace: { type: "unmanaged", path: "/repo" } });
    assert.equal(spawnInput.providerId, request.providerId);
    assert.equal(spawnInput.model, request.model);
    assert.equal(spawnInput.reasoningLevel, request.reasoningLevel);
    assert.equal(spawnInput.permissionMode, request.permissionMode);
    assert.equal(spawnInput.serviceTier, request.serviceTier);
    assert.deepEqual(spawnInput.executionInputSources, request.executionInputSources);
    assert.equal(spawnInput.sendAt, request.sendAt);
    assert.equal("prompt" in spawnInput, false);
    const input = spawnInput.input as ManualLaunchRequest["input"];
    assert.deepEqual(input.slice(1, -1), request.input);
    assert.deepEqual(input[0], { type: "text", text: TASK_CONTEXT_FIRST_ACTION, mentions: [], visibility: "agent-only" });
    assert.match((input.at(-1) as { text: string }).text, /Task artifact directory: \.rpi\/tasks\/task[\s\S]+<!-- rpi:launch:/);
  }
  assert.notEqual((spawnInputs[0]!.input as Array<{ text?: string }>).at(-1)?.text, (spawnInputs[1]!.input as Array<{ text?: string }>).at(-1)?.text);

  const attempts = db.prepare("SELECT id, status, retried_from AS retriedFrom, request_json AS requestJson FROM launch_attempts").all() as Array<{ id: string; status: string; retriedFrom: string | null; requestJson: string }>;
  assert.equal(attempts.find((attempt) => attempt.id === firstAttempt.id)?.status, "failed");
  assert.equal(attempts.find((attempt) => attempt.retriedFrom === firstAttempt.id)?.status, "spawned");
  for (const attempt of attempts) assert.deepEqual(JSON.parse(attempt.requestJson), request);
  assert.ok(listLaunchAttempts(db, taskId).every((attempt) => !("requestJson" in attempt)));
  assert.deepEqual(db.prepare("SELECT provider_id, model, reasoning_level, service_tier, permission_mode FROM tasks WHERE id = ?").get(taskId), {
    provider_id: "pi",
    model: "task-model",
    reasoning_level: "low",
    service_tier: "default",
    permission_mode: "accept_edits",
  });
  db.close();
});

test("retry rejects corrupt stored structured requests instead of using task defaults", async () => {
  const db = makeDb();
  const taskId = seedTask(db);
  db.prepare("INSERT INTO launch_attempts (id, task_id, from_thread_id, skill_id, command_line, label, environment_role, launched_by, status, thread_id, request_json, created_at) VALUES ('attempt_1', ?, NULL, 'create-research', '/rpi-create-research', 'research', 'base', 'user', 'uncertain', NULL, '{bad json', 1)").run(taskId);
  let spawns = 0;
  const bb = { sdk: { threads: { spawn: async () => { spawns += 1; } } } };
  await assert.rejects(
    resolveLaunchAttempt(bb as never, db, new Map(), createLaunchBindingMirror(), "attempt_1", { type: "retry" }),
    /invalid JSON/,
  );
  assert.equal(spawns, 0);
  assert.deepEqual(db.prepare("SELECT status, retry_marker AS retryMarker FROM launch_attempts WHERE id = 'attempt_1'").get(), { status: "uncertain", retryMarker: null });
  assert.equal((db.prepare("SELECT COUNT(*) AS count FROM launch_attempts").get() as { count: number }).count, 1);
  db.close();
});

test("invalid structured requests fail before a launch attempt is inserted", async () => {
  const db = makeDb();
  const taskId = seedTask(db);
  const task = getTask(db, taskId)!.task;
  const request = manualRequest([{ type: "text", text: "x".repeat(10_001), mentions: [] }]) as ManualLaunchRequest;
  await assert.rejects(
    launchPhase({} as never, db, new Map(), createLaunchBindingMirror(), task, {
      skillId: null,
      launchedBy: "user",
      fromThreadId: null,
      request,
    }),
  );
  assert.equal((db.prepare("SELECT COUNT(*) AS count FROM launch_attempts").get() as { count: number }).count, 0);
  db.close();
});

test("launchDraft asks the first session of structured and freeform tasks to start one unambiguous linked ticket", async () => {
  const db = makeDb();
  const prompts: string[] = [];
  const bb = {
    realtime: { publish: () => undefined },
    sdk: {
      projects: stubDefaultSource(),
      threads: {
        spawn: async (input: { prompt: string }) => {
          prompts.push(input.prompt);
          return makeThreadResponse({ id: `thr_${prompts.length}`, environmentId: "env_1", projectId: "proj_1", originPluginId: "rpi" });
        },
        get: async ({ threadId }: { threadId: string }) => makeThreadResponse({ id: threadId, environmentId: "env_1", projectId: "proj_1", originPluginId: "rpi" }),
      },
    },
    log: { warn: () => undefined },
  };
  await launchDraft(bb as never, db, new Map(), createLaunchBindingMirror(), seedTask(db, "rpi"));
  await launchDraft(bb as never, db, new Map(), createLaunchBindingMirror(), seedTask(db, "freeform"));
  assert.equal(prompts.length, 2);
  assert.ok(prompts.every((prompt) => prompt.startsWith(TASK_CONTEXT_FIRST_ACTION)));
  assert.ok(prompts.every((prompt) => prompt.includes(START_LINKED_TICKET_ACTION)));
  assert.match(prompts[0]!, /\/rpi-create-research-questions[\s\S]+Before phase work/);
  assert.match(prompts[1]!, /prompt[\s\S]+Before phase work/);
  db.close();
});

test("launchPhase rejects with a typed no_source_host error when the project has no default source and the task has no host", async () => {
  const db = makeDb();
  const taskId = seedTask(db);
  const task = db.prepare("SELECT * FROM tasks WHERE id = ?").get(taskId) as { id: string };
  const bb = {
    realtime: { publish: () => undefined },
    sdk: {
      // No default source (sources: []) and the task below has hostId: null, baseEnvironmentId:
      // null, defaultDirectory: null: selectEnvironment has nothing to launch on.
      projects: { get: async () => ({ id: "proj_1", name: "Proj", kind: "standard" as const, gitRemoteUrl: null, createdAt: 1, updatedAt: 1, sources: [] }) },
      threads: { spawn: async () => { throw new Error("must not spawn"); }, get: async () => { throw new Error("must not spawn"); } },
    },
    log: { warn: () => undefined },
  };
  await assert.rejects(
    launchPhase(bb as never, db, new Map(), createLaunchBindingMirror(), {
      id: task.id,
      projectId: "proj_1",
      name: "Task",
      slug: "task",
      draftPrompt: "prompt",
      workflowType: "freeform",
      worktreeTiming: "never",
      isDraft: true,
      archived: false,
      completed: false,
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
      e2eMode: false,
      phaseModels: {},
      createdAt: 1,
      updatedAt: 1,
    }, { skillId: null, prompt: "do work", launchedBy: "user", fromThreadId: null }),
    (error: unknown) => {
      assert.ok(error instanceof LaunchRejectedError);
      assert.equal(error.code, "no_source_host");
      assert.match(error.message, /no host to launch on/i);
      return true;
    },
  );
  db.close();
});

test("phase successor spawn is a sibling with plugin metadata only", async () => {
  const db = makeDb();
  const taskId = seedTask(db);
  const task = db.prepare("SELECT id, project_id AS projectId, name, slug, draft_prompt AS draftPrompt, workflow_type AS workflowType, worktree_timing AS worktreeTiming, is_draft AS isDraft, archived, host_id AS hostId, base_environment_id AS baseEnvironmentId, worktree_environment_id AS worktreeEnvironmentId, default_directory AS defaultDirectory, provider_id AS providerId, model, reasoning_level AS reasoningLevel, service_tier AS serviceTier, permission_mode AS permissionMode, auto_advance AS autoAdvance, aa_questions_to_research, aa_research_to_design, aa_plan_to_worktree, aa_worktree_to_implementation, aa_implementation_to_pr, created_at AS createdAt, updated_at AS updatedAt FROM tasks WHERE id = ?").get(taskId) as never;
  let spawnInput: Record<string, unknown> = {};
  const bb = {
    realtime: { publish: () => undefined },
    sdk: {
      projects: stubDefaultSource(),
      threads: {
        spawn: async (input: Record<string, unknown>) => {
          spawnInput = input;
          return makeThreadResponse({ id: "thr_new", environmentId: "env_1", projectId: "proj_1", originPluginId: "rpi" });
        },
        get: async () => makeThreadResponse({ id: "thr_new", environmentId: "env_1", projectId: "proj_1", originPluginId: "rpi" }),
      },
    },
    log: { warn: () => undefined },
  };
  await launchPhase(bb as never, db, new Map(), createLaunchBindingMirror(), task, { skillId: "create-research", launchedBy: "proceed", fromThreadId: "thr_parent" });
  assert.equal("parentThreadId" in spawnInput, false);
  const session = db.prepare("SELECT forked_from_thread_id AS fromThreadId FROM sessions WHERE thread_id = 'thr_new'").get() as { fromThreadId: string | null };
  assert.equal(session.fromThreadId, "thr_parent");
  db.close();
});

test("phase successor prompt carries selected predecessor artifacts and checkpoint state", async () => {
  const db = makeDb();
  const taskId = seedTask(db);
  const task = db.prepare("SELECT id, project_id AS projectId, name, slug, draft_prompt AS draftPrompt, workflow_type AS workflowType, worktree_timing AS worktreeTiming, is_draft AS isDraft, archived, host_id AS hostId, base_environment_id AS baseEnvironmentId, worktree_environment_id AS worktreeEnvironmentId, default_directory AS defaultDirectory, provider_id AS providerId, model, reasoning_level AS reasoningLevel, service_tier AS serviceTier, permission_mode AS permissionMode, auto_advance AS autoAdvance, aa_questions_to_research, aa_research_to_design, aa_plan_to_worktree, aa_worktree_to_implementation, aa_implementation_to_pr, created_at AS createdAt, updated_at AS updatedAt FROM tasks WHERE id = ?").get(taskId) as never;
  db.prepare(`
    INSERT INTO sessions (
      thread_id, task_id, label, skill_id, launched_by, rpi_status, rpi_status_at,
      had_turn, interrupted, summary_json, created_at, updated_at
    ) VALUES ('thr_source', ?, 'plan', 'create-plan', 'user', 'ready_for_input', 1, 1, 0, ?, 1, 1)
  `).run(taskId, JSON.stringify({ relevantRPIDocuments: [{ localpath: ".rpi/tasks/task/09-plan-current.md" }] }));
  db.prepare("INSERT INTO artifacts (id, task_id, file_name, current_version, created_at, updated_at) VALUES ('handoff', ?, 'handoff.md', 3, 1, 1)").run(taskId);
  let prompt = "";
  const bb = {
    realtime: { publish: () => undefined },
    sdk: {
      projects: stubDefaultSource(),
      threads: {
        spawn: async (input: { prompt: string }) => {
          prompt = input.prompt;
          return makeThreadResponse({ id: "thr_next", environmentId: "env_1", projectId: "proj_1", originPluginId: "rpi" });
        },
        get: async () => makeThreadResponse({ id: "thr_next", environmentId: "env_1", projectId: "proj_1", originPluginId: "rpi" }),
      },
    },
    log: { warn: () => undefined },
  };
  await launchPhase(bb as never, db, new Map(), createLaunchBindingMirror(), task, {
    skillId: "implement-plan",
    launchedBy: "proceed",
    fromThreadId: "thr_source",
  });
  assert.match(prompt, /Previous session artifacts: @09-plan-current\.md/);
  assert.match(prompt, /Checkpoint: rpi_task_context selects handoff\.md v3; read that exact revision with rpi_artifact_read/);
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
      rpi_status, rpi_status_at, had_turn, interrupted, blocked_reason, created_at, updated_at
    ) VALUES ('thr_bound', ?, NULL, NULL, 'user', NULL, 'running', 1, 1, 0, NULL, 1, 1)
  `).run(taskId);
  const thread = makeThreadResponse({ id: "thr_bound", projectId: "proj_1", createdAt: 2, originPluginId: "rpi" });
  const bb = {
    pluginId: "rpi",
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

test("adopt stores worktree environment when the attempt role is worktree", async () => {
  const db = makeDb();
  const taskId = seedTask(db);
  db.prepare("INSERT INTO launch_attempts (id, task_id, from_thread_id, skill_id, command_line, label, environment_role, launched_by, status, thread_id, created_at) VALUES (?, ?, NULL, 'setup-worktree', '/rpi-setup-worktree', 'worktree-setup', 'worktree', 'auto_advance', 'uncertain', NULL, ?)")
    .run("attempt_1", taskId, 1);
  const thread = makeThreadResponse({ id: "thr_adopt", projectId: "proj_1", createdAt: 2, originPluginId: "rpi" });
  const bb = {
    pluginId: "rpi",
    sdk: {
      threads: {
        list: async () => [thread],
        get: async () => ({ ...thread, environmentId: "env_worktree", environment: { id: "env_worktree", path: "/tmp/repo", status: "ready" } }),
        interactions: { list: async () => [] },
      },
    },
  };
  await resolveLaunchAttempt(bb as never, db, new Map(), createLaunchBindingMirror(), "attempt_1", { type: "adopt", threadId: "thr_adopt" });
  const task = db.prepare("SELECT worktree_environment_id AS worktreeEnvironmentId, base_environment_id AS baseEnvironmentId FROM tasks WHERE id = ?").get(taskId) as { worktreeEnvironmentId: string | null; baseEnvironmentId: string | null };
  assert.equal(task.worktreeEnvironmentId, "env_worktree");
  assert.equal(task.baseEnvironmentId, null);
  db.close();
});

test("adopting a launch attempt supersedes its origin thread's failed-advance recovery notification", async () => {
  const db = makeDb();
  const taskId = seedTask(db);
  db.prepare("INSERT INTO launch_attempts (id, task_id, from_thread_id, skill_id, command_line, label, environment_role, launched_by, status, thread_id, created_at) VALUES (?, ?, 'thr_source', 'setup-worktree', '/rpi-setup-worktree', 'worktree-setup', 'worktree', 'auto_advance', 'uncertain', NULL, ?)")
    .run("attempt_1", taskId, 1);
  db.prepare("INSERT INTO notifications (id, thread_id, kind, dedupe_key, reason, sound, created_at, delivered_at) VALUES ('n1', 'thr_source', 'ready_after_failed_advance', 'ready-recover:thr_source:turn_1', 'notify', 1, 1, 1)").run();
  const thread = makeThreadResponse({ id: "thr_adopt", projectId: "proj_1", createdAt: 2, originPluginId: "rpi" });
  const published: unknown[] = [];
  const bb = {
    pluginId: "rpi",
    realtime: { publish: (topic: string, payload: unknown) => { if (topic === "rpi:notify") published.push(payload); } },
    sdk: {
      threads: {
        list: async () => [thread],
        get: async () => ({ ...thread, environmentId: "env_worktree", environment: { id: "env_worktree", path: "/tmp/repo", status: "ready" } }),
        interactions: { list: async () => [] },
      },
    },
  };
  await resolveLaunchAttempt(bb as never, db, new Map(), createLaunchBindingMirror(), "attempt_1", { type: "adopt", threadId: "thr_adopt" });
  const notification = db.prepare("SELECT superseded_at AS supersededAt FROM notifications WHERE id = 'n1'").get() as { supersededAt: number | null };
  assert.notEqual(notification.supersededAt, null);
  assert.deepEqual(published, [{ kind: "dismiss", notificationId: "n1", dedupeKey: "ready-recover:thr_source:turn_1" }]);
  db.close();
});

test("adoption candidates match plugin, project, time, and mark weak without marker", async () => {
  const db = makeDb();
  const taskId = seedTask(db);
  db.prepare("INSERT INTO launch_attempts (id, task_id, from_thread_id, skill_id, status, thread_id, created_at) VALUES (?, ?, NULL, NULL, 'uncertain', NULL, ?)")
    .run("attempt_1", taskId, 10);
  const threads = [
    makeThreadResponse({ id: "thr_strong", title: "Strong", projectId: "proj_1", createdAt: 11, originPluginId: "rpi" }),
    makeThreadResponse({ id: "thr_weak", title: "Weak", projectId: "proj_1", createdAt: 12, originPluginId: "rpi" }),
    makeThreadResponse({ id: "thr_wrong_project", projectId: "proj_2", createdAt: 13, originPluginId: "rpi" }),
    makeThreadResponse({ id: "thr_old", projectId: "proj_1", createdAt: 10, originPluginId: "rpi" }),
    makeThreadResponse({ id: "thr_other_plugin", projectId: "proj_1", createdAt: 14, originPluginId: "other" }),
    makeThreadResponse({ id: "thr_other_marker", projectId: "proj_1", createdAt: 15, originPluginId: "rpi" }),
  ];
  const bb = {
    pluginId: "rpi",
    sdk: {
      threads: {
        list: async () => threads,
        timeline: async ({ threadId }: { threadId: string }) => ({
          rows: threadId === "thr_strong"
            ? [{ kind: "conversation", role: "user", text: "<!-- rpi:launch:attempt_1 -->", sourceSeqStart: 1 }]
            : threadId === "thr_other_marker"
              ? [{ kind: "conversation", role: "user", text: "<!-- rpi:launch:other_attempt -->", sourceSeqStart: 1 }]
              : [{ kind: "conversation", role: "user", text: "manual start", sourceSeqStart: 1 }],
        }),
      },
    },
  };
  const attempt = db.prepare("SELECT id, task_id AS taskId, from_thread_id AS fromThreadId, skill_id AS skillId, command_line AS commandLine, label, environment_role AS environmentRole, launched_by AS launchedBy, status, thread_id AS threadId, retried_from AS retriedFrom, retry_marker AS retryMarker, created_at AS createdAt FROM launch_attempts WHERE id = 'attempt_1'").get() as never;
  const candidates = await listLaunchAdoptionCandidates(bb as never, db, attempt);
  assert.deepEqual(candidates.map((candidate) => ({ threadId: candidate.threadId, strong: candidate.strong })), [
    { threadId: "thr_strong", strong: true },
    { threadId: "thr_weak", strong: false },
  ]);
  db.close();
});

test("retry creates a new marked attempt with the same command and role", async () => {
  const db = makeDb();
  const taskId = seedTask(db);
  db.prepare("INSERT INTO launch_attempts (id, task_id, from_thread_id, skill_id, command_line, label, environment_role, launched_by, status, thread_id, created_at) VALUES (?, ?, 'thr_source', 'create-research', '/rpi-create-research @x.md', 'research', 'base', 'proceed', 'uncertain', NULL, ?)")
    .run("attempt_1", taskId, 1);
  let prompt = "";
  const bb = {
    realtime: { publish: () => undefined },
    sdk: {
      projects: stubDefaultSource(),
      threads: {
        spawn: async (input: { prompt: string }) => {
          prompt = input.prompt;
          return makeThreadResponse({ id: "thr_retry", environmentId: "env_1", projectId: "proj_1", originPluginId: "rpi" });
        },
        get: async () => makeThreadResponse({ id: "thr_retry", environmentId: "env_1", projectId: "proj_1", originPluginId: "rpi" }),
      },
    },
    log: { warn: () => undefined },
  };
  await resolveLaunchAttempt(bb as never, db, new Map(), createLaunchBindingMirror(), "attempt_1", { type: "retry" });
  assert.match(prompt, /<!-- rpi:launch:(?!attempt_1).*$/);
  assert.match(prompt, /\/rpi-create-research @x\.md/);
  const attempts = db.prepare("SELECT id, status, retried_from AS retriedFrom, environment_role AS environmentRole, thread_id AS threadId FROM launch_attempts ORDER BY created_at, id").all() as Array<{ id: string; status: string; retriedFrom: string | null; environmentRole: string; threadId: string | null }>;
  assert.equal(attempts.length, 2);
  assert.equal(attempts[0]?.status, "failed");
  assert.equal(attempts[1]?.status, "spawned");
  assert.equal(attempts[1]?.retriedFrom, "attempt_1");
  assert.equal(attempts[1]?.environmentRole, "base");
  assert.equal(attempts[1]?.threadId, "thr_retry");
  db.close();
});

test("concurrent retries claim the old attempt once and spawn once", async () => {
  const db = makeDb();
  const taskId = seedTask(db);
  db.prepare("INSERT INTO launch_attempts (id, task_id, from_thread_id, skill_id, command_line, label, environment_role, launched_by, status, thread_id, created_at) VALUES (?, ?, 'thr_source', 'create-research', '/rpi-create-research', 'research', 'base', 'proceed', 'uncertain', NULL, ?)")
    .run("attempt_1", taskId, 1);
  let spawns = 0;
  const bb = {
    realtime: { publish: () => undefined },
    sdk: {
      projects: stubDefaultSource(),
      threads: {
        spawn: async () => {
          spawns += 1;
          await new Promise((resolve) => setTimeout(resolve, 10));
          return makeThreadResponse({ id: "thr_retry", environmentId: "env_1", projectId: "proj_1", originPluginId: "rpi" });
        },
        get: async () => makeThreadResponse({ id: "thr_retry", environmentId: "env_1", projectId: "proj_1", originPluginId: "rpi" }),
      },
    },
    log: { warn: () => undefined },
  };
  const bindings = createLaunchBindingMirror();
  await Promise.all([
    resolveLaunchAttempt(bb as never, db, new Map(), bindings, "attempt_1", { type: "retry" }),
    resolveLaunchAttempt(bb as never, db, new Map(), bindings, "attempt_1", { type: "retry" }),
  ]);
  assert.equal(spawns, 1);
  const attempts = db.prepare("SELECT status, retried_from AS retriedFrom FROM launch_attempts ORDER BY created_at, id").all() as Array<{ status: string; retriedFrom: string | null }>;
  assert.deepEqual(attempts.map((attempt) => attempt.status), ["failed", "spawned"]);
  assert.equal(attempts[1]?.retriedFrom, "attempt_1");
  db.close();
});

test("retry honors the stored base environment role", async () => {
  const db = makeDb();
  const taskId = seedTask(db);
  db.prepare("UPDATE tasks SET worktree_timing = 'later', base_environment_id = 'env_base', worktree_environment_id = 'env_worktree' WHERE id = ?").run(taskId);
  db.prepare("INSERT INTO launch_attempts (id, task_id, from_thread_id, skill_id, command_line, label, environment_role, launched_by, status, thread_id, created_at) VALUES (?, ?, 'thr_source', 'create-research', '/rpi-create-research', 'research', 'base', 'proceed', 'uncertain', NULL, ?)")
    .run("attempt_1", taskId, 1);
  let environment: unknown;
  const bb = {
    realtime: { publish: () => undefined },
    sdk: {
      threads: {
        spawn: async (input: { environment: unknown }) => {
          environment = input.environment;
          return makeThreadResponse({ id: "thr_retry", environmentId: "env_base", projectId: "proj_1", originPluginId: "rpi" });
        },
        get: async () => makeThreadResponse({ id: "thr_retry", environmentId: "env_base", projectId: "proj_1", originPluginId: "rpi" }),
      },
    },
    log: { warn: () => undefined },
  };
  await resolveLaunchAttempt(bb as never, db, new Map(), createLaunchBindingMirror(), "attempt_1", { type: "retry" });
  assert.deepEqual(environment, { type: "reuse", environmentId: "env_base" });
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
    { timing: "never", skillId: "create-research", expected: "unmanaged" },
    { timing: "now", skillId: "create-research", expected: "managed-worktree" },
    { timing: "later", skillId: "create-research", expected: "unmanaged" },
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
            return makeThreadResponse({ id: "thr_new", environmentId: null, projectId: "proj_1", originPluginId: "rpi" });
          },
          get: async () => makeThreadResponse({ id: "thr_new", environmentId: "env_1", projectId: "proj_1", originPluginId: "rpi" }),
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

// Regression: a base-role task with no baseEnvironmentId/hostId+defaultDirectory must resolve the
// project's own default source host, never `hosts.list()[0]` (no ordering guarantee across hosts)
// and never `{type:"project-default"}` (the project's ambient default can silently be a managed
// worktree, which would bypass `worktreeTiming: "later""/"never"`).
test("a hostless base-role task targets the project's default source host, not the first listed host", async () => {
  const db = makeDb();
  const taskId = createDraftTask(db, {
    projectId: "proj_1",
    prompt: "prompt",
    name: "Task",
    workflowType: "rpi",
    worktreeTiming: "later",
    permissionMode: "default",
    autoAdvance: false,
    providerId: null,
    model: null,
    reasoningLevel: null,
    serviceTier: null,
  }).taskId;
  const task = db.prepare("SELECT id, project_id AS projectId, name, slug, draft_prompt AS draftPrompt, workflow_type AS workflowType, worktree_timing AS worktreeTiming, is_draft AS isDraft, archived, host_id AS hostId, base_environment_id AS baseEnvironmentId, worktree_environment_id AS worktreeEnvironmentId, default_directory AS defaultDirectory, provider_id AS providerId, model, reasoning_level AS reasoningLevel, service_tier AS serviceTier, permission_mode AS permissionMode, auto_advance AS autoAdvance, aa_questions_to_research, aa_research_to_design, aa_plan_to_worktree, aa_worktree_to_implementation, aa_implementation_to_pr, created_at AS createdAt, updated_at AS updatedAt FROM tasks WHERE id = ?").get(taskId) as never;
  let environment: unknown;
  let spawned = false;
  const bb = {
    realtime: { publish: () => undefined },
    sdk: {
      hosts: { list: async () => [{ id: "host_first", name: "First", status: "connected" }, { id: "host_second", name: "Second", status: "connected" }] },
      projects: {
        get: async ({ projectId }: { projectId: string }) => ({
          id: projectId,
          name: "Proj",
          kind: "standard" as const,
          gitRemoteUrl: null,
          createdAt: 1,
          updatedAt: 1,
          sources: [
            { id: "src_1", projectId, hostId: "host_first", path: "/repo-first", type: "local_path" as const, isDefault: false, createdAt: 1, updatedAt: 1 },
            { id: "src_2", projectId, hostId: "host_second", path: "/repo-second", type: "local_path" as const, isDefault: true, createdAt: 1, updatedAt: 1 },
          ],
        }),
      },
      threads: {
        spawn: async (input: { environment: unknown }) => {
          environment = input.environment;
          spawned = true;
          return makeThreadResponse({ id: "thr_new", environmentId: null, projectId: "proj_1", originPluginId: "rpi" });
        },
        get: async () => makeThreadResponse({ id: "thr_new", environmentId: "env_1", projectId: "proj_1", originPluginId: "rpi" }),
      },
    },
    log: { warn: () => undefined },
  };
  await launchPhase(bb as never, db, new Map(), createLaunchBindingMirror(), task, { skillId: "create-research", launchedBy: "user", fromThreadId: null });
  assert.equal(spawned, true);
  assert.deepEqual(environment, { type: "host", hostId: "host_second", workspace: { type: "unmanaged", path: "/repo-second" } });
  db.close();
});

test("a hostless base-role task with no project source and no task.hostId rejects the launch instead of spawning", async () => {
  const db = makeDb();
  const taskId = createDraftTask(db, {
    projectId: "proj_1",
    prompt: "prompt",
    name: "Task",
    workflowType: "rpi",
    worktreeTiming: "never",
    permissionMode: "default",
    autoAdvance: false,
    providerId: null,
    model: null,
    reasoningLevel: null,
    serviceTier: null,
  }).taskId;
  const task = db.prepare("SELECT id, project_id AS projectId, name, slug, draft_prompt AS draftPrompt, workflow_type AS workflowType, worktree_timing AS worktreeTiming, is_draft AS isDraft, archived, host_id AS hostId, base_environment_id AS baseEnvironmentId, worktree_environment_id AS worktreeEnvironmentId, default_directory AS defaultDirectory, provider_id AS providerId, model, reasoning_level AS reasoningLevel, service_tier AS serviceTier, permission_mode AS permissionMode, auto_advance AS autoAdvance, aa_questions_to_research, aa_research_to_design, aa_plan_to_worktree, aa_worktree_to_implementation, aa_implementation_to_pr, created_at AS createdAt, updated_at AS updatedAt FROM tasks WHERE id = ?").get(taskId) as never;
  let spawned = false;
  const bb = {
    realtime: { publish: () => undefined },
    sdk: {
      hosts: { list: async () => [{ id: "host_first", name: "First", status: "connected" }] },
      projects: { get: async () => ({ id: "proj_1", name: "Proj", kind: "standard" as const, gitRemoteUrl: null, createdAt: 1, updatedAt: 1, sources: [] }) },
      threads: {
        spawn: async () => {
          spawned = true;
          return makeThreadResponse({ id: "thr_new", environmentId: null, projectId: "proj_1", originPluginId: "rpi" });
        },
        get: async () => makeThreadResponse({ id: "thr_new", environmentId: "env_1", projectId: "proj_1", originPluginId: "rpi" }),
      },
    },
    log: { warn: () => undefined },
  };
  await assert.rejects(
    launchPhase(bb as never, db, new Map(), createLaunchBindingMirror(), task, { skillId: "create-research", launchedBy: "user", fromThreadId: null }),
    /no host to launch on/i,
  );
  assert.equal(spawned, false);
  const attempts = db.prepare("SELECT status FROM launch_attempts WHERE task_id = ?").all(taskId) as Array<{ status: string }>;
  assert.equal(attempts.length, 1);
  assert.equal(attempts[0]!.status, "failed");
  db.close();
});
