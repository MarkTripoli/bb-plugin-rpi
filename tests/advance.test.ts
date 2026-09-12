import test from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { makeThreadResponse } from "@get-bb/plugin-sdk/testing";
import {
  iterateSkillForLabel,
  latestLaunchAttemptLabel,
  launchCompletion,
  onCompletedTurn,
  prepareManualLaunch,
  submitManualLaunch,
} from "../advance";
import { MANUAL_LAUNCH_TEXT_LIMIT, prepareManualLaunchOutputSchema, type ManualLaunchRequest } from "../contract";
import { MIGRATIONS, stringifyJson } from "../db";
import { upsertArtifact } from "../artifacts";
import { createDraftTask } from "../tasks";
import { proceed } from "../advance";
import { createLaunchBindingMirror, mirrorSession, type SessionMirrorRow } from "../sessions";
import { DEFAULT_NOTIFICATION_PREFS, recoverReadyAfterFailedAdvance } from "../notify";
import { resolveLaunchAttempt } from "../launch";
import { START_LINKED_TICKET_ACTION } from "../instructions";

function makeDb() {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  for (const statement of MIGRATIONS) db.exec(statement);
  return db;
}

type TestWorkflowType = "rpi" | "outline_only" | "prd_tdd" | "oneshot" | "freeform";

function seed(db: Database.Database, label: string | null, nextStepType: string | null, patch: Record<string, unknown> = {}, workflowType: TestWorkflowType = "rpi") {
  const taskId = createDraftTask(db, {
    projectId: "proj_1",
    prompt: "prompt",
    name: "Task",
    workflowType,
    worktreeTiming: "never",
    permissionMode: "default",
    autoAdvance: true,
    providerId: null,
    model: null,
    reasoningLevel: null,
    serviceTier: null,
  }).taskId;
  db.prepare("UPDATE tasks SET aa_questions_to_research = 1, aa_research_to_design = 1, aa_plan_to_worktree = 1, aa_worktree_to_implementation = 1, aa_implementation_to_pr = 1 WHERE id = ?").run(taskId);
  for (const [key, value] of Object.entries(patch)) db.prepare(`UPDATE tasks SET ${key} = ? WHERE id = ?`).run(value, taskId);
  const nextStepJson = nextStepType
    ? stringifyJson({ parsedAt: 1, extraction: { type: "next_step_found", nextStepPrompt: `/rpi-${nextStepType}`, nextStepSummary: "next", nextStepType, taskReference: "task", suggestedDirectory: null } })
    : stringifyJson({ parsedAt: 1, extraction: { type: "no_next_step", reason: "no command block" } });
  const reviewFileName = "01-implementation-receipt.md";
  upsertArtifact(db, taskId, reviewFileName, "---\ntype: implementation\ncompleted_phase: 1\n---\n", {
    createdBy: "test",
    operation: "test",
  });
  if (label === "implementation" && (workflowType === "rpi" || workflowType === "prd_tdd")) {
    upsertArtifact(db, taskId, "02-plan-demo.md", "---\ntype: plan\n---\n\n## Phase 1: Scaffold\n\n## Phase 2: Continue\n", {
      createdBy: "test",
      operation: "test",
    });
  }
  const sourceSkillId = label === "implementation"
    ? workflowType === "outline_only" ? "implement-outline" : workflowType === "rpi" || workflowType === "prd_tdd" ? "implement-plan" : null
    : null;
  db.prepare(`
    INSERT INTO sessions (
      thread_id, task_id, label, skill_id, launched_by, forked_from_thread_id,
      rpi_status, rpi_status_at, had_turn, interrupted, blocked_reason, next_step_json, summary_json,
      completed_turn_key, next_step_turn_key, last_summarized_turn_key, created_at, updated_at
    ) VALUES ('thr_source', ?, ?, ?, 'user', NULL, 'ready_for_input', 1, 1, 0, NULL, ?, ?, 'turn_1', 'turn_1', 'turn_1', 1, 1)
  `).run(taskId, label, sourceSkillId, nextStepJson, stringifyJson({ primaryReviewArtifact: { fileName: reviewFileName } }));
  return { taskId, session: mirrorSession(db, new Map<string, SessionMirrorRow>(), "thr_source")! };
}

function fakeBb(options: { pendingInteraction?: boolean; spawnError?: Error; onProjectGet?: () => void } = {}) {
  let count = 0;
  const spawns: unknown[] = [];
  return {
    bb: {
      pluginId: "rpi",
      realtime: { publish: () => undefined },
      log: { warn: () => undefined },
      sdk: {
      projects: { get: async ({ projectId }: { projectId: string }) => {
        options.onProjectGet?.();
        return { id: projectId, name: "Proj", kind: "standard" as const, gitRemoteUrl: null, createdAt: 1, updatedAt: 1, sources: [{ id: "src_1", projectId, hostId: "host_seed", path: "/repo", type: "local_path" as const, isDefault: true, createdAt: 1, updatedAt: 1 }] };
      } },
      threads: {
        interactions: { list: async () => options.pendingInteraction ? [{ status: "pending" }] : [] },
        spawn: async (input: unknown) => {
            count += 1;
            spawns.push(input);
            if (options.spawnError) throw options.spawnError;
            return makeThreadResponse({ id: `thr_next_${count}`, environmentId: "env_base", projectId: "proj_1", originPluginId: "rpi" });
          },
          get: async () => makeThreadResponse({ id: `thr_next_${count}`, environmentId: "env_base", projectId: "proj_1", originPluginId: "rpi" }),
      },
      },
    },
    spawns,
  };
}

function manualRequest(patch: Partial<ManualLaunchRequest> = {}): ManualLaunchRequest {
  return {
    projectId: "proj_1",
    providerId: "codex",
    model: "gpt-test",
    reasoningLevel: "high",
    permissionMode: "accept-edits",
    serviceTier: "fast",
    executionInputSources: {
      providerId: "explicit",
      model: "explicit",
      reasoningLevel: "explicit",
      permissionMode: "explicit",
      serviceTier: "explicit",
    },
    environment: { type: "host", hostId: "host_seed", workspace: { type: "unmanaged", path: "/repo" } },
    input: [{ type: "text", text: "edited manual launch", mentions: [] }],
    ...patch,
  };
}

const MATRIX = [
  { label: "research-questions", next: "create-research", flag: "aa_questions_to_research", humanGate: false },
  { label: "research", next: "create-design-discussion", flag: "aa_research_to_design", humanGate: false },
  { label: "design", next: "create-structure-outline", flag: null, humanGate: true },
  { label: "design-prd", next: "create-tdd", flag: null, humanGate: true },
  { label: "design-tdd", next: "create-structure-outline", flag: null, humanGate: true },
  { label: "structure", next: "create-plan", flag: null, humanGate: true },
  { label: "plan", next: "setup-worktree", flag: "aa_plan_to_worktree", humanGate: false },
  { label: "worktree-setup", next: "implement-plan", flag: "aa_worktree_to_implementation", humanGate: false },
  { label: "implementation", next: "describe-pr", flag: "aa_implementation_to_pr", humanGate: false },
  { label: "code-review", next: "fix-code-review", flag: "aa_implementation_to_pr", humanGate: false },
  { label: "review-fixes", next: "review-code", flag: "aa_implementation_to_pr", humanGate: false },
  { label: "describe-pr", next: "resolve-pr-reviews", flag: null, humanGate: true },
  { label: "pr-review", next: "resolve-pr-reviews", flag: null, humanGate: true },
] as const;

test("auto-advance matrix covers rows, flags, master switch, blockers, and missing next step", async () => {
  for (const row of MATRIX) {
    for (const flagOn of [false, true]) {
      for (const masterOn of [false, true]) {
        for (const blocked of [false, true]) {
          for (const found of [false, true]) {
            const db = makeDb();
            const { bb, spawns } = fakeBb();
            const patch: Record<string, unknown> = { auto_advance: masterOn ? 1 : 0 };
            if (row.flag) patch[row.flag] = flagOn ? 1 : 0;
            const { session } = seed(db, row.label, found ? row.next : null, patch);
            if (blocked) db.prepare("UPDATE sessions SET blocked_reason = 'question' WHERE thread_id = 'thr_source'").run();
            const fresh = mirrorSession(db, new Map<string, SessionMirrorRow>(), "thr_source")!;
            await onCompletedTurn(bb as never, db, new Map(), createLaunchBindingMirror(), fresh ?? session);
            const expected = !row.humanGate && found && !blocked && masterOn && (!row.flag || flagOn) ? 1 : 0;
            assert.equal(spawns.length, expected, `${row.label} flag=${flagOn} master=${masterOn} blocked=${blocked} found=${found}`);
            db.close();
          }
        }
      }
    }
  }
});

test("auto-advance skips when master, flag, blocked reason, or next step is absent", async () => {
  const cases = [
    { patch: { auto_advance: 0 }, next: "create-research", blocked: null },
    { patch: { aa_questions_to_research: 0 }, next: "create-research", blocked: null },
    { patch: {}, next: null, blocked: null },
    { patch: {}, next: "create-research", blocked: "question" },
  ];
  for (const item of cases) {
    const db = makeDb();
    const { bb, spawns } = fakeBb();
    const { session } = seed(db, "research-questions", item.next, item.patch);
    if (item.blocked) db.prepare("UPDATE sessions SET blocked_reason = ? WHERE thread_id = 'thr_source'").run(item.blocked);
    const row = mirrorSession(db, new Map<string, SessionMirrorRow>(), "thr_source")!;
    await onCompletedTurn(bb as never, db, new Map(), createLaunchBindingMirror(), row ?? session);
    assert.equal(spawns.length, 0);
    db.close();
  }
});

test("double completed-turn events launch once and suppress the ready toast", async () => {
  const db = makeDb();
  const { bb, spawns } = fakeBb();
  const { session } = seed(db, "research-questions", "create-research");
  await onCompletedTurn(bb as never, db, new Map(), createLaunchBindingMirror(), session);
  await onCompletedTurn(bb as never, db, new Map(), createLaunchBindingMirror(), session);
  assert.equal(spawns.length, 1);
  const suppression = db.prepare("SELECT reason, completed_turn_key FROM notification_suppressions WHERE thread_id = 'thr_source'").get() as { reason: string; completed_turn_key: string } | undefined;
  assert.equal(suppression?.reason, "auto_advance");
  assert.equal(suppression?.completed_turn_key, "turn_1");
  db.close();
});

test("auto-advance refuses mismatched extracted target", async () => {
  const db = makeDb();
  const { bb, spawns } = fakeBb();
  const { session } = seed(db, "research-questions", "create-design-discussion");
  await onCompletedTurn(bb as never, db, new Map(), createLaunchBindingMirror(), session);
  assert.equal(spawns.length, 0);
  db.close();
});

test("clean code review can auto-advance directly to pull request creation", async () => {
  const db = makeDb();
  const { bb, spawns } = fakeBb();
  const { session } = seed(db, "code-review", "describe-pr");
  await onCompletedTurn(bb as never, db, new Map(), createLaunchBindingMirror(), session);
  assert.equal(spawns.length, 1);
  db.close();
});

test("outline-only research auto-advance expects structure", async () => {
  {
    const db = makeDb();
    const { bb, spawns } = fakeBb();
    await onCompletedTurn(bb as never, db, new Map(), createLaunchBindingMirror(), seed(db, "research", "create-design-discussion", {}, "outline_only").session);
    assert.equal(spawns.length, 0);
    db.close();
  }
  {
    const db = makeDb();
    const { bb, spawns } = fakeBb();
    await onCompletedTurn(bb as never, db, new Map(), createLaunchBindingMirror(), seed(db, "research", "create-structure-outline", {}, "outline_only").session);
    assert.equal(spawns.length, 1);
    db.close();
  }
});

test("manual Proceed requires a bound review artifact for ordinary labeled gates", async () => {
  const db = makeDb();
  const { session } = seed(db, "design", "create-structure-outline");
  db.prepare("UPDATE sessions SET summary_json = '{}' WHERE thread_id = 'thr_source'").run();
  const { bb, spawns } = fakeBb();
  await assert.rejects(
    () => proceed(bb as never, db, new Map(), createLaunchBindingMirror(), session.threadId),
    /Phase review metadata is unavailable/,
  );
  assert.equal(spawns.length, 0);
  assert.equal((db.prepare("SELECT advanced_at AS advancedAt FROM sessions WHERE thread_id = 'thr_source'").get() as { advancedAt: number | null }).advancedAt, null);
  assert.equal((db.prepare("SELECT COUNT(*) AS count FROM launch_attempts").get() as { count: number }).count, 0);
  db.close();
});

test("outline implementation completion uses its bound receipt and structure outline", async () => {
  const db = makeDb();
  const { taskId } = seed(db, "implementation", "describe-pr", { auto_advance: 0 }, "outline_only");
  upsertArtifact(db, taskId, "02-structure-outline.md", "---\ntype: structure-outline\n---\n\n## Step 1: Scaffold\n\n## Step 2: Continue\n", {
    createdBy: "test",
    operation: "test",
  });
  const { bb, spawns } = fakeBb();
  await assert.rejects(
    () => launchCompletion(bb as never, db, new Map(), createLaunchBindingMirror(), {
      kind: "completion",
      threadId: "thr_source",
      skillId: "implement-outline",
      phase: 3,
    }),
    /no longer available/,
  );
  assert.equal(spawns.length, 0);
  assert.equal((db.prepare("SELECT advanced_at AS advancedAt FROM sessions WHERE thread_id = 'thr_source'").get() as { advancedAt: number | null }).advancedAt, null);

  const launched = await launchCompletion(bb as never, db, new Map(), createLaunchBindingMirror(), {
    kind: "completion",
    threadId: "thr_source",
    skillId: "implement-outline",
    phase: 2,
  });
  assert.equal(launched.threadId, "thr_next_1");
  assert.deepEqual(db.prepare("SELECT skill_id AS skillId, command_line AS commandLine FROM launch_attempts WHERE task_id = ?").get(taskId), {
    skillId: "implement-outline",
    commandLine: "/rpi-implement-outline",
  });
  db.close();
});

test("direct Proceed cannot bypass an outline phase approval action", async () => {
  const db = makeDb();
  const { taskId, session } = seed(db, "implementation", "implement-outline", { auto_advance: 0 }, "outline_only");
  upsertArtifact(db, taskId, "02-structure-outline.md", "---\ntype: structure-outline\n---\n\n## Step 1: Scaffold\n\n## Step 2: Continue\n", {
    createdBy: "test",
    operation: "test",
  });
  const { bb, spawns } = fakeBb();
  await assert.rejects(
    () => proceed(bb as never, db, new Map(), createLaunchBindingMirror(), session.threadId),
    /no longer available/,
  );
  assert.equal(spawns.length, 0);
  assert.equal((db.prepare("SELECT advanced_at AS advancedAt FROM sessions WHERE thread_id = 'thr_source'").get() as { advancedAt: number | null }).advancedAt, null);
  db.close();
});

test("ci-commit completion uses the general review path", async () => {
  const db = makeDb();
  const { taskId } = seed(db, "implementation", "describe-pr", { auto_advance: 0 });
  db.prepare("UPDATE sessions SET skill_id = 'ci-commit' WHERE thread_id = 'thr_source'").run();
  db.prepare("UPDATE artifacts SET frontmatter_json = ? WHERE task_id = ? AND file_name = '01-implementation-receipt.md'").run(
    stringifyJson({ type: "commit" }),
    taskId,
  );
  const { bb, spawns } = fakeBb();
  const launched = await proceed(bb as never, db, new Map(), createLaunchBindingMirror(), "thr_source");
  assert.equal(launched.threadId, "thr_next_1");
  assert.equal(spawns.length, 1);
  db.close();
});

test("proceed and auto-advance racing create one launch", async () => {
  const db = makeDb();
  const { bb, spawns } = fakeBb();
  const { session } = seed(db, "research-questions", "create-research");
  await Promise.all([
    onCompletedTurn(bb as never, db, new Map(), createLaunchBindingMirror(), session),
    proceed(bb as never, db, new Map(), createLaunchBindingMirror(), "thr_source"),
  ]);
  assert.equal(spawns.length, 1);
  const attempts = db.prepare("SELECT COUNT(*) AS count FROM launch_attempts WHERE from_thread_id = 'thr_source'").get() as { count: number };
  assert.equal(attempts.count, 1);
  db.close();
});

test("preflight failure resets only its advanced_at stamp and fails the attempt, leaving suppression for recovery", async () => {
  const db = makeDb();
  const { session } = seed(db, "plan", "setup-worktree", { worktree_timing: "now", host_id: null });
  const bb = {
    pluginId: "rpi",
    realtime: { publish: () => undefined },
    log: { warn: () => undefined },
    sdk: { threads: { interactions: { list: async () => [] } } },
  };
  await assert.rejects(() => onCompletedTurn(bb as never, db, new Map(), createLaunchBindingMirror(), session), /hostId is required/);
  const row = db.prepare("SELECT advanced_at AS advancedAt, advanced_attempt_id AS advancedAttemptId FROM sessions WHERE thread_id = 'thr_source'").get() as { advancedAt: number | null; advancedAttemptId: string | null };
  const attempt = db.prepare("SELECT id, status FROM launch_attempts WHERE from_thread_id = 'thr_source'").get() as { id: string; status: string };
  const suppression = db.prepare("SELECT consumed_at AS consumedAt FROM notification_suppressions WHERE thread_id = 'thr_source'").get() as { consumedAt: number | null } | undefined;
  assert.equal(row.advancedAt, null);
  assert.equal(row.advancedAttemptId, null);
  assert.equal(attempt.status, "failed");
  // Left unconsumed here: onCompletedTurn itself does not recover, that is sessions.ts's job
  // (see "auto-advance launch failure delivers exactly one recovery notification" below).
  assert.equal(suppression?.consumedAt, null);
  db.close();
});

test("auto-advance launch failure delivers exactly one ready_after_failed_advance recovery notification", async () => {
  const db = makeDb();
  const { session } = seed(db, "plan", "setup-worktree", { worktree_timing: "now", host_id: null });
  const published: unknown[] = [];
  const bb = {
    pluginId: "rpi",
    realtime: { publish: (topic: string, payload: unknown) => { if (topic === "rpi:notify") published.push(payload); } },
    log: { warn: () => undefined },
    sdk: { threads: { interactions: { list: async () => [] } } },
  };
  // Astra's case: a forced launch failure (e.g. a bogus provider/missing hostId) must not leave
  // the ready_for_input notification suppressed forever.
  await assert.rejects(() => onCompletedTurn(bb as never, db, new Map(), createLaunchBindingMirror(), session), /hostId is required/);
  const failedSkillLabel = latestLaunchAttemptLabel(db, session.threadId);
  assert.equal(failedSkillLabel, "worktree-setup");
  const result = await recoverReadyAfterFailedAdvance(bb as never, db, DEFAULT_NOTIFICATION_PREFS, {
    threadId: session.threadId,
    completedTurnKey: session.completedTurnKey!,
    failedSkillLabel,
  });
  assert.ok(result?.toast);
  assert.equal(published.length, 1);
  const rows = db.prepare("SELECT kind, dedupe_key AS dedupeKey, toast_body AS toastBody FROM notifications WHERE thread_id = ?").all(session.threadId) as Array<{ kind: string; dedupeKey: string; toastBody: string | null }>;
  assert.equal(rows.length, 1);
  assert.equal(rows[0].kind, "ready_after_failed_advance");
  assert.equal(rows[0].dedupeKey, `ready-recover:${session.threadId}:${session.completedTurnKey}`);
  assert.match(rows[0].toastBody ?? "", /worktree-setup/);

  // A later reconcile re-observing the same stuck turn (e.g. plugin reload) must not duplicate.
  const again = await recoverReadyAfterFailedAdvance(bb as never, db, DEFAULT_NOTIFICATION_PREFS, {
    threadId: session.threadId,
    completedTurnKey: session.completedTurnKey!,
    failedSkillLabel,
  });
  assert.equal(again, null);
  assert.equal(published.length, 1);
  db.close();
});

test("stale completion makes Proceed reject stale extraction", async () => {
  const db = makeDb();
  seed(db, "research-questions", "create-research");
  db.prepare("UPDATE sessions SET completed_turn_key = 'turn_new', next_step_turn_key = 'turn_old' WHERE thread_id = 'thr_source'").run();
  const { bb, spawns } = fakeBb();
  await assert.rejects(() => proceed(bb as never, db, new Map(), createLaunchBindingMirror(), "thr_source"), /stale extraction/);
  db.close();
});

test("reload with pending attempt and stamped advance keeps launch blocked without duplicate spawn", async () => {
  const db = makeDb();
  const { taskId } = seed(db, "research-questions", "create-research");
  db.prepare("INSERT INTO launch_attempts (id, task_id, from_thread_id, skill_id, status, thread_id, created_at) VALUES ('attempt_old', ?, 'thr_source', 'create-research', 'pending', NULL, ?)").run(taskId, Date.now() - 180_000);
  db.prepare("UPDATE sessions SET advanced_at = ?, advanced_attempt_id = 'attempt_old' WHERE thread_id = 'thr_source'").run(Date.now());
  const { promoteStalePendingLaunchAttempts } = await import("../launch");
  assert.deepEqual(promoteStalePendingLaunchAttempts(db), [taskId]);
  const { bb, spawns } = fakeBb();
  const mirror = new Map<string, SessionMirrorRow>();
  mirrorSession(db, mirror, "thr_source");
  await assert.rejects(() => proceed(bb as never, db, mirror, createLaunchBindingMirror(), "thr_source"), /pending/);
  const attempt = db.prepare("SELECT status FROM launch_attempts WHERE id = 'attempt_old'").get() as { status: string };
  assert.equal(attempt.status, "uncertain");
  assert.equal(spawns.length, 0);
  db.close();
});

test("manual launch preparation resolves every intent without mutations or spawns", async () => {
  {
    const db = makeDb();
    const { bb, spawns } = fakeBb();
    const taskId = createDraftTask(db, {
      projectId: "proj_1",
      prompt: "draft body",
      name: "Draft",
      workflowType: "rpi",
      worktreeTiming: "never",
      permissionMode: "accept_edits",
      autoAdvance: false,
      providerId: "codex",
      model: "gpt-test",
      reasoningLevel: "high",
      serviceTier: "fast",
    }).taskId;
    const before = (db.prepare("SELECT total_changes() AS count").get() as { count: number }).count;
    const draft = await prepareManualLaunch(bb as never, db, { kind: "draft", taskId });
    const skill = await prepareManualLaunch(bb as never, db, { kind: "skill", taskId, skillId: "create-research" });
    const after = (db.prepare("SELECT total_changes() AS count").get() as { count: number }).count;
    assert.match(draft.displayPrompt, /^\/rpi-create-research-questions/);
    assert.equal(skill.displayPrompt, "/rpi-create-research");
    assert.equal(draft.projectId, "proj_1");
    assert.deepEqual(draft.environment, manualRequest().environment);
    assert.equal(draft.providerId, "codex");
    assert.equal(draft.model, "gpt-test");
    assert.equal(draft.reasoningLevel, "high");
    assert.equal(draft.serviceTier, "fast");
    assert.equal(draft.permissionMode, "accept-edits");
    assert.match(draft.draftKey, new RegExp(taskId));
    assert.match(draft.fixedWorkspaceNotice ?? "", /task workspace at \/repo/);
    assert.equal(after, before);
    assert.equal(spawns.length, 0);
    assert.equal((db.prepare("SELECT COUNT(*) AS count FROM launch_attempts").get() as { count: number }).count, 0);
    db.close();
  }

  for (const intent of ["proceed", "iterate"] as const) {
    const db = makeDb();
    const { bb, spawns } = fakeBb();
    seed(db, "research-questions", "create-research");
    const before = (db.prepare("SELECT total_changes() AS count").get() as { count: number }).count;
    const prepared = await prepareManualLaunch(bb as never, db, { kind: intent, threadId: "thr_source" });
    const after = (db.prepare("SELECT total_changes() AS count").get() as { count: number }).count;
    assert.equal(prepared.sourceThreadId, "thr_source");
    assert.equal(prepared.displayPrompt, intent === "proceed" ? "/rpi-create-research" : "/rpi-iterate-research-questions");
    assert.equal(after, before);
    assert.equal(spawns.length, 0);
    assert.equal((db.prepare("SELECT COUNT(*) AS count FROM launch_attempts").get() as { count: number }).count, 0);
    db.close();
  }
});

test("completion preparation is read-only and submission claims the source with the catalog command", async () => {
  const db = makeDb();
  const { taskId } = seed(db, "implementation", null, { auto_advance: 0 });
  const { bb, spawns } = fakeBb();
  const bindings = createLaunchBindingMirror();
  const intent = { kind: "completion", threadId: "thr_source", skillId: "review-code" } as const;
  const before = (db.prepare("SELECT total_changes() AS count").get() as { count: number }).count;
  const prepared = await prepareManualLaunch(bb as never, db, intent);
  assert.equal(prepared.displayPrompt, "/rpi-review-code");
  assert.equal((db.prepare("SELECT total_changes() AS count").get() as { count: number }).count, before);
  assert.equal(spawns.length, 0);

  const launched = await submitManualLaunch(bb as never, db, new Map(), bindings, intent, prepared.stateToken, manualRequest({
    projectId: prepared.projectId,
    environment: prepared.environment,
  }));
  assert.equal(launched.threadId, "thr_next_1");
  assert.equal(spawns.length, 1);
  assert.deepEqual(db.prepare("SELECT from_thread_id AS fromThreadId, skill_id AS skillId, command_line AS commandLine, launched_by AS launchedBy FROM launch_attempts WHERE task_id = ?").get(taskId), {
    fromThreadId: "thr_source",
    skillId: "review-code",
    commandLine: "/rpi-review-code",
    launchedBy: "completion",
  });
  assert.equal((db.prepare("SELECT advanced_at AS advancedAt FROM sessions WHERE thread_id = 'thr_source'").get() as { advancedAt: number | null }).advancedAt !== null, true);
  db.close();
});

test("launchCompletion one-click launches the catalog action and claims the source session", async () => {
  const db = makeDb();
  const { taskId } = seed(db, "implementation", "describe-pr", { auto_advance: 0 });
  upsertArtifact(db, taskId, "01-plan-demo.md", `---\ntype: plan\n---\n\n## Phase 1: Scaffold\n\n- [x] done\n\n## Phase 2: Wire server\n\n- [ ] todo\n`, {
    createdBy: "test",
    operation: "test",
  });
  const { bb, spawns } = fakeBb();
  const intent = { kind: "completion", threadId: "thr_source", skillId: "implement-plan", phase: 2 } as const;
  const launched = await launchCompletion(bb as never, db, new Map(), createLaunchBindingMirror(), intent);
  assert.equal(launched.threadId, "thr_next_1");
  assert.equal(spawns.length, 1);
  assert.deepEqual(db.prepare("SELECT from_thread_id AS fromThreadId, skill_id AS skillId, command_line AS commandLine, launched_by AS launchedBy FROM launch_attempts WHERE task_id = ?").get(taskId), {
    fromThreadId: "thr_source",
    skillId: "implement-plan",
    commandLine: "/rpi-implement-plan",
    launchedBy: "completion",
  });
  assert.equal((db.prepare("SELECT advanced_at AS advancedAt FROM sessions WHERE thread_id = 'thr_source'").get() as { advancedAt: number | null }).advancedAt !== null, true);
  assert.equal((db.prepare("SELECT is_draft AS isDraft FROM tasks WHERE id = ?").get(taskId) as { isDraft: number }).isDraft, 0);
  db.close();
});

test("numeric phase authority stays bound to each source session in the same task", async () => {
  const db = makeDb();
  const { taskId } = seed(db, "implementation", null, { auto_advance: 0 });
  upsertArtifact(db, taskId, "02-plan-demo.md", "---\ntype: plan\n---\n\n## Phase 1: One\n\n## Phase 2: Two\n\n## Phase 3: Three\n", {
    createdBy: "test",
    operation: "test",
  });
  upsertArtifact(db, taskId, "03-implementation-receipt.md", "---\ntype: implementation\ncompleted_phase: 2\n---\n", {
    createdBy: "test",
    operation: "test",
  });
  db.prepare(`
    INSERT INTO sessions (
      thread_id, task_id, label, skill_id, launched_by, forked_from_thread_id,
      rpi_status, rpi_status_at, had_turn, interrupted, blocked_reason, next_step_json, summary_json,
      completed_turn_key, next_step_turn_key, last_summarized_turn_key, created_at, updated_at
    ) VALUES ('thr_second', ?, 'implementation', 'implement-plan', 'user', NULL, 'ready_for_input', 1, 1, 0, NULL, ?, ?, 'turn_2', 'turn_2', 'turn_2', 2, 2)
  `).run(
    taskId,
    stringifyJson({ parsedAt: 1, extraction: { type: "no_next_step", reason: "done" } }),
    stringifyJson({ primaryReviewArtifact: { fileName: "03-implementation-receipt.md" } }),
  );
  const { bb } = fakeBb();
  const first = await prepareManualLaunch(bb as never, db, {
    kind: "completion",
    threadId: "thr_source",
    skillId: "implement-plan",
    phase: 2,
  });
  const second = await prepareManualLaunch(bb as never, db, {
    kind: "completion",
    threadId: "thr_second",
    skillId: "implement-plan",
    phase: 3,
  });
  assert.equal(first.displayPrompt, "/rpi-implement-plan");
  assert.equal(second.displayPrompt, "/rpi-implement-plan");
  assert.equal((db.prepare("SELECT COUNT(*) AS count FROM launch_attempts").get() as { count: number }).count, 0);
  db.close();
});

test("manual completion keeps review-entry actions available when the source artifact is missing", async () => {
  for (const remove of ["reference", "artifact"] as const) {
    const db = makeDb();
    const { taskId } = seed(db, "implementation", null, { auto_advance: 0 });
    if (remove === "reference") db.prepare("UPDATE sessions SET summary_json = '{}' WHERE thread_id = 'thr_source'").run();
    else db.prepare("UPDATE artifacts SET is_deleted = 1 WHERE task_id = ? AND file_name = '01-implementation-receipt.md'").run(taskId);
    const { bb, spawns } = fakeBb();
    const review = await prepareManualLaunch(bb as never, db, { kind: "completion", threadId: "thr_source", skillId: "review-code" });
    assert.equal(review.displayPrompt, "/rpi-review-code");
    await assert.rejects(
      prepareManualLaunch(bb as never, db, { kind: "completion", threadId: "thr_source", skillId: "describe-pr" }),
      /Phase review metadata is unavailable/,
    );
    assert.equal(spawns.length, 0);
    assert.equal((db.prepare("SELECT COUNT(*) AS count FROM launch_attempts").get() as { count: number }).count, 0);
    assert.equal((db.prepare("SELECT advanced_at AS advancedAt FROM sessions WHERE thread_id = 'thr_source'").get() as { advancedAt: number | null }).advancedAt, null);
    db.close();
  }
});

test("pull request review resolution remains available when the source artifact is missing", async () => {
  const db = makeDb();
  seed(db, "pr-review", "resolve-pr-reviews", { auto_advance: 0 });
  db.prepare("UPDATE sessions SET summary_json = '{}' WHERE thread_id = 'thr_source'").run();
  const { bb, spawns } = fakeBb();
  const prepared = await prepareManualLaunch(bb as never, db, {
    kind: "proceed",
    threadId: "thr_source",
  });
  assert.equal(prepared.displayPrompt, "/rpi-resolve-pr-reviews");
  assert.equal(spawns.length, 0);
  assert.equal((db.prepare("SELECT COUNT(*) AS count FROM launch_attempts").get() as { count: number }).count, 0);
  db.close();
});

test("implementation advancement fails closed when the bound receipt metadata is malformed", async () => {
  const db = makeDb();
  const { taskId } = seed(db, "implementation", "describe-pr", { auto_advance: 0 });
  db.prepare("UPDATE artifacts SET frontmatter_json = ? WHERE task_id = ? AND file_name = '01-implementation-receipt.md'").run(
    stringifyJson({ type: "implementation", completed_phase: "1" }),
    taskId,
  );
  const { bb, spawns } = fakeBb();
  await assert.rejects(
    prepareManualLaunch(bb as never, db, { kind: "completion", threadId: "thr_source", skillId: "describe-pr" }),
    /Phase review metadata is unavailable/,
  );
  await assert.doesNotReject(
    prepareManualLaunch(bb as never, db, { kind: "completion", threadId: "thr_source", skillId: "review-code" }),
  );
  await assert.rejects(
    proceed(bb as never, db, new Map(), createLaunchBindingMirror(), "thr_source"),
    /Phase review metadata is unavailable/,
  );
  assert.equal(spawns.length, 0);
  assert.equal((db.prepare("SELECT COUNT(*) AS count FROM launch_attempts WHERE task_id = ?").get(taskId) as { count: number }).count, 0);
  db.close();
});

test("launchCompletion rejects a stale target phase without claiming or creating an attempt", async () => {
  const db = makeDb();
  const { taskId } = seed(db, "implementation", "describe-pr", { auto_advance: 0 });
  upsertArtifact(db, taskId, "02-plan-demo.md", `---\ntype: plan\n---\n\n## Phase 1: Scaffold\n\n## Phase 2: Wire server\n`, {
    createdBy: "test",
    operation: "test",
  });
  const { bb, spawns } = fakeBb();
  await assert.rejects(
    launchCompletion(bb as never, db, new Map(), createLaunchBindingMirror(), { kind: "completion", threadId: "thr_source", skillId: "implement-plan", phase: 3 }),
    /no longer available/,
  );
  assert.equal(spawns.length, 0);
  assert.equal((db.prepare("SELECT COUNT(*) AS count FROM launch_attempts WHERE task_id = ?").get(taskId) as { count: number }).count, 0);
  assert.equal((db.prepare("SELECT advanced_at AS advancedAt FROM sessions WHERE thread_id = 'thr_source'").get() as { advancedAt: number | null }).advancedAt, null);
  db.close();
});

test("completion submissions are single-winner and revalidate interactions and catalog state", async () => {  {
    const db = makeDb();
    seed(db, "implementation", null, { auto_advance: 0, base_environment_id: "env_base" });
    const { bb, spawns } = fakeBb();
    const bindings = createLaunchBindingMirror();
    const intent = { kind: "completion", threadId: "thr_source", skillId: "describe-pr" } as const;
    const prepared = await prepareManualLaunch(bb as never, db, intent);
    const request = manualRequest({ projectId: prepared.projectId, environment: prepared.environment });
    const settled = await Promise.allSettled([
      submitManualLaunch(bb as never, db, new Map(), bindings, intent, prepared.stateToken, request),
      submitManualLaunch(bb as never, db, new Map(), bindings, intent, prepared.stateToken, request),
    ]);
    assert.equal(settled.filter((result) => result.status === "fulfilled").length, 1);
    assert.equal(spawns.length, 1);
    assert.equal((db.prepare("SELECT COUNT(*) AS count FROM launch_attempts WHERE from_thread_id = 'thr_source'").get() as { count: number }).count, 1);
    db.close();
  }

  {
    const db = makeDb();
    seed(db, "implementation", null, { auto_advance: 0 });
    const options: { pendingInteraction?: boolean } = { pendingInteraction: false };
    const { bb, spawns } = fakeBb(options);
    const intent = { kind: "completion", threadId: "thr_source", skillId: "review-code" } as const;
    const prepared = await prepareManualLaunch(bb as never, db, intent);
    options.pendingInteraction = true;
    await assert.rejects(
      submitManualLaunch(bb as never, db, new Map(), createLaunchBindingMirror(), intent, prepared.stateToken, manualRequest({
        projectId: prepared.projectId,
        environment: prepared.environment,
      })),
      /pending interactions/,
    );
    assert.equal(spawns.length, 0);
    assert.equal((db.prepare("SELECT COUNT(*) AS count FROM launch_attempts").get() as { count: number }).count, 0);
    db.close();
  }
});

test("manual draft preserves the 10,000-character editable limit and keeps linked-ticket instructions server-owned", async () => {
  const db = makeDb();
  const editableText = "x".repeat(MANUAL_LAUNCH_TEXT_LIMIT);
  const taskId = createDraftTask(db, {
    projectId: "proj_1",
    prompt: editableText,
    name: "Boundary draft",
    workflowType: "freeform",
    worktreeTiming: "never",
    permissionMode: "default",
    autoAdvance: false,
    providerId: null,
    model: null,
    reasoningLevel: null,
    serviceTier: null,
  }).taskId;
  const { bb, spawns } = fakeBb();
  const intent = { kind: "draft", taskId } as const;
  const prepared = await prepareManualLaunch(bb as never, db, intent);
  assert.equal(prepared.displayPrompt, editableText);
  assert.doesNotThrow(() => prepareManualLaunchOutputSchema.parse(prepared));

  const request = manualRequest({ input: [{ type: "text", text: editableText, mentions: [] }] });
  const launched = await submitManualLaunch(
    bb as never,
    db,
    new Map(),
    createLaunchBindingMirror(),
    intent,
    prepared.stateToken,
    request,
  );
  assert.equal(launched.threadId, "thr_next_1");
  const input = (spawns[0] as { input: Array<{ text?: string; visibility?: string }> }).input;
  assert.equal(input[1]?.text, editableText);
  assert.equal(input[1]?.visibility, undefined);
  assert.ok(input.at(-1)?.text?.includes(START_LINKED_TICKET_ACTION));
  assert.equal(input.at(-1)?.visibility, "agent-only");
  db.close();
});

test("manual draft Retry restores its server-owned linked-ticket instruction", async () => {
  const db = makeDb();
  const taskId = createDraftTask(db, {
    projectId: "proj_1",
    prompt: "editable draft",
    name: "Retry draft",
    workflowType: "freeform",
    worktreeTiming: "never",
    permissionMode: "default",
    autoAdvance: false,
    providerId: null,
    model: null,
    reasoningLevel: null,
    serviceTier: null,
  }).taskId;
  const options: { spawnError?: Error } = { spawnError: new Error("spawn response lost") };
  const { bb, spawns } = fakeBb(options);
  const bindings = createLaunchBindingMirror();
  const intent = { kind: "draft", taskId } as const;
  const prepared = await prepareManualLaunch(bb as never, db, intent);
  await assert.rejects(
    submitManualLaunch(bb as never, db, new Map(), bindings, intent, prepared.stateToken, manualRequest()),
    /spawn response lost/,
  );
  const attempt = db.prepare("SELECT id FROM launch_attempts WHERE task_id = ?").get(taskId) as { id: string };
  options.spawnError = undefined;
  await resolveLaunchAttempt(bb as never, db, new Map(), bindings, attempt.id, { type: "retry" });
  assert.equal(spawns.length, 2);
  for (const spawn of spawns as Array<{ input: Array<{ text?: string; visibility?: string }> }>) {
    const context = spawn.input.at(-1);
    assert.ok(context?.text?.includes(START_LINKED_TICKET_ACTION));
    assert.equal(context?.visibility, "agent-only");
  }
  db.close();
});

test("manual launch rejects stale or relocated context before creating an attempt", async () => {
  {
    const db = makeDb();
    seed(db, "research-questions", "create-research");
    const { bb } = fakeBb();
    const prepared = await prepareManualLaunch(bb as never, db, { kind: "proceed", threadId: "thr_source" });
    db.prepare("UPDATE sessions SET completed_turn_key = 'turn_new', next_step_turn_key = 'turn_old' WHERE thread_id = 'thr_source'").run();
    await assert.rejects(
      submitManualLaunch(bb as never, db, new Map(), createLaunchBindingMirror(), { kind: "proceed", threadId: "thr_source" }, prepared.stateToken, manualRequest()),
      /stale extraction/,
    );
    assert.equal((db.prepare("SELECT COUNT(*) AS count FROM launch_attempts").get() as { count: number }).count, 0);
    db.close();
  }

  {
    const db = makeDb();
    const taskId = createDraftTask(db, {
      projectId: "proj_1", prompt: "prompt", name: "Task", workflowType: "freeform", worktreeTiming: "never",
      permissionMode: "default", autoAdvance: false, providerId: null, model: null, reasoningLevel: null, serviceTier: null,
    }).taskId;
    const { bb } = fakeBb();
    const prepared = await prepareManualLaunch(bb as never, db, { kind: "skill", taskId, skillId: "create-research" });
    db.prepare("UPDATE tasks SET archived = 1 WHERE id = ?").run(taskId);
    await assert.rejects(
      submitManualLaunch(bb as never, db, new Map(), createLaunchBindingMirror(), { kind: "skill", taskId, skillId: "create-research" }, prepared.stateToken, manualRequest()),
      /archived/,
    );
    assert.equal((db.prepare("SELECT COUNT(*) AS count FROM launch_attempts").get() as { count: number }).count, 0);
    db.close();
  }

  {
    const db = makeDb();
    seed(db, "research", "create-design-discussion");
    const options = { pendingInteraction: false };
    const { bb } = fakeBb(options);
    const prepared = await prepareManualLaunch(bb as never, db, { kind: "iterate", threadId: "thr_source" });
    options.pendingInteraction = true;
    await assert.rejects(
      submitManualLaunch(bb as never, db, new Map(), createLaunchBindingMirror(), { kind: "iterate", threadId: "thr_source" }, prepared.stateToken, manualRequest()),
      /pending interactions/,
    );
    assert.equal((db.prepare("SELECT COUNT(*) AS count FROM launch_attempts").get() as { count: number }).count, 0);
    db.close();
  }

  for (const change of ["project", "workspace"] as const) {
    const db = makeDb();
    const taskId = createDraftTask(db, {
      projectId: "proj_1", prompt: "prompt", name: "Task", workflowType: "freeform", worktreeTiming: "never",
      permissionMode: "default", autoAdvance: false, providerId: null, model: null, reasoningLevel: null, serviceTier: null,
    }).taskId;
    const { bb } = fakeBb();
    const intent = { kind: "skill", taskId, skillId: "create-research" } as const;
    const prepared = await prepareManualLaunch(bb as never, db, intent);
    if (change === "project") db.prepare("UPDATE tasks SET project_id = 'proj_other' WHERE id = ?").run(taskId);
    else db.prepare("UPDATE tasks SET host_id = 'host_seed', default_directory = '/other' WHERE id = ?").run(taskId);
    await assert.rejects(
      submitManualLaunch(bb as never, db, new Map(), createLaunchBindingMirror(), intent, prepared.stateToken, manualRequest({
        projectId: prepared.projectId,
        environment: prepared.environment,
      })),
      /different project|fixed workspace/,
    );
    assert.equal((db.prepare("SELECT COUNT(*) AS count FROM launch_attempts").get() as { count: number }).count, 0);
    db.close();
  }
});

test("manual submit rejects a task mutated during awaited environment resolution", async () => {
  const db = makeDb();
  const taskId = createDraftTask(db, {
    projectId: "proj_1", prompt: "prompt", name: "Task", workflowType: "freeform", worktreeTiming: "never",
    permissionMode: "default", autoAdvance: false, providerId: null, model: null, reasoningLevel: null, serviceTier: null,
  }).taskId;
  const options: { onProjectGet?: () => void } = {};
  const { bb, spawns } = fakeBb(options);
  const intent = { kind: "skill", taskId, skillId: "create-research" } as const;
  const prepared = await prepareManualLaunch(bb as never, db, intent);
  let mutated = false;
  options.onProjectGet = () => {
    mutated = true;
    options.onProjectGet = undefined;
    db.prepare("UPDATE tasks SET host_id = 'host_other', default_directory = '/other' WHERE id = ?").run(taskId);
  };

  await assert.rejects(
    submitManualLaunch(bb as never, db, new Map(), createLaunchBindingMirror(), intent, prepared.stateToken, manualRequest({
      projectId: prepared.projectId,
      environment: prepared.environment,
    })),
    /prepared launch is stale/,
  );
  assert.equal(mutated, true);
  assert.equal(spawns.length, 0);
  assert.equal((db.prepare("SELECT COUNT(*) AS count FROM launch_attempts WHERE task_id = ?").get(taskId) as { count: number }).count, 0);
  db.close();
});

test("concurrent submissions from one prepared state create one successor each", async () => {
  {
    const db = makeDb();
    const { taskId } = seed(db, "research-questions", "create-research", { base_environment_id: "env_base" });
    const { bb, spawns } = fakeBb();
    const bindings = createLaunchBindingMirror();
    const intent = { kind: "proceed", threadId: "thr_source" } as const;
    const prepared = await prepareManualLaunch(bb as never, db, intent);
    const request = manualRequest({ projectId: prepared.projectId, environment: prepared.environment });
    const settled = await Promise.allSettled([
      submitManualLaunch(bb as never, db, new Map(), bindings, intent, prepared.stateToken, request),
      submitManualLaunch(bb as never, db, new Map(), bindings, intent, prepared.stateToken, request),
    ]);
    assert.equal(settled.filter((result) => result.status === "fulfilled").length, 1);
    assert.equal(spawns.length, 1);
    assert.equal((db.prepare("SELECT COUNT(*) AS count FROM launch_attempts WHERE task_id = ?").get(taskId) as { count: number }).count, 1);
    db.close();
  }

  {
    const db = makeDb();
    const taskId = createDraftTask(db, {
      projectId: "proj_1", prompt: "prompt", name: "Task", workflowType: "freeform", worktreeTiming: "never",
      permissionMode: "default", autoAdvance: false, providerId: null, model: null, reasoningLevel: null, serviceTier: null,
    }).taskId;
    db.prepare("UPDATE tasks SET base_environment_id = 'env_base' WHERE id = ?").run(taskId);
    const { bb, spawns } = fakeBb();
    const bindings = createLaunchBindingMirror();
    const intent = { kind: "skill", taskId, skillId: "create-research" } as const;
    const prepared = await prepareManualLaunch(bb as never, db, intent);
    const request = manualRequest({ projectId: prepared.projectId, environment: prepared.environment });
    const settled = await Promise.allSettled([
      submitManualLaunch(bb as never, db, new Map(), bindings, intent, prepared.stateToken, request),
      submitManualLaunch(bb as never, db, new Map(), bindings, intent, prepared.stateToken, request),
    ]);
    assert.equal(settled.filter((result) => result.status === "fulfilled").length, 1);
    const rejected = settled.find((result) => result.status === "rejected");
    assert.match(String(rejected && rejected.status === "rejected" ? rejected.reason : ""), /prepared launch is stale/);
    assert.equal(spawns.length, 1);
    assert.equal((db.prepare("SELECT COUNT(*) AS count FROM launch_attempts WHERE task_id = ?").get(taskId) as { count: number }).count, 1);
    db.close();
  }
});

test("a fresh preparation permits a second launch of the same skill", async () => {
  const db = makeDb();
  const taskId = createDraftTask(db, {
    projectId: "proj_1", prompt: "prompt", name: "Task", workflowType: "freeform", worktreeTiming: "never",
    permissionMode: "default", autoAdvance: false, providerId: null, model: null, reasoningLevel: null, serviceTier: null,
  }).taskId;
  const { bb, spawns } = fakeBb();
  const bindings = createLaunchBindingMirror();
  const intent = { kind: "skill", taskId, skillId: "create-research" } as const;

  const first = await prepareManualLaunch(bb as never, db, intent);
  await submitManualLaunch(bb as never, db, new Map(), bindings, intent, first.stateToken, manualRequest({
    projectId: first.projectId,
    environment: first.environment,
  }));
  const second = await prepareManualLaunch(bb as never, db, intent);
  assert.notEqual(second.stateToken, first.stateToken);
  await submitManualLaunch(bb as never, db, new Map(), bindings, intent, second.stateToken, manualRequest({
    projectId: second.projectId,
    environment: second.environment,
  }));

  assert.equal(spawns.length, 2);
  assert.equal((db.prepare("SELECT COUNT(*) AS count FROM launch_attempts WHERE task_id = ? AND status = 'spawned'").get(taskId) as { count: number }).count, 2);
  db.close();
});

test("a stale Iterate stays rejected after an intervening launch changes the latest attempt", async () => {
  const db = makeDb();
  const { taskId } = seed(db, "research", "create-design-discussion");
  const { bb, spawns } = fakeBb();
  const bindings = createLaunchBindingMirror();
  const iterateIntent = { kind: "iterate", threadId: "thr_source" } as const;
  const stale = await prepareManualLaunch(bb as never, db, iterateIntent);
  await submitManualLaunch(bb as never, db, new Map(), bindings, iterateIntent, stale.stateToken, manualRequest({
    projectId: stale.projectId,
    environment: stale.environment,
  }));

  const skillIntent = { kind: "skill", taskId, skillId: "create-research" } as const;
  const intervening = await prepareManualLaunch(bb as never, db, skillIntent);
  await submitManualLaunch(bb as never, db, new Map(), bindings, skillIntent, intervening.stateToken, manualRequest({
    projectId: intervening.projectId,
    environment: intervening.environment,
  }));

  await assert.rejects(
    submitManualLaunch(bb as never, db, new Map(), bindings, iterateIntent, stale.stateToken, manualRequest()),
    /source session already has a successor/,
  );
  await assert.rejects(
    prepareManualLaunch(bb as never, db, iterateIntent),
    /source session already has a successor/,
  );
  assert.equal(spawns.length, 2);
  db.close();
});

test("failed manual launch keeps the validated request on its recoverable attempt", async () => {
  const db = makeDb();
  const taskId = createDraftTask(db, {
    projectId: "proj_1", prompt: "prompt", name: "Task", workflowType: "freeform", worktreeTiming: "never",
    permissionMode: "default", autoAdvance: false, providerId: null, model: null, reasoningLevel: null, serviceTier: null,
  }).taskId;
  const request = manualRequest();
  const { bb } = fakeBb({ spawnError: new Error("spawn response lost") });
  const intent = { kind: "skill", taskId, skillId: "create-research" } as const;
  const prepared = await prepareManualLaunch(bb as never, db, intent);
  await assert.rejects(
    submitManualLaunch(bb as never, db, new Map(), createLaunchBindingMirror(), intent, prepared.stateToken, request),
    /spawn response lost/,
  );
  const attempt = db.prepare("SELECT status, request_json AS requestJson FROM launch_attempts WHERE task_id = ?").get(taskId) as { status: string; requestJson: string };
  assert.equal(attempt.status, "uncertain");
  assert.deepEqual(JSON.parse(attempt.requestJson), request);
  db.close();
});

test("iterateSkillForLabel resolves a label's iterate skill or null when it has none", () => {
  assert.equal(iterateSkillForLabel("research"), "iterate-research");
  assert.equal(iterateSkillForLabel("plan"), "iterate-plan");
  assert.equal(iterateSkillForLabel("code-review"), "review-code");
  assert.equal(iterateSkillForLabel("review-fixes"), "fix-code-review");
  assert.equal(iterateSkillForLabel("pr-review"), "resolve-pr-reviews");
  assert.equal(iterateSkillForLabel(null), null);
  assert.equal(iterateSkillForLabel("describe-pr"), null);
});
