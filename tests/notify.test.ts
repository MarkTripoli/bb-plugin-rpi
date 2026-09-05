import test from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { MIGRATIONS } from "../db";
import { createDraftTask } from "../tasks";
import {
  DEFAULT_NOTIFICATION_PREFS,
  approvalFromInteractions,
  buildToast,
  clampVolume,
  decideAndPublishNotification,
  decideNotification,
  formatToolName,
  normalizeNotificationPrefs,
  notificationDedupeKey,
  notificationKind,
  sweepOldNotifications,
  sweepOldSuppressions,
  type NotificationEvent,
  type NotificationState,
} from "../notify";

function baseState(overrides: Partial<NotificationState> = {}): NotificationState {
  return {
    prefs: DEFAULT_NOTIFICATION_PREFS,
    alreadyNotified: false,
    owner: "unknown",
    autoAdvanceSuppressed: false,
    viewing: false,
    ...overrides,
  };
}

function readyEvent(completedTurnKey = "turn_1", previousStatus: string | null = "running"): NotificationEvent {
  return {
    type: "status_transition",
    threadId: "thr_1",
    previousStatus,
    nextStatus: "ready_for_input",
    completedTurnKey,
    title: "Task title",
  };
}

function makeDb() {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  for (const statement of MIGRATIONS) db.exec(statement);
  return db;
}

test("decideNotification applies suppression rules in order", () => {
  const runningEvent: NotificationEvent = {
    type: "status_transition",
    threadId: "thr_1",
    previousStatus: "ready_for_input",
    nextStatus: "running",
    completedTurnKey: "turn_1",
  };
  assert.equal(decideNotification(runningEvent, baseState()).reason, "not_a_trigger");
  assert.equal(decideNotification(readyEvent(), baseState({ alreadyNotified: true, autoAdvanceSuppressed: true, viewing: true })).reason, "already_notified");
  assert.equal(decideNotification(readyEvent(), baseState({ owner: "not_owner", autoAdvanceSuppressed: true, viewing: true })).reason, "not_owner");
  assert.equal(decideNotification(readyEvent(), baseState({ autoAdvanceSuppressed: true, viewing: true })).reason, "auto_advance_suppressed");
  const viewing = decideNotification(readyEvent(), baseState({ viewing: true }));
  assert.equal(viewing.reason, "viewing_session");
  assert.equal(viewing.sound, true);
  assert.equal(viewing.toast, null);
  assert.equal(decideNotification(readyEvent(), baseState({ prefs: { ...DEFAULT_NOTIFICATION_PREFS, enabled: false } })).reason, "notifications_disabled");
  assert.equal(decideNotification(readyEvent(), baseState({ prefs: { ...DEFAULT_NOTIFICATION_PREFS, toast: { ...DEFAULT_NOTIFICATION_PREFS.toast, ready_for_input: false } } })).reason, "toast_disabled");
  assert.equal(decideNotification(readyEvent(), baseState()).reason, "notify");
});

test("ready transition detection dedupes by completed turn key", () => {
  assert.equal(notificationKind(readyEvent("turn_1", "running")), "ready_for_input");
  assert.equal(notificationDedupeKey(readyEvent("turn_1", "running")), "ready:thr_1:turn_1");
  assert.equal(notificationKind(readyEvent("turn_1", "ready_for_input")), null);
  assert.equal(notificationDedupeKey(readyEvent("turn_2", "running")), "ready:thr_1:turn_2");
});

test("needs approval formats tool names and input summary", () => {
  const approval = approvalFromInteractions([{
    id: "pint_1",
    status: "pending",
    payload: {
      kind: "approval",
      toolName: "mcp__github__create_pr",
      toolInput: { title: "Open a PR\nwith details that exceed the one line cap" },
    },
  }]);
  assert.deepEqual(approval, {
    id: "pint_1",
    toolName: "mcp__github__create_pr",
    toolInput: "{\"title\":\"Open a PR\\nwith details that exceed the one line cap\"}",
  });
  assert.equal(formatToolName("mcp__github__create_pr"), "github:create_pr");
  const decision = decideNotification({
    type: "status_transition",
    threadId: "thr_1",
    previousStatus: "running",
    nextStatus: "needs_approval",
    completedTurnKey: null,
    title: "Approval title",
    approval,
  }, baseState());
  assert.equal(decision.toast?.title, "needs_approval");
  assert.match(decision.toast?.body ?? "", /github:create_pr using/);
  assert.equal((decision.toast?.body ?? "").includes("\n"), false);
});

test("comment notification fires for human comments, not own agent comments", () => {
  assert.equal(notificationKind({
    type: "comment",
    threadId: "thr_1",
    taskId: "task_1",
    artifactId: "artifact_1",
    commentId: "comment_1",
    commentText: "please adjust this",
    createdByAgent: false,
  }), "comment");
  assert.equal(notificationKind({
    type: "comment",
    threadId: "thr_1",
    taskId: "task_1",
    artifactId: "artifact_1",
    commentId: "comment_2",
    commentText: "done",
    createdByAgent: true,
  }), null);
});

test("notification volume is clamped", () => {
  assert.equal(clampVolume(-1), 0);
  assert.equal(clampVolume(2), 1);
  assert.equal(clampVolume("0.35"), 0.35);
  assert.equal(normalizeNotificationPrefs({ volume: Number.NaN }).volume, 0.2);
});

test("adapter records decisions and consumes auto-advance suppression once", async () => {
  const db = makeDb();
  const published: unknown[] = [];
  const bb = { realtime: { publish: (_channel: string, payload: unknown) => published.push(payload) } };
  db.prepare("INSERT INTO notification_suppressions (thread_id, completed_turn_key, reason, created_at) VALUES ('thr_1', 'turn_1', 'auto_advance', 1)").run();
  const first = await decideAndPublishNotification(bb as never, db, readyEvent("turn_1"), {
    prefs: DEFAULT_NOTIFICATION_PREFS,
    owner: "unknown",
    viewing: false,
  });
  assert.equal(first.reason, "auto_advance_suppressed");
  assert.equal(published.length, 0);
  const duplicate = await decideAndPublishNotification(bb as never, db, readyEvent("turn_1"), {
    prefs: DEFAULT_NOTIFICATION_PREFS,
    owner: "unknown",
    viewing: false,
  });
  assert.equal(duplicate.reason, "already_notified");
  const secondTurn = await decideAndPublishNotification(bb as never, db, readyEvent("turn_2"), {
    prefs: DEFAULT_NOTIFICATION_PREFS,
    owner: "unknown",
    viewing: false,
  });
  assert.equal(secondTurn.reason, "notify");
  assert.equal(published.length, 1);
  db.close();
});

function seedSessionForRetention(db: Database.Database, threadId: string, archived: boolean) {
  const taskId = createDraftTask(db, {
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
  if (archived) db.prepare("UPDATE tasks SET archived = 1 WHERE id = ?").run(taskId);
  db.prepare(`
    INSERT INTO sessions (
      thread_id, task_id, label, skill_id, launched_by, forked_from_thread_id,
      hl_status, hl_status_at, had_turn, interrupted, blocked_reason, created_at, updated_at
    ) VALUES (?, ?, NULL, NULL, 'user', NULL, 'ready_for_input', 1, 1, 0, NULL, 1, 1)
  `).run(threadId, taskId);
}

test("retention sweeps only archived-task notifications and suppressions once old enough", () => {
  const db = makeDb();
  const oldCreatedAt = 1;
  const recentCreatedAt = Date.now();
  seedSessionForRetention(db, "thr_archived", true);
  seedSessionForRetention(db, "thr_active", false);

  db.prepare("INSERT INTO notifications (id, thread_id, kind, dedupe_key, reason, sound, created_at) VALUES ('n1', 'thr_archived', 'ready_for_input', 'ready:thr_archived:1', 'notify', 0, ?)").run(oldCreatedAt);
  db.prepare("INSERT INTO notifications (id, thread_id, kind, dedupe_key, reason, sound, created_at) VALUES ('n2', 'thr_active', 'ready_for_input', 'ready:thr_active:1', 'notify', 0, ?)").run(oldCreatedAt);
  db.prepare("INSERT INTO notifications (id, thread_id, kind, dedupe_key, reason, sound, created_at) VALUES ('n3', 'thr_archived', 'ready_for_input', 'ready:thr_archived:2', 'notify', 0, ?)").run(recentCreatedAt);

  db.prepare("INSERT INTO notification_suppressions (thread_id, completed_turn_key, reason, created_at, consumed_at) VALUES ('thr_active', 'turn_consumed', 'auto_advance', ?, ?)").run(oldCreatedAt, oldCreatedAt);
  db.prepare("INSERT INTO notification_suppressions (thread_id, completed_turn_key, reason, created_at, consumed_at) VALUES ('thr_active', 'turn_unconsumed', 'auto_advance', ?, NULL)").run(oldCreatedAt);
  db.prepare("INSERT INTO notification_suppressions (thread_id, completed_turn_key, reason, created_at, consumed_at) VALUES ('thr_archived', 'turn_old_unconsumed', 'auto_advance', ?, NULL)").run(oldCreatedAt);

  sweepOldNotifications(db, 24 * 60 * 60 * 1000);
  sweepOldSuppressions(db, 24 * 60 * 60 * 1000);

  const notificationIds = (db.prepare("SELECT id FROM notifications ORDER BY id").all() as Array<{ id: string }>).map((row) => row.id);
  assert.deepEqual(notificationIds, ["n2", "n3"]);

  const suppressionKeys = (db.prepare("SELECT thread_id AS threadId, completed_turn_key AS completedTurnKey FROM notification_suppressions ORDER BY completed_turn_key").all() as Array<{ threadId: string; completedTurnKey: string }>);
  assert.deepEqual(suppressionKeys, [{ threadId: "thr_active", completedTurnKey: "turn_unconsumed" }]);
  db.close();
});

test("retention also sweeps individually archived threads (task open) and rows with no session at all", () => {
  const db = makeDb();
  const oldCreatedAt = 1;
  seedSessionForRetention(db, "thr_open_active", false);
  seedSessionForRetention(db, "thr_open_thread_archived", false);
  db.prepare("UPDATE sessions SET thread_archived_at = ? WHERE thread_id = 'thr_open_thread_archived'").run(oldCreatedAt);

  db.prepare("INSERT INTO notifications (id, thread_id, kind, dedupe_key, reason, sound, created_at) VALUES ('n1', 'thr_open_active', 'ready_for_input', 'ready:thr_open_active:1', 'notify', 0, ?)").run(oldCreatedAt);
  db.prepare("INSERT INTO notifications (id, thread_id, kind, dedupe_key, reason, sound, created_at) VALUES ('n2', 'thr_open_thread_archived', 'ready_for_input', 'ready:thr_open_thread_archived:1', 'notify', 0, ?)").run(oldCreatedAt);
  db.prepare("INSERT INTO notifications (id, thread_id, kind, dedupe_key, reason, sound, created_at) VALUES ('n3', 'thr_never_had_a_session', 'ready_for_input', 'ready:thr_never_had_a_session:1', 'notify', 0, ?)").run(oldCreatedAt);

  sweepOldNotifications(db, 24 * 60 * 60 * 1000);

  const notificationIds = (db.prepare("SELECT id FROM notifications ORDER BY id").all() as Array<{ id: string }>).map((row) => row.id);
  assert.deepEqual(notificationIds, ["n1"]);
  db.close();
});

test("buildToast appends the suggested-next hint to a ready_for_input toast body, and never for other kinds", () => {
  const base: NotificationEvent = {
    type: "status_transition",
    threadId: "thr_1",
    previousStatus: "running",
    nextStatus: "ready_for_input",
    completedTurnKey: "turn_1",
    title: "My task",
    summary: "Done",
  };
  const withoutHint = buildToast(base, "ready_for_input");
  assert.equal(withoutHint.body, "My task");

  const withHint = buildToast({ ...base, suggestedNextHint: "Suggested next: proceed to research" }, "ready_for_input");
  assert.equal(withHint.body, "My task - Suggested next: proceed to research");
  assert.equal(withHint.body.includes("\u2014"), false, "no em dashes in notification copy");

  // needs_approval never carries the ready_for_input suggested-next hint.
  const approvalToast = buildToast({ ...base, nextStatus: "needs_approval", suggestedNextHint: "Suggested next: proceed to research", approval: { id: "a1", toolName: "Bash", toolInput: "ls" } }, "needs_approval");
  assert.equal(approvalToast.body.includes("Suggested next"), false);
});
