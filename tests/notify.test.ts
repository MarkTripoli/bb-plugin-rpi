import test from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { MIGRATIONS } from "../db";
import {
  DEFAULT_NOTIFICATION_PREFS,
  approvalFromInteractions,
  clampVolume,
  decideAndPublishNotification,
  decideNotification,
  formatToolName,
  normalizeNotificationPrefs,
  notificationDedupeKey,
  notificationKind,
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
