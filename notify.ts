import { randomUUID } from "node:crypto";
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import type * as BetterSqlite3 from "better-sqlite3";
import { consumeSuppression, nowMs, readRow, readRows, writeRow } from "./db";
import type { SessionRow } from "./contract";

type Database = BetterSqlite3.Database;

export type NotificationKind = "ready_for_input" | "needs_approval" | "comment";

// Recorded alongside NotificationKind values but never selected by user prefs directly;
// it reuses the ready_for_input sound/toast prefs (see recoverReadyAfterFailedAdvance).
export type StoredNotificationKind = NotificationKind | "ready_after_failed_advance";

export type NotificationPrefs = {
  enabled: boolean;
  sound: Record<NotificationKind, boolean>;
  toast: Record<NotificationKind, boolean>;
  volume: number;
  jumpHotkey: string;
};

export type NotificationToast = {
  title: string;
  body: string;
  threadId: string;
};

export type NotificationDecision = {
  sound: boolean;
  toast: NotificationToast | null;
  reason:
    | "not_a_trigger"
    | "already_notified"
    | "not_owner"
    | "auto_advance_suppressed"
    | "viewing_session"
    | "notifications_disabled"
    | "toast_disabled"
    | "notify";
};

export type NotificationEvent =
  | {
      type: "status_transition";
      threadId: string;
      previousStatus: string | null;
      nextStatus: string;
      completedTurnKey: string | null;
      title?: string | null;
      summary?: string | null;
      approval?: ApprovalNotificationInfo | null;
    }
  | {
      type: "comment";
      threadId: string;
      taskId: string;
      artifactId: string;
      commentId: string;
      commentText: string;
      createdByAgent: boolean;
      title?: string | null;
    };

export type ApprovalNotificationInfo = {
  id: string;
  toolName: string | null;
  toolInput: string | null;
};

export type NotificationState = {
  prefs: NotificationPrefs;
  alreadyNotified: boolean;
  owner: "matches" | "not_owner" | "unknown";
  autoAdvanceSuppressed: boolean;
  viewing: boolean;
};

export type NotificationRecord = {
  id: string;
  threadId: string;
  kind: StoredNotificationKind;
  dedupeKey: string;
  reason: NotificationDecision["reason"];
  sound: boolean;
  toastTitle: string | null;
  toastBody: string | null;
  createdAt: number;
  deliveredAt: number | null;
};

const DEFAULT_KIND_PREFS: Record<NotificationKind, boolean> = {
  ready_for_input: true,
  needs_approval: true,
  comment: true,
};

export const DEFAULT_NOTIFICATION_PREFS: NotificationPrefs = {
  enabled: true,
  sound: { ...DEFAULT_KIND_PREFS },
  toast: { ...DEFAULT_KIND_PREFS },
  volume: 0.2,
  jumpHotkey: "mod+shift+u",
};

export function normalizeNotificationPrefs(input: Partial<NotificationPrefs> | null | undefined): NotificationPrefs {
  return {
    enabled: input?.enabled ?? DEFAULT_NOTIFICATION_PREFS.enabled,
    sound: { ...DEFAULT_KIND_PREFS, ...(input?.sound ?? {}) },
    toast: { ...DEFAULT_KIND_PREFS, ...(input?.toast ?? {}) },
    volume: clampVolume(input?.volume),
    jumpHotkey: normalizeHotkey(input?.jumpHotkey),
  };
}

export function clampVolume(input: unknown) {
  const value = typeof input === "number" ? input : Number.parseFloat(String(input ?? DEFAULT_NOTIFICATION_PREFS.volume));
  if (!Number.isFinite(value)) return DEFAULT_NOTIFICATION_PREFS.volume;
  return Math.min(1, Math.max(0, value));
}

export function normalizeHotkey(input: unknown) {
  const value = String(input ?? "").trim().toLowerCase().replaceAll("cmd", "mod").replaceAll("⌘", "mod");
  return value || DEFAULT_NOTIFICATION_PREFS.jumpHotkey;
}

export function notificationKind(event: NotificationEvent): NotificationKind | null {
  if (event.type === "comment") return event.createdByAgent ? null : "comment";
  if (event.nextStatus === "ready_for_input" && event.previousStatus !== "ready_for_input") return "ready_for_input";
  if (event.nextStatus === "needs_approval" && event.approval?.id) return "needs_approval";
  return null;
}

export function notificationDedupeKey(event: NotificationEvent) {
  const kind = notificationKind(event);
  if (!kind) return null;
  if (kind === "comment" && event.type === "comment") return `comment:${event.commentId}`;
  if (kind === "needs_approval" && event.type === "status_transition") return `approval:${event.threadId}:${event.approval?.id}`;
  if (event.type === "status_transition") return `ready:${event.threadId}:${event.completedTurnKey ?? "unknown"}`;
  return null;
}

export function decideNotification(event: NotificationEvent, state: NotificationState): NotificationDecision {
  const kind = notificationKind(event);
  if (!kind) return { sound: false, toast: null, reason: "not_a_trigger" };
  if (state.alreadyNotified) return { sound: false, toast: null, reason: "already_notified" };
  if (state.owner === "not_owner") return { sound: false, toast: null, reason: "not_owner" };
  if (state.autoAdvanceSuppressed) return { sound: false, toast: null, reason: "auto_advance_suppressed" };
  const sound = state.prefs.enabled && state.prefs.sound[kind];
  if (state.viewing) return { sound, toast: null, reason: "viewing_session" };
  if (!state.prefs.enabled) return { sound: false, toast: null, reason: "notifications_disabled" };
  if (!state.prefs.toast[kind]) return { sound, toast: null, reason: "toast_disabled" };
  return { sound, toast: buildToast(event, kind), reason: "notify" };
}

export function buildToast(event: NotificationEvent, kind: NotificationKind): NotificationToast {
  if (kind === "comment" && event.type === "comment") {
    return {
      title: "comment",
      body: truncateOneLine(event.commentText || `Artifact ${event.artifactId.slice(0, 8)}`, 50),
      threadId: event.threadId,
    };
  }
  if (event.type !== "status_transition") return { title: kind, body: `Session ${event.threadId.slice(0, 8)}`, threadId: event.threadId };
  const body = truncateOneLine(event.title || event.summary || `Session ${event.threadId.slice(0, 8)}`, kind === "needs_approval" ? 50 : 40);
  if (kind === "needs_approval" && event.type === "status_transition" && event.approval) {
    const tool = formatToolName(event.approval.toolName ?? "approval");
    const input = truncateOneLine(event.approval.toolInput ?? "", 47);
    return {
      title: "needs_approval",
      body: input ? `${body} ${tool} using ${input}` : `${body} ${tool}`,
      threadId: event.threadId,
    };
  }
  return { title: "ready_for_input", body, threadId: event.threadId };
}

export function formatToolName(input: string) {
  const match = /^mcp__([^_]+)__(.+)$/.exec(input);
  return match ? `${match[1]}:${match[2].replaceAll("__", ".")}` : input;
}

export function truncateOneLine(input: string, max: number) {
  const line = input.replace(/\s+/g, " ").trim();
  return line.length > max ? `${line.slice(0, Math.max(0, max - 3))}...` : line;
}

export function approvalFromInteractions(interactions: readonly unknown[]): ApprovalNotificationInfo | null {
  for (const raw of interactions) {
    const interaction = raw as {
      id?: string;
      status?: string;
      resolution?: unknown;
      payload?: {
        kind?: string;
        tool_name?: string;
        toolName?: string;
        tool_input?: unknown;
        toolInput?: unknown;
        subject?: {
          kind?: string;
          toolName?: string;
          tool_name?: string;
          command?: string;
          input?: unknown;
          actions?: Array<{ command?: string }>;
        };
      } | null;
    };
    const pending = interaction.status === "pending" || (interaction.status === undefined && interaction.resolution == null);
    if (!pending || interaction.payload?.kind !== "approval" || !interaction.id) continue;
    const subject = interaction.payload.subject;
    const toolName = interaction.payload.toolName ?? interaction.payload.tool_name ?? subject?.toolName ?? subject?.tool_name ?? subject?.kind ?? null;
    const toolInput = interaction.payload.toolInput ?? interaction.payload.tool_input ?? subject?.input ?? subject?.command ?? subject?.actions?.[0]?.command ?? null;
    return { id: interaction.id, toolName, toolInput: stringifyToolInput(toolInput) };
  }
  return null;
}

function stringifyToolInput(input: unknown) {
  if (input === null || input === undefined) return null;
  if (typeof input === "string") return input;
  try {
    return JSON.stringify(input);
  } catch {
    return String(input);
  }
}

export function notificationAlreadyRecorded(db: Database, dedupeKey: string) {
  return Boolean(readRow<{ id: string }>(db, "SELECT id FROM notifications WHERE dedupe_key = ?", dedupeKey));
}

export function recordNotificationDecision(db: Database, event: NotificationEvent, kind: StoredNotificationKind, dedupeKey: string, decision: NotificationDecision) {
  const timestamp = nowMs();
  const id = randomUUID();
  writeRow(
    db,
    `
    INSERT OR IGNORE INTO notifications (
      id, thread_id, kind, dedupe_key, reason, sound, toast_title, toast_body, created_at, delivered_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    id,
    event.threadId,
    kind,
    dedupeKey,
    decision.reason,
    decision.sound ? 1 : 0,
    decision.toast?.title ?? null,
    decision.toast?.body ?? null,
    timestamp,
    decision.sound || decision.toast ? timestamp : null,
  );
}

export async function decideAndPublishNotification(
  bb: BbPluginApi,
  db: Database,
  event: NotificationEvent,
  state: Omit<NotificationState, "alreadyNotified" | "autoAdvanceSuppressed"> & { autoAdvanceTurnKey?: string | null },
) {
  const kind = notificationKind(event);
  const dedupeKey = notificationDedupeKey(event);
  if (!kind || !dedupeKey) {
    return decideNotification(event, {
      ...state,
      alreadyNotified: false,
      autoAdvanceSuppressed: false,
    });
  }
  const alreadyNotified = notificationAlreadyRecorded(db, dedupeKey);
  const autoAdvanceSuppressed = !alreadyNotified && event.type === "status_transition" && kind === "ready_for_input" && event.completedTurnKey
    ? consumeSuppression(db, event.threadId, event.completedTurnKey)
    : false;
  const decision = decideNotification(event, {
    ...state,
    alreadyNotified,
    autoAdvanceSuppressed,
  });
  recordNotificationDecision(db, event, kind, dedupeKey, decision);
  if (decision.sound || decision.toast) {
    bb.realtime.publish("hl:notify", {
      id: dedupeKey,
      kind,
      threadId: event.threadId,
      sound: decision.sound,
      toast: decision.toast,
      volume: state.prefs.volume,
      reason: decision.reason,
    });
  }
  return decision;
}

export function listNotificationRecords(db: Database, limit: number): NotificationRecord[] {
  return readRows<{
    id: string;
    threadId: string;
    kind: StoredNotificationKind;
    dedupeKey: string;
    reason: NotificationDecision["reason"];
    sound: number | boolean;
    toastTitle: string | null;
    toastBody: string | null;
    createdAt: number;
    deliveredAt: number | null;
  }>(
    db,
    `
    SELECT
      id,
      thread_id AS threadId,
      kind,
      dedupe_key AS dedupeKey,
      reason,
      sound,
      toast_title AS toastTitle,
      toast_body AS toastBody,
      created_at AS createdAt,
      delivered_at AS deliveredAt
    FROM notifications
    ORDER BY created_at DESC
    LIMIT ?
    `,
    limit,
  ).map((row) => ({ ...row, sound: Boolean(row.sound) }));
}

// Retention keeps rows for threads whose owning task is not archived, regardless of age;
// only archived-task threads are swept once their notifications are old enough.
export function sweepOldNotifications(db: Database, olderThanMs = 30 * 24 * 60 * 60 * 1000) {
  const cutoff = nowMs() - olderThanMs;
  return writeRow(
    db,
    `
    DELETE FROM notifications
    WHERE created_at < ?
      AND thread_id IN (
        SELECT sessions.thread_id FROM sessions
        JOIN tasks ON tasks.id = sessions.task_id
        WHERE tasks.archived = 1
      )
    `,
    cutoff,
  ).changes;
}

export function sweepOldSuppressions(db: Database, olderThanMs = 7 * 24 * 60 * 60 * 1000) {
  const cutoff = nowMs() - olderThanMs;
  return writeRow(
    db,
    `
    DELETE FROM notification_suppressions
    WHERE created_at < ?
      AND (
        consumed_at IS NOT NULL
        OR thread_id IN (
          SELECT sessions.thread_id FROM sessions
          JOIN tasks ON tasks.id = sessions.task_id
          WHERE tasks.archived = 1
        )
      )
    `,
    cutoff,
  ).changes;
}

/**
 * Recovers from an auto-advance launch that failed or ended up uncertain. The suppression row
 * inserted when the advance was claimed would otherwise mute the ready_for_input notification
 * forever, leaving the user unaware the session is stuck. Consumes that suppression (idempotent:
 * a second call for the same thread/turnKey is a no-op) and records/publishes exactly one
 * ready_after_failed_advance notification, reusing the ready_for_input sound/toast prefs.
 */
export async function recoverReadyAfterFailedAdvance(
  bb: BbPluginApi,
  db: Database,
  prefs: NotificationPrefs,
  params: { threadId: string; completedTurnKey: string; failedSkillLabel: string | null },
) {
  const consumed = consumeSuppression(db, params.threadId, params.completedTurnKey);
  if (!consumed) return null;
  const dedupeKey = `ready-recover:${params.threadId}:${params.completedTurnKey}`;
  const sound = prefs.enabled && prefs.sound.ready_for_input;
  const toastAllowed = prefs.enabled && prefs.toast.ready_for_input;
  const toast: NotificationToast | null = toastAllowed
    ? {
        title: "ready_for_input",
        body: `Auto-advance failed to launch ${params.failedSkillLabel ?? "the next step"}. Retry it from Launch Attempts.`,
        threadId: params.threadId,
      }
    : null;
  const timestamp = nowMs();
  writeRow(
    db,
    `
    INSERT OR IGNORE INTO notifications (
      id, thread_id, kind, dedupe_key, reason, sound, toast_title, toast_body, created_at, delivered_at
    ) VALUES (?, ?, 'ready_after_failed_advance', ?, 'notify', ?, ?, ?, ?, ?)
    `,
    randomUUID(),
    params.threadId,
    dedupeKey,
    sound ? 1 : 0,
    toast?.title ?? null,
    toast?.body ?? null,
    timestamp,
    sound || toast ? timestamp : null,
  );
  if (sound || toast) {
    bb.realtime.publish("hl:notify", {
      id: dedupeKey,
      kind: "ready_after_failed_advance",
      threadId: params.threadId,
      sound,
      toast,
      volume: prefs.volume,
      reason: "notify",
    });
  }
  return { sound, toast };
}

/**
 * CLI "notifications test" path. Uses a dedicated `test:<thread>:<ts>` dedupe namespace that can
 * never collide with a real ready/approval dedupe key, so it never marks a real completed turn or
 * approval id as already-notified, and never consumes a real notification_suppressions row.
 * Publishes with `synthetic: true` so the UI can label the resulting toast "Test".
 */
export function publishSyntheticTestNotification(
  bb: BbPluginApi,
  db: Database,
  prefs: NotificationPrefs,
  params: { threadId: string; title: string; body: string | null },
): NotificationDecision {
  const dedupeKey = `test:${params.threadId}:${nowMs()}`;
  const sound = prefs.enabled && prefs.sound.ready_for_input;
  const toastAllowed = prefs.enabled && prefs.toast.ready_for_input;
  const toast: NotificationToast | null = toastAllowed
    ? { title: params.title, body: params.body ?? `Session ${params.threadId.slice(0, 8)}`, threadId: params.threadId }
    : null;
  const decision: NotificationDecision = { sound, toast, reason: "notify" };
  recordNotificationDecision(
    db,
    { type: "status_transition", threadId: params.threadId, previousStatus: "running", nextStatus: "ready_for_input", completedTurnKey: dedupeKey },
    "ready_for_input",
    dedupeKey,
    decision,
  );
  if (sound || toast) {
    bb.realtime.publish("hl:notify", {
      id: dedupeKey,
      kind: "ready_for_input",
      threadId: params.threadId,
      sound,
      toast,
      volume: prefs.volume,
      reason: "notify",
      synthetic: true,
    });
  }
  return decision;
}

export function notificationSummaryFromSession(session: SessionRow) {
  if (!session.summaryJson) return null;
  try {
    const summary = JSON.parse(session.summaryJson) as { summaryHistory?: unknown[] };
    const last = Array.isArray(summary.summaryHistory) ? summary.summaryHistory.at(-1) : null;
    return typeof last === "string" ? last : null;
  } catch {
    return null;
  }
}
