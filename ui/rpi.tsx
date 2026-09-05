import { useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent, RefObject } from "react";
import {
  Markdown,
  experimental_SourceCode as SourceCode,
  experimental_useSidebarThreads,
  useBbContext,
  useBbNavigate,
  useRealtime,
  useRpc,
  useSettings,
} from "@get-bb/plugin-sdk/app";
import type { PluginSidebarThread, PluginThreadListProps } from "@get-bb/plugin-sdk/app";
import { toast } from "sonner";
import type {
  ArtifactRecord,
  ArtifactVersionRecord,
  LaunchAttemptRecord,
  NextStepSuggestionsRecord,
  Prefs,
  RpcContract,
  SessionView,
  TaskRecord,
  TaskRow,
  TaskUiState,
  TaskWorkspaceState,
  WorkflowOverride,
  WorkflowType,
  WorkspaceViewRecord,
  CommentThreadRecord,
} from "../contract";
import { AUTO_ADVANCE, BOARD_COLUMNS, WORKFLOW_GRAPH_LABELS, WORKFLOW_GRAPHS, suggestedNextForSession, type SuggestedNext } from "../transitions";
import { markdownBlocks } from "../blocks";
import { ScratchPadSync } from "../scratch-pad-sync";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Icon } from "@/components/ui/icon";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

// Launch RPCs (launchDraft, launchSkill, proceed, resolveLaunchAttempt retry) can reject with a
// LaunchRejectedError (launch.ts), e.g. code `no_source_host` when a task has no project source
// and no host. Show its message instead of failing silently.
function reportLaunchError(error: unknown) {
  toast.error(error instanceof Error ? error.message : "Failed to launch");
}

function relativeTime(ms: number) {
  const diff = Date.now() - ms;
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (diff < minute) return "now";
  if (diff < hour) return `${Math.round(diff / minute)}m`;
  if (diff < day) return `${Math.round(diff / hour)}h`;
  return `${Math.round(diff / day)}d`;
}

function SectionTitle({
  title,
  count,
}: {
  title: string;
  count?: number;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <h2 className="text-sm font-semibold uppercase tracking-[0.24em] text-muted-foreground">
        {title}
      </h2>
      {count === undefined ? null : (
        <span className="text-xs text-muted-foreground">{count}</span>
      )}
    </div>
  );
}

function pillClassName(kind: "draft" | "step" | "ghost") {
  return cn(
    "inline-flex items-center rounded-md border px-2 py-1 text-[11px] font-semibold uppercase tracking-[0.18em]",
    kind === "draft" && "border-border bg-muted text-muted-foreground",
    kind === "step" && "border-border bg-card text-foreground",
    kind === "ghost" && "border-dashed border-border text-muted-foreground",
  );
}

function TaskStepPill({ task }: { task: TaskRow }) {
  const label = task.stepLabel;
  return <span className={pillClassName(task.isDraft ? "draft" : "step")}>{label}</span>;
}

function statusMeta(status: string) {
  switch (status) {
    case "ready_for_input":
      return { text: "idle", icon: "AlertCircle" as const, className: "text-destructive" };
    case "needs_approval":
      return { text: "needs approval", icon: "AlertTriangle" as const, className: "text-warning" };
    case "running":
      return { text: "running", icon: "Loading" as const, className: "text-success animate-pulse" };
    case "launching":
    case "resuming":
      return { text: status.replaceAll("_", " "), icon: "Spinner" as const, className: "text-success animate-pulse" };
    case "failed":
      return { text: "failed", icon: "AlertCircle" as const, className: "text-destructive" };
    case "interrupted":
    case "interrupt_requested":
      return { text: status.replaceAll("_", " "), icon: "CircleX" as const, className: "text-muted-foreground" };
    case "lost":
      return { text: "lost", icon: "AlertCircle" as const, className: "text-muted-foreground" };
    default:
      return { text: status.replaceAll("_", " "), icon: "Circle" as const, className: "text-muted-foreground" };
  }
}

function SessionStatus({ status }: { status: string }) {
  const meta = statusMeta(status);
  return (
    <span className={cn("inline-flex items-center gap-2 text-sm font-medium", meta.className)}>
      <Icon name={meta.icon} className="size-4" />
      {meta.text}
    </span>
  );
}

// Warning threshold per plan §2.8 (≥70% of the model's context window).
const CONTEXT_WARNING_THRESHOLD = 0.7;

function contextGaugeText(usage: SessionView["contextUsage"]) {
  if (!usage) return null;
  const percent = Math.round(usage.percent * 100);
  return {
    percent,
    warn: usage.percent >= CONTEXT_WARNING_THRESHOLD,
    title: `${usage.usedTokens.toLocaleString()} / ${usage.modelContextWindow.toLocaleString()} tokens${usage.estimated ? " (estimated)" : ""}`,
  };
}

function ContextGauge({ usage }: { usage: SessionView["contextUsage"] }) {
  const meta = contextGaugeText(usage);
  if (!meta) return null;
  return (
    <span
      title={meta.title}
      className={cn("inline-flex items-center gap-1 text-xs", meta.warn ? "text-warning" : "text-muted-foreground")}
    >
      <Icon name="ChartColumn" className="size-3.5" />
      {meta.percent}%
    </span>
  );
}

type NotifySignal =
  | {
      id: string;
      kind: "ready_for_input" | "needs_approval" | "comment" | "ready_after_failed_advance";
      threadId: string;
      sound: boolean;
      toast: { title: string; body: string; threadId: string } | null;
      volume?: number;
      synthetic?: boolean;
    }
  | { kind: "dismiss"; notificationId: string; dedupeKey: string };

const DEFAULT_NOTIFICATION_PREFS: Prefs["notifications"] = {
  enabled: true,
  sound: { ready_for_input: true, needs_approval: true, comment: true },
  toast: { ready_for_input: true, needs_approval: true, comment: true },
  volume: 0.2,
  jumpHotkey: "mod+shift+u",
};

// Bounded (roughly LRU by insertion order: oldest id is evicted first once the cap is hit) so a
// long session does not grow this set forever.
const SEEN_NOTIFICATION_LIMIT = 500;
const seenNotificationIds = new Set<string>();
function markNotificationSeen(id: string) {
  if (seenNotificationIds.has(id)) return true;
  seenNotificationIds.add(id);
  if (seenNotificationIds.size > SEEN_NOTIFICATION_LIMIT) {
    const oldest = seenNotificationIds.values().next().value;
    if (oldest !== undefined) seenNotificationIds.delete(oldest);
  }
  return false;
}

// All active toast ids, per thread, so the jump queue and view-dismissal logic cover every
// outstanding toast instead of only the most recently seen one per thread.
type PendingToastEntry = { id: string; threadId: string };
const pendingToastQueue: PendingToastEntry[] = [];
function dequeuePendingToast(id: string) {
  const index = pendingToastQueue.findIndex((entry) => entry.id === id);
  if (index >= 0) pendingToastQueue.splice(index, 1);
}

let notificationAudio: HTMLAudioElement | null = null;
let audioUnlocked = false;
let warnedAudioBlocked = false;
let lastChimeAt = 0;
let hotkeyCycleIndex = 0;

let audioUnlockBlocked = false;
const audioUnlockSubscribers = new Set<() => void>();
function setAudioUnlockBlocked(blocked: boolean) {
  if (audioUnlockBlocked === blocked) return;
  audioUnlockBlocked = blocked;
  for (const listener of audioUnlockSubscribers) listener();
}
function useAudioUnlockBlocked() {
  const [blocked, setBlocked] = useState(audioUnlockBlocked);
  useEffect(() => {
    const listener = () => setBlocked(audioUnlockBlocked);
    audioUnlockSubscribers.add(listener);
    return () => {
      audioUnlockSubscribers.delete(listener);
    };
  }, []);
  return blocked;
}

// Mount-order queue for the jump hotkey: only the earliest-mounted bridge instance still alive
// owns the listener. Ownership is re-read live from this queue inside the keydown handler (not
// captured once at registration time), so handoff on unmount needs no extra plumbing.
const hotkeyOwnerOrder: object[] = [];

function normalizeClientNotificationPrefs(input: Prefs["notifications"] | null | undefined): Prefs["notifications"] {
  return {
    enabled: input?.enabled ?? DEFAULT_NOTIFICATION_PREFS.enabled,
    sound: { ...DEFAULT_NOTIFICATION_PREFS.sound, ...(input?.sound ?? {}) },
    toast: { ...DEFAULT_NOTIFICATION_PREFS.toast, ...(input?.toast ?? {}) },
    volume: Math.min(1, Math.max(0, Number(input?.volume ?? DEFAULT_NOTIFICATION_PREFS.volume))),
    jumpHotkey: input?.jumpHotkey || DEFAULT_NOTIFICATION_PREFS.jumpHotkey,
  };
}

function displayHotkey(input: string) {
  return input
    .split("+")
    .map((part) => part === "mod" ? "⌘" : part === "shift" ? "⇧" : part.toUpperCase())
    .join("");
}

function ensureAudio() {
  if (!notificationAudio) notificationAudio = new Audio("/api/v1/plugins/rpi/http/sound/notification.mp3");
  return notificationAudio;
}

async function playNotificationSound(volume: number, force = false) {
  if (!force && !audioUnlocked) {
    if (!warnedAudioBlocked) {
      warnedAudioBlocked = true;
      toast("Notification sound is blocked until a click or Test sound.");
    }
    return;
  }
  const now = Date.now();
  if (!force && now - lastChimeAt < 500) return;
  lastChimeAt = now;
  const audio = ensureAudio();
  audio.volume = Math.min(1, Math.max(0, volume));
  audio.currentTime = 0;
  try {
    await audio.play();
    audioUnlocked = true;
    // A successful Test sound (force=true) proves playback works, so clear the settings hint
    // even if the earlier gesture-based unlock probe had failed.
    if (force) setAudioUnlockBlocked(false);
  } catch {
    if (!warnedAudioBlocked) {
      warnedAudioBlocked = true;
      toast("Notification sound is blocked. Use Test sound in settings.");
    }
  }
}

function shouldHandleHotkey(event: KeyboardEvent, hotkey: string) {
  const target = event.target as HTMLElement | null;
  const tagName = target?.tagName;
  if (target?.isContentEditable || tagName === "INPUT" || tagName === "TEXTAREA" || tagName === "SELECT") return false;
  const parts = new Set(hotkey.toLowerCase().split("+").map((part) => part.trim()).filter(Boolean));
  const isMac = /mac|iphone|ipad/i.test(navigator.platform);
  // "mod" maps to the platform-native primary modifier (meta on macOS, ctrl elsewhere) without
  // overriding an explicitly configured ctrl or meta in the same combo, so "mod+ctrl+u" requires
  // both on macOS instead of "mod" suppressing the explicit ctrl.
  const wantsMeta = parts.has("meta") || (parts.has("mod") && isMac);
  const wantsCtrl = parts.has("ctrl") || (parts.has("mod") && !isMac);
  const wantsShift = parts.has("shift");
  const wantsAlt = parts.has("alt");
  if (event.metaKey !== wantsMeta) return false;
  if (event.ctrlKey !== wantsCtrl) return false;
  if (event.shiftKey !== wantsShift) return false;
  if (event.altKey !== wantsAlt) return false;
  const key = [...parts].find((part) => !["mod", "shift", "alt", "ctrl", "meta"].includes(part));
  return key ? event.key.toLowerCase() === key : false;
}

// Shared by every panel-local hotkey owner (T, g-then-t, ⌘E): the configured jump hotkey (default
// ⌘⇧U) always wins a collision, so a user who rebinds it to e.g. "t" never fights this panel's own
// bindings. Panels that only need the collision check (not the jump hotkey's own global behavior)
// use this instead of duplicating RpiNotificationBridge's full owner-queue machinery.
function useConfiguredJumpHotkey() {
  const rpc = useRpc<RpcContract>();
  const [jumpHotkey, setJumpHotkey] = useState(DEFAULT_NOTIFICATION_PREFS.jumpHotkey);
  const refresh = () => {
    rpc.call("getPrefs", {}).then((next) => setJumpHotkey(normalizeClientNotificationPrefs(next.notifications).jumpHotkey));
  };
  useEffect(refresh, []);
  useRealtime("prefs", refresh);
  return jumpHotkey;
}

// Single keydown owner for one panel-local hotkey set. Scoped to `rootRef`'s own DOM subtree (not
// `document`), so a key press is only ever seen, and only ever `preventDefault`-ed, while focus is
// inside this panel; it never fires (and never fights other bb surfaces) while some other part of
// the app has focus. `handler` still runs `shouldHandleHotkey` itself so it can check multiple
// bindings (e.g. the g-then-t chord) with its own state.
function usePanelHotkeys(rootRef: RefObject<HTMLElement | null>, handler: (event: KeyboardEvent) => void, deps: unknown[]) {
  useEffect(() => {
    const node = rootRef.current;
    if (!node) return;
    node.addEventListener("keydown", handler);
    return () => node.removeEventListener("keydown", handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}

export function RpiNotificationBridge() {
  const rpc = useRpc<RpcContract>();
  const navigate = useBbNavigate();
  const { threadId } = useBbContext();
  const [prefs, setPrefs] = useState<Prefs["notifications"]>(DEFAULT_NOTIFICATION_PREFS);
  const hotkeyTokenRef = useRef<object | null>(null);
  if (!hotkeyTokenRef.current) hotkeyTokenRef.current = {};

  const refetchPrefs = () => {
    rpc.call("getPrefs", {}).then((next) => setPrefs(normalizeClientNotificationPrefs(next.notifications)));
  };

  useEffect(() => {
    refetchPrefs();
  }, []);
  useRealtime("prefs", refetchPrefs);
  useRealtime("rpi:sessions", () => undefined);
  useRealtime("rpi:comments", () => undefined);

  // First-mounted bridge wins the jump hotkey; later instances (e.g. a brief remount overlap)
  // never register. Handoff on unmount is automatic since ownership is read live from this queue.
  useEffect(() => {
    const token = hotkeyTokenRef.current!;
    hotkeyOwnerOrder.push(token);
    return () => {
      const index = hotkeyOwnerOrder.indexOf(token);
      if (index >= 0) hotkeyOwnerOrder.splice(index, 1);
    };
  }, []);

  useEffect(() => {
    const unlock = () => {
      if (audioUnlocked) return;
      // Actually probe playback (muted) inside the gesture handler instead of assuming success;
      // only the resolved play() promise unlocks sound, a rejection keeps it locked and surfaces
      // a hint in settings (see RpiNotificationSettings / useAudioUnlockBlocked).
      const audio = ensureAudio();
      const priorVolume = audio.volume;
      audio.volume = 0;
      audio.currentTime = 0;
      audio.play().then(() => {
        audio.pause();
        audio.currentTime = 0;
        audio.volume = priorVolume;
        audioUnlocked = true;
        setAudioUnlockBlocked(false);
      }).catch(() => {
        setAudioUnlockBlocked(true);
      });
    };
    document.addEventListener("pointerdown", unlock, { once: true });
    document.addEventListener("keydown", unlock, { once: true });
    return () => {
      document.removeEventListener("pointerdown", unlock);
      document.removeEventListener("keydown", unlock);
    };
  }, []);

  useEffect(() => {
    if (!threadId) return;
    for (const entry of pendingToastQueue.filter((item) => item.threadId === threadId)) {
      toast.dismiss(entry.id);
      dequeuePendingToast(entry.id);
    }
  }, [threadId]);

  useEffect(() => {
    const token = hotkeyTokenRef.current!;
    const onKeyDown = (event: KeyboardEvent) => {
      if (hotkeyOwnerOrder[0] !== token) return;
      if (!shouldHandleHotkey(event, prefs.jumpHotkey)) return;
      event.preventDefault();
      // Sonner does not reliably fire a toast's onDismiss for a programmatic toast.dismiss() call,
      // so dequeuing must happen right here (not left to onDismiss) or the entry lingers in the
      // queue forever. The peeked thread is also validated against the current sessions snapshot
      // before navigating: a queued toast's thread may have left ready_for_input/needs_approval
      // (advanced, resolved, archived) since the toast was queued, and jumping there would land on
      // a stale target.
      rpc.call("listSessions", { taskId: null }).then(({ sessions }) => {
        const readyThreadIds = new Set(
          sessions
            .filter((session) => session.rpiStatus === "ready_for_input" || session.rpiStatus === "needs_approval")
            .map((session) => session.threadId),
        );
        while (pendingToastQueue.length > 0) {
          const pending = pendingToastQueue[0];
          dequeuePendingToast(pending.id);
          toast.dismiss(pending.id);
          if (readyThreadIds.has(pending.threadId)) {
            navigate.toThread(pending.threadId);
            return;
          }
        }
        const targets = sessions
          .filter((session) => readyThreadIds.has(session.threadId))
          .sort((a, b) => a.rpiStatusAt - b.rpiStatusAt);
        if (targets.length === 0) return;
        hotkeyCycleIndex %= targets.length;
        const target = targets[hotkeyCycleIndex];
        hotkeyCycleIndex = (hotkeyCycleIndex + 1) % targets.length;
        navigate.toThread(target.threadId);
      });
    };
    document.addEventListener("keydown", onKeyDown, { capture: true });
    return () => document.removeEventListener("keydown", onKeyDown, { capture: true });
  }, [navigate, prefs.jumpHotkey, rpc]);

  useRealtime("rpi:notify", (payload) => {
    const signal = payload as NotifySignal;
    // A later action (e.g. adopting an orphaned thread) superseded an earlier recovery toast;
    // dismiss it instead of leaving stale "Retry it from Launch Attempts" instructions visible.
    if (signal?.kind === "dismiss") {
      // The toast was rendered with `id: dedupeKey`, not the notifications-table row id, so the
      // dismiss must target dedupeKey to actually match a live toast (falling back to
      // notificationId only for older payloads that predate this field).
      const toastId = signal.dedupeKey ?? signal.notificationId;
      toast.dismiss(toastId);
      dequeuePendingToast(toastId);
      return;
    }
    if (!signal?.id || markNotificationSeen(signal.id)) return;
    if (signal.sound) void playNotificationSound(signal.volume ?? prefs.volume);
    if (!signal.toast) return;
    const id = signal.id;
    pendingToastQueue.push({ id, threadId: signal.toast.threadId });
    toast(signal.synthetic ? `Test: ${signal.toast.title}` : signal.toast.title, {
      id,
      description: signal.toast.body,
      duration: 8000,
      onDismiss: () => dequeuePendingToast(id),
      onAutoClose: () => dequeuePendingToast(id),
      action: {
        label: `Jump to Session ${displayHotkey(prefs.jumpHotkey)}`,
        onClick: () => {
          dequeuePendingToast(id);
          navigate.toThread(signal.toast!.threadId);
        },
      },
    });
  });

  return null;
}

function nextStep(session: Pick<SessionView, "nextStepJson">) {
  if (!session.nextStepJson) return null;
  try {
    const parsed = JSON.parse(session.nextStepJson) as NextStepSuggestionsRecord;
    return parsed.extraction.type === "next_step_found" ? parsed.extraction : null;
  } catch {
    return null;
  }
}

// Decision logic (precondition gating, extraction parsing, comparison against the workflow's
// canonical next skill) lives in transitions.ts (suggestedNextForSession), covered by
// tests/transitions.test.ts; this is just the UI's call site.
function suggestedNextFor(session: Pick<SessionView, "rpiStatus" | "blockedReason" | "completedTurnKey" | "lastSummarizedTurnKey" | "label" | "workflowType" | "nextStepJson">): SuggestedNext | null {
  return suggestedNextForSession(session);
}

function TaskTable({ tasks }: { tasks: TaskRow[] }) {
  const navigate = useBbNavigate();
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card">
      <table className="min-w-full border-collapse text-sm">
        <thead className="border-b border-border text-left text-[11px] uppercase tracking-[0.24em] text-muted-foreground">
          <tr>
            <th className="px-4 py-3 font-medium">Name</th>
            <th className="px-4 py-3 font-medium">Step</th>
            <th className="px-4 py-3 font-medium">Sessions</th>
            <th className="px-4 py-3 font-medium">Created</th>
            <th className="px-4 py-3 font-medium">Updated</th>
          </tr>
        </thead>
        <tbody>
          {tasks.map((task) => (
            <tr
              key={task.id}
              className="cursor-pointer border-b border-border last:border-b-0 hover:bg-card/70"
              onClick={() => navigate.toPluginPanel("rpi", { subPath: `tasks/${task.id}` })}
            >
              <td className="px-4 py-3">
                <div className="flex flex-col gap-1">
                  <span className="font-medium text-foreground">{task.name}</span>
                  <span className="inline-flex items-center gap-2 text-xs text-muted-foreground">
                    {task.attentionCount > 0 ? <span className="size-2 rounded-full bg-destructive" aria-label={`${task.attentionCount} sessions need attention`} /> : null}
                    {task.slug}
                  </span>
                </div>
              </td>
              <td className="px-4 py-3">
                <TaskStepPill task={task} />
              </td>
              <td className="px-4 py-3 text-muted-foreground">{task.sessionCount}</td>
              <td className="px-4 py-3 text-muted-foreground">{relativeTime(task.createdAt)}</td>
              <td className="px-4 py-3 text-muted-foreground">{relativeTime(task.updatedAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function TaskBoard({ tasks }: { tasks: TaskRow[] }) {
  const navigate = useBbNavigate();
  const groups = useMemo(() => {
    const base = {
      todo_draft: [] as TaskRow[],
      research_design: [] as TaskRow[],
      planning: [] as TaskRow[],
      implementation: [] as TaskRow[],
    };
    for (const task of tasks) {
      base[task.boardColumn].push(task);
    }
    return base;
  }, [tasks]);

  const columns = [
    { id: "todo_draft", title: "Todo / Draft" },
    { id: "research_design", title: "Research & Design" },
    { id: "planning", title: "Planning" },
    { id: "implementation", title: "Implementation" },
  ] as const;

  return (
    <div className="grid gap-3 xl:grid-cols-4">
      {columns.map((column) => (
        <section key={column.id} className="min-h-[240px] rounded-xl border border-border bg-card/60 p-3">
          <div className="mb-3 flex items-center justify-between gap-2">
            <h3 className="text-xs font-semibold uppercase tracking-[0.24em] text-foreground">
              {column.title}
            </h3>
            <span className="text-xs text-muted-foreground">{groups[column.id].length}</span>
          </div>
          <div className="space-y-2">
            {groups[column.id].map((task) => (
              <article
                key={task.id}
                onClick={() => navigate.toPluginPanel("rpi", { subPath: `tasks/${task.id}` })}
                className="cursor-pointer rounded-lg border border-border bg-background/70 p-3 transition hover:border-foreground/40"
              >
                <div className="space-y-2">
                  <div className="flex items-start justify-between gap-3">
                    <h4 className="font-medium leading-tight text-foreground">{task.name}</h4>
                    <span className="inline-flex items-center gap-2 text-xs text-muted-foreground">
                      {task.attentionCount > 0 ? <span className="size-2 rounded-full bg-destructive" aria-label={`${task.attentionCount} sessions need attention`} /> : null}
                      {relativeTime(task.updatedAt)}
                    </span>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <TaskStepPill task={task} />
                    <span className="text-xs text-muted-foreground">{task.sessionCount} sessions</span>
                  </div>
                </div>
              </article>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function TaskListView({
  tasks,
  boardMode,
}: {
  tasks: TaskRow[];
  boardMode: boolean;
}) {
  return boardMode ? <TaskBoard tasks={tasks} /> : <TaskTable tasks={tasks} />;
}

function ComposerToolbarSelect({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (next: string) => void;
  options: Array<{ value: string; label: string; description?: string }>;
}) {
  return (
    <select
      value={value}
      onChange={(event) => onChange(event.target.value)}
      className="h-10 min-w-0 rounded-md border border-border bg-card px-3 text-sm text-foreground outline-none transition focus:border-foreground"
    >
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
}

function WorkflowStrip({
  workflowType,
  worktreeTiming,
  currentLabel,
}: {
  workflowType: "rpi" | "outline_only" | "prd_tdd" | "oneshot" | "freeform";
  worktreeTiming: "now" | "later" | "never";
  currentLabel?: string | null;
}) {
  const baseSteps =
    workflowType === "rpi"
      ? ["questions", "research", "design", "plan", "implementation", "PR"]
      : workflowType === "outline_only"
        ? ["questions", "research", "structure", "implementation", "PR"]
      : workflowType === "prd_tdd"
        ? ["research", "PRD", "TDD", "plan", "implementation", "PR"]
        : ["single session"];
  const steps = worktreeTiming === "never" || baseSteps[0] === "single session"
    ? baseSteps
    : worktreeTiming === "now"
      ? ["worktree", ...baseSteps]
      : [...baseSteps.slice(0, Math.max(0, baseSteps.indexOf("implementation"))), "worktree", ...baseSteps.slice(Math.max(0, baseSteps.indexOf("implementation")))];
  const currentStep = labelStep(currentLabel);
  const currentIndex = steps.findIndex((step) => step === currentStep);
  return (
    <div className="rounded-xl border border-border bg-card/70 p-3">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h3 className="text-xs font-semibold uppercase tracking-[0.24em] text-muted-foreground">
          RPI workflow
        </h3>
        <span className="text-xs text-muted-foreground">{WORKFLOW_GRAPH_LABELS[workflowType]}</span>
      </div>
      <div className="flex flex-wrap gap-2">
        {steps.map((step, index) => {
          const dashed = step === "worktree" && worktreeTiming === "later";
          return (
            <span
              key={`${step}-${index}`}
              className={cn(
                "inline-flex min-w-[92px] items-center justify-center rounded-md border px-3 py-2 text-sm font-medium",
                currentIndex === index
                  ? "border-foreground bg-card text-foreground"
                  : currentIndex > index
                    ? "border-border bg-muted text-foreground"
                    : dashed ? "border-dashed border-border text-muted-foreground" : "border-border text-foreground",
              )}
            >
              {step}
            </span>
          );
        })}
      </div>
    </div>
  );
}

function labelStep(label: string | null | undefined) {
  const normalized = label?.startsWith("rpi:") ? label.slice(4) : label;
  if (normalized === "research-questions") return "questions";
  if (normalized === "worktree-setup") return "worktree";
  if (normalized === "structure") return "structure";
  if (normalized === "implementation") return "implementation";
  if (normalized === "describe-pr") return "PR";
  if (normalized === "design-prd") return "PRD";
  if (normalized === "design-tdd") return "TDD";
  return normalized ?? null;
}

const PHASE_TIPS: Record<string, string[]> = {
  "research-questions": [
    "Use only task.md, ticket.md, and explicit mentions.",
    "Phrase discovery neutrally so the research does not reveal the planned implementation.",
    "End with the create-research command block.",
  ],
  research: [
    "Keep the artifact descriptive: facts, locations, constraints, and gaps.",
    "Spawn research child threads for separable codebase or web questions.",
    "Do not turn findings into recommendations in this phase.",
  ],
  design: [
    "Convert research into design tradeoffs and open decisions.",
    "Leave unresolved questions visible for the human gate.",
    "Proceed manually when the design is ready for outline work.",
  ],
  "design-prd": [
    "Describe user-facing requirements, scope, and acceptance criteria.",
    "Avoid implementation detail except where it constrains product behavior.",
    "Proceed manually to technical design.",
  ],
  "design-tdd": [
    "Bridge requirements to implementation shape, data, APIs, and risks.",
    "Keep verification and rollout expectations concrete.",
    "Proceed manually to the structure outline.",
  ],
  structure: [
    "Break implementation into ordered phases with files and checks.",
    "Keep each phase independently reviewable.",
    "Proceed manually to implementation for outline-only tasks.",
  ],
  plan: [
    "Expand the outline into executable implementation steps.",
    "Name the checks and manual gate after each phase.",
    "Proceed manually to workspace setup.",
  ],
  "worktree-setup": [
    "Use .rpi/workspace.json for the requested shape.",
    "Let bb own managed worktree creation.",
    "Run copyGlobs and setupCommand only inside the selected worktree thread.",
  ],
  implementation: [
    "Keep the parent thread as an orchestrator.",
    "Use child implementer and reviewer threads before the commit gate.",
    "Commit only after the human approves commit and proceed.",
  ],
  "describe-pr": [
    "Use bb environment commands for status, diff, and pull-request state.",
    "Write pr-description.md as the task artifact.",
    "Do not merge automatically.",
  ],
  review: [
    "Read the chosen artifact and comments.",
    "Ask before resolving, deleting, replying, or applying comments unless the user already gave that instruction.",
    "Handle one root comment at a time.",
  ],
};

function NewTaskPage({
  tasks,
}: {
  tasks: TaskRow[];
}) {
  const rpc = useRpc<RpcContract>();
  const navigate = useBbNavigate();
  const { projectId: currentProjectId } = useBbContext();
  const { values: settings, isLoading: settingsLoading } = useSettings();
  const [text, setText] = useState("");
  const [name, setName] = useState("");
  const [projectOptions, setProjectOptions] = useState<Array<{ id: string; name: string }>>([]);
  const [hostOptions, setHostOptions] = useState<Array<{ id: string; name: string; status: string }>>([]);
  const [projectId, setProjectId] = useState(currentProjectId ?? "");
  const [hostId, setHostId] = useState("");
  const [defaultDirectory, setDefaultDirectory] = useState("");
  const [permissionMode, setPermissionMode] = useState<"default" | "accept_edits" | "auto" | "bypass">("default");
  const [workflowType, setWorkflowType] = useState<"rpi" | "outline_only" | "prd_tdd" | "oneshot" | "freeform">("rpi");
  const [worktreeTiming, setWorktreeTiming] = useState<"now" | "later" | "never">("later");
  const [autoAdvance, setAutoAdvance] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      rpc.call("listProjects", { includePersonal: true }),
      rpc.call("listHosts", {}),
    ]).then(([projects, hosts]) => {
      if (cancelled) return;
      setProjectOptions(projects as Array<{ id: string; name: string }>);
      setHostOptions(hosts as Array<{ id: string; name: string; status: string }>);
      if (!projectId) {
        setProjectId((projects[0] as { id: string } | undefined)?.id ?? "");
      }
      if (!hostId) {
        setHostId((hosts[0] as { id: string } | undefined)?.id ?? "");
      }
    });
    return () => {
      cancelled = true;
    };
  }, [hostId, projectId, rpc]);

  useEffect(() => {
    if (settingsLoading) return;
    const permissionModeSetting = settings?.defaultPermissionMode;
    if (
      permissionModeSetting === "default" ||
      permissionModeSetting === "accept_edits" ||
      permissionModeSetting === "auto" ||
      permissionModeSetting === "bypass"
    ) {
      setPermissionMode(permissionModeSetting);
    } else {
      setPermissionMode("default");
    }
    const workflowTypeSetting = settings?.defaultWorkflowType;
    if (
      workflowTypeSetting === "rpi" ||
      workflowTypeSetting === "outline_only" ||
      workflowTypeSetting === "prd_tdd" ||
      workflowTypeSetting === "oneshot" ||
      workflowTypeSetting === "freeform"
    ) {
      setWorkflowType(workflowTypeSetting);
    } else {
      setWorkflowType("rpi");
    }
    const worktreeTimingSetting = settings?.defaultWorktreeTiming;
    if (worktreeTimingSetting === "now" || worktreeTimingSetting === "later" || worktreeTimingSetting === "never") {
      setWorktreeTiming(worktreeTimingSetting);
    } else {
      setWorktreeTiming("later");
    }
    setAutoAdvance(Boolean(settings?.autoAdvanceDefault ?? false));
  }, [settings, settingsLoading]);

  const draftTasks = useMemo(() => tasks.filter((task) => task.isDraft), [tasks]);
  const createDraft = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy || projectId === "" || text.trim() === "") return;
    setBusy(true);
    try {
      await rpc.call("createTask", {
        request: {
          text,
          projectId,
          hostId: hostId || null,
          defaultDirectory: defaultDirectory.trim() || null,
          workflowType,
          worktreeTiming,
          permissionMode,
          autoAdvance,
        },
        name: name.trim() || undefined,
        draft: true,
      });
      setText("");
      setName("");
    } finally {
      setBusy(false);
    }
  };
  const createAndLaunch = async () => {
    if (busy || projectId === "" || text.trim() === "") return;
    setBusy(true);
    try {
      const created = await rpc.call("createTask", {
        request: {
          text,
          projectId,
          hostId: hostId || null,
          defaultDirectory: defaultDirectory.trim() || null,
          workflowType,
          worktreeTiming,
          permissionMode,
          autoAdvance,
        },
        name: name.trim() || undefined,
        draft: true,
      });
      const launched = await rpc.call("launchDraft", { taskId: created.taskId });
      navigate.toThread(launched.threadId);
    } catch (error) {
      reportLaunchError(error);
    } finally {
      setBusy(false);
    }
  };

  const projectLabel = (projectId && projectOptions.find((project) => project.id === projectId)?.name) ||
    (projectId || "Select project");
  const hostLabel = (hostId && hostOptions.find((host) => host.id === hostId)?.name) ||
    (hostId || "Select host");

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h1 className="text-3xl font-semibold tracking-tight text-foreground">
          What should we build today?
        </h1>
        <p className="max-w-3xl text-sm text-muted-foreground">
          Save a task or launch the first session.
        </p>
      </div>

      <form onSubmit={createDraft} className="space-y-4">
        <div className="rounded-2xl border border-border bg-card/70 p-4 shadow-sm">
          <textarea
            value={text}
            onChange={(event) => setText(event.target.value)}
            placeholder="Describe the task..."
            className="min-h-[260px] w-full resize-y rounded-xl border border-border bg-background/80 p-4 text-base leading-7 text-foreground outline-none placeholder:text-muted-foreground focus:border-foreground"
          />
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <Input
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Task name"
              className="h-10 max-w-[240px]"
            />
            <ComposerToolbarSelect
              value={permissionMode}
              onChange={(value) => setPermissionMode(value as "default" | "accept_edits" | "auto" | "bypass")}
              options={[
                { value: "default", label: "Default" },
                { value: "accept_edits", label: "Accept edits" },
                { value: "auto", label: "Auto" },
                { value: "bypass", label: "Bypass" },
              ]}
            />
            <button
              type="button"
              onClick={() => setAutoAdvance((value) => !value)}
              className={cn(
                "inline-flex h-10 items-center gap-2 rounded-md border px-3 text-sm font-medium transition",
                autoAdvance ? "border-border bg-muted text-foreground" : "border-border bg-card text-muted-foreground",
              )}
            >
              <Icon name="ArrowTurnForward" className="size-4" />
              Auto-advance
            </button>
            <ComposerToolbarSelect
              value={hostId}
              onChange={setHostId}
              options={hostOptions.map((host) => ({
                value: host.id,
                label: host.name,
              }))}
            />
            <ComposerToolbarSelect
              value={projectId}
              onChange={setProjectId}
              options={projectOptions.map((project) => ({
                value: project.id,
                label: project.name,
              }))}
            />
            <ComposerToolbarSelect
              value={worktreeTiming}
              onChange={(value) => setWorktreeTiming(value as "now" | "later" | "never")}
              options={[
                { value: "now", label: "Worktree now" },
                { value: "later", label: "Worktree later" },
                { value: "never", label: "No worktree" },
              ]}
            />
            <ComposerToolbarSelect
              value={workflowType}
              onChange={(value) => setWorkflowType(value as "rpi" | "outline_only" | "prd_tdd" | "oneshot" | "freeform")}
              options={[
                { value: "rpi", label: "RPI" },
                { value: "outline_only", label: "Outline" },
                { value: "prd_tdd", label: "PRD / TDD" },
                { value: "oneshot", label: "Oneshot" },
                { value: "freeform", label: "Freeform" },
              ]}
            />
            <Input
              value={defaultDirectory}
              onChange={(event) => setDefaultDirectory(event.target.value)}
              placeholder="Working directory"
              className="h-10 flex-1 min-w-[220px]"
            />
            <div className="ml-auto flex items-center gap-2">
              <button
                type="submit"
                disabled={busy || text.trim() === "" || projectId === ""}
                className="inline-flex h-10 items-center gap-2 rounded-md bg-foreground px-4 text-sm font-semibold text-background transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <Icon name="EditFile" className="size-4" />
                Save draft
              </button>
              <button
                type="button"
                onClick={createAndLaunch}
                disabled={busy || text.trim() === "" || projectId === ""}
                title="Create and launch"
                className="inline-flex h-10 items-center gap-2 rounded-md border border-border bg-card px-4 text-sm font-semibold text-foreground transition hover:border-foreground/40 disabled:cursor-not-allowed disabled:text-muted-foreground disabled:opacity-60"
              >
                <Icon name="Play" className="size-4" />
                Create
              </button>
            </div>
          </div>
        </div>
        <WorkflowStrip workflowType={workflowType} worktreeTiming={worktreeTiming} />
      </form>

      <div className="space-y-3">
        <SectionTitle title="Recent drafts" count={draftTasks.length} />
        {draftTasks.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border bg-card/60 px-4 py-6 text-sm text-muted-foreground">
            Drafts will appear here after you save them.
          </div>
        ) : (
          <div className="space-y-2">
            {draftTasks.slice(0, 5).map((task) => (
              <button
                key={task.id}
                type="button"
                onClick={() => navigate.toPluginPanel("rpi", { subPath: "tasks" })}
                className="flex w-full items-center justify-between rounded-lg border border-border bg-card/70 px-4 py-3 text-left transition hover:border-foreground/40"
              >
                <div className="space-y-1">
                  <div className="font-medium text-foreground">{task.name}</div>
                  <div className="text-xs text-muted-foreground">{task.slug}</div>
                </div>
                <div className="flex items-center gap-3 text-xs text-muted-foreground">
                  <span>{projectLabel}</span>
                  <span>{hostLabel}</span>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function RecoverLaunchRow({ attempt, onResolved }: { attempt: LaunchAttemptRecord; onResolved: () => void }) {
  const rpc = useRpc<RpcContract>();
  const [threadId, setThreadId] = useState("");
  const [busy, setBusy] = useState(false);
  const isPending = attempt.status === "pending";
  const isFailed = attempt.status === "failed";

  const resolve = async (action: { type: "adopt"; threadId: string } | { type: "retry" } | { type: "dismiss" }) => {
    if (busy) return;
    setBusy(true);
    try {
      await rpc.call("resolveLaunchAttempt", { id: attempt.id, action });
      onResolved();
    } catch (error) {
      reportLaunchError(error);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-lg border border-border bg-card/70 p-3">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="space-y-1">
          <div className="text-sm font-medium text-foreground">{isPending ? "Launching..." : isFailed ? "Launch failed" : "Recover launch"}</div>
          <div className="text-xs text-muted-foreground">{attempt.id}</div>
        </div>
        <span className={pillClassName(isFailed ? "draft" : "ghost")}>{isPending ? "launching..." : attempt.status}</span>
      </div>
      {isPending ? null : isFailed ? (
        // Only Retry is actionable for a failed attempt; adopt/dismiss are server-rejected no-ops
        // once an attempt is terminal, and there is no live pending thread left to adopt or dismiss.
        <Button type="button" disabled={busy} onClick={() => resolve({ type: "retry" })}>
          Retry
        </Button>
      ) : (
        <div className="space-y-2">
          {attempt.adoptionCandidates?.length ? (
            <div className="space-y-1">
              {attempt.adoptionCandidates.map((candidate) => (
                <button
                  key={candidate.threadId}
                  type="button"
                  disabled={busy}
                  onClick={() => setThreadId(candidate.threadId)}
                  className="flex w-full items-center justify-between gap-2 rounded-md border border-border px-2 py-1.5 text-left text-xs text-foreground hover:bg-muted disabled:opacity-60"
                >
                  <span className="truncate">{candidate.title ?? candidate.threadId}</span>
                  <span className={pillClassName(candidate.strong ? "step" : "ghost")}>{candidate.strong ? "strong" : "weak"}</span>
                </button>
              ))}
            </div>
          ) : null}
          <div className="flex flex-wrap items-center gap-2">
            <Input value={threadId} onChange={(event) => setThreadId(event.target.value)} placeholder="Thread id to adopt" className="h-9 max-w-[220px]" />
            <Button type="button" disabled={busy || threadId.trim() === ""} onClick={() => resolve({ type: "adopt", threadId: threadId.trim() })}>
              Adopt
            </Button>
            <Button type="button" disabled={busy} onClick={() => resolve({ type: "retry" })}>
              Retry
            </Button>
            <Button type="button" disabled={busy} variant="outline" onClick={() => resolve({ type: "dismiss" })}>
              Dismiss
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function SessionsTable({ sessions }: { sessions: SessionView[] }) {
  const navigate = useBbNavigate();
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card">
      <table className="min-w-full border-collapse text-sm">
        <thead className="border-b border-border text-left text-[11px] uppercase tracking-[0.24em] text-muted-foreground">
          <tr>
            <th className="px-4 py-3 font-medium">Status</th>
            <th className="px-4 py-3 font-medium">Title</th>
            <th className="px-4 py-3 font-medium">Label</th>
            <th className="px-4 py-3 font-medium">Context</th>
            <th className="px-4 py-3 font-medium">Working directory</th>
            <th className="px-4 py-3 font-medium">Updated</th>
          </tr>
        </thead>
        <tbody>
          {sessions.map((session) => (
            <tr
              key={session.threadId}
              className="cursor-pointer border-b border-border last:border-b-0 hover:bg-background/70"
              onClick={() => navigate.toThread(session.threadId)}
            >
              <td className="px-4 py-3"><SessionStatus status={session.rpiStatus} /></td>
              <td className="px-4 py-3">
                <div className="flex flex-col gap-1">
                  <span className="font-medium text-foreground">{session.title ?? session.threadId}</span>
                  {session.blockedReason ? <span className="text-xs text-muted-foreground">blocked: {session.blockedReason}</span> : null}
                  {nextStep(session) ? <span className="text-xs text-muted-foreground">Next: {nextStep(session)?.nextStepSummary}</span> : null}
                </div>
              </td>
              <td className="px-4 py-3">{session.label ? <span className={pillClassName("step")}>{session.label}</span> : <span className={pillClassName("ghost")}>none</span>}</td>
              <td className="px-4 py-3"><ContextGauge usage={session.contextUsage} /></td>
              <td className="max-w-[320px] truncate px-4 py-3 text-muted-foreground">{session.workingDirectory ?? "unknown"}</td>
              <td className="px-4 py-3 text-muted-foreground">{relativeTime(session.threadUpdatedAt ?? session.updatedAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const AUTO_ADVANCE_FLAGS = [
  { label: "research-questions", field: "aa_questions_to_research", title: "Questions to research" },
  { label: "research", field: "aa_research_to_design", title: "Research to design" },
  { label: "plan", field: "aa_plan_to_worktree", title: "Plan to worktree" },
  { label: "worktree-setup", field: "aa_worktree_to_implementation", title: "Worktree to implementation" },
  { label: "implementation", field: "aa_implementation_to_pr", title: "Implementation to PR" },
] as const;

function AutoAdvancePanel({ task, onUpdated }: { task: TaskRecord; onUpdated: () => void }) {
  const rpc = useRpc<RpcContract>();
  const update = async (patch: Partial<TaskRecord>) => {
    await rpc.call("updateTask", { taskId: task.id, patch });
    onUpdated();
  };
  const humanGates = Object.entries(AUTO_ADVANCE).filter(([, value]) => value.flag === null);
  return (
    <div className="space-y-3">
      <label className="flex items-center justify-between rounded-md border border-border bg-card p-3 text-sm">
        <span className="font-medium text-foreground">Auto-advance</span>
        <input type="checkbox" checked={task.autoAdvance} onChange={(event) => void update({ autoAdvance: event.target.checked })} />
      </label>
      <div className="grid gap-2 lg:grid-cols-2">
        {AUTO_ADVANCE_FLAGS.map((flag) => (
          <label key={flag.field} className="flex items-center justify-between rounded-md border border-border bg-card p-3 text-sm">
            <span className="text-foreground">{flag.title}</span>
            <input type="checkbox" checked={Boolean(task[flag.field])} disabled={!task.autoAdvance} onChange={(event) => void update({ [flag.field]: event.target.checked })} />
          </label>
        ))}
      </div>
      <div className="grid gap-2 lg:grid-cols-2">
        {humanGates.map(([label, transition]) => (
          <div key={label} className="flex items-center justify-between rounded-md border border-dashed border-border bg-card p-3 text-sm text-muted-foreground">
            <span>{label} to {transition.to}</span>
            <span>human gate</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function TipsPanel({ taskId, label }: { taskId: string; label: string | null | undefined }) {
  const rpc = useRpc<RpcContract>();
  const { values: settings } = useSettings();
  const [state, setState] = useState<TaskUiState>({ dismissedTips: {} });
  const normalized = label?.startsWith("rpi:") ? label.slice(4) : label;
  const tipKey = normalized ?? "todo";
  const tips = PHASE_TIPS[tipKey] ?? [
    "Use explicit task materials as the source of truth.",
    "Keep each phase in its own session so context stays small.",
    "Use the final command block exactly as written by the skill template.",
  ];
  const hidden = state.dismissedTips?.[tipKey] || settings?.showPhaseTips === false;

  const refetch = () => {
    rpc.call("getTaskUiState", { taskId }).then(setState);
  };

  useEffect(() => {
    refetch();
  }, [taskId]);
  useRealtime("rpi:ui-state", refetch);

  if (hidden) {
    return (
      <div className="rounded-md border border-border bg-card p-4 text-sm text-muted-foreground">
        Phase tips are hidden for this task.
      </div>
    );
  }

  return (
    <section className="space-y-3 rounded-md border border-border bg-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-foreground">Tips</h3>
          <p className="text-xs text-muted-foreground">{tipKey.replaceAll("-", " ")}</p>
        </div>
        <Button
          type="button"
          variant="outline"
          className="h-8"
          onClick={async () => {
            const next = await rpc.call("dismissTaskTip", { taskId, label: tipKey });
            setState(next);
          }}
        >
          Don't show again
        </Button>
      </div>
      <ul className="space-y-2 text-sm text-foreground">
        {tips.map((tip) => <li key={tip}>{tip}</li>)}
      </ul>
    </section>
  );
}

function WorkspacePanel({ taskId }: { taskId: string }) {
  const rpc = useRpc<RpcContract>();
  const [workspace, setWorkspace] = useState<WorkspaceViewRecord | null>(null);
  const [busy, setBusy] = useState(false);
  const refetch = () => {
    rpc.call("getWorkspace", { taskId }).then((result) => setWorkspace(result.workspace));
  };
  useEffect(() => {
    refetch();
  }, [taskId]);
  useRealtime("rpi:sessions", refetch);
  if (!workspace) return <div className="rounded-md border border-dashed border-border p-4 text-sm text-muted-foreground">Loading workspace...</div>;
  return (
    <div className="space-y-3">
      <div className="grid gap-2 lg:grid-cols-4">
        <WorkspaceStat label="Status" value={workspace.environment.status ?? "pending"} />
        <WorkspaceStat label="Kind" value={workspace.environment.kind ?? "unresolved"} />
        <WorkspaceStat label="Branch" value={workspace.environment.branch ?? "unresolved"} />
        <WorkspaceStat label="Base" value={workspace.environment.baseBranch ?? workspace.sourceRef ?? "default"} />
      </div>
      {workspace.error ? (
        <div className="rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm font-medium text-destructive">
          {workspace.error}
        </div>
      ) : null}
      <div className="rounded-md border border-border bg-card p-3">
        <div className="mb-2 text-xs font-semibold uppercase tracking-[0.22em] text-muted-foreground">Requested vs resolved</div>
        <div className="grid gap-2 text-sm lg:grid-cols-2">
          <div><span className="text-muted-foreground">Path requested </span><span className="text-foreground">{workspace.pathTemplate.requested ?? "default"}</span></div>
          <div><span className="text-muted-foreground">Path resolved </span><span className="text-foreground">{workspace.pathTemplate.resolved ?? "pending"}</span></div>
          <div><span className="text-muted-foreground">Branch requested </span><span className="text-foreground">{workspace.branchTemplate.requested ?? workspace.sourceRef ?? "default"}</span></div>
          <div><span className="text-muted-foreground">Branch resolved </span><span className="text-foreground">{workspace.branchTemplate.resolved ?? "pending"}</span></div>
        </div>
      </div>
      <div className="overflow-hidden rounded-md border border-border bg-card">
        <table className="min-w-full border-collapse text-sm">
          <thead className="border-b border-border text-left text-xs uppercase tracking-[0.22em] text-muted-foreground">
            <tr><th className="px-3 py-2">Repo</th><th className="px-3 py-2">Primary</th><th className="px-3 py-2">Source</th><th className="px-3 py-2">Setup</th></tr>
          </thead>
          <tbody>
            {workspace.repos.map((repo, index) => (
              <tr key={`${repo.localPath ?? "repo"}-${index}`} className="border-b border-border last:border-b-0">
                <td className="px-3 py-2 text-foreground">{repo.localPath ?? "default repo"}</td>
                <td className="px-3 py-2 text-muted-foreground">{repo.primary ? "yes" : "no"}</td>
                <td className="px-3 py-2 text-muted-foreground">{repo.sourceRef ?? "default"}</td>
                <td className="px-3 py-2 text-muted-foreground">{repo.setupCommand ?? "none"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border bg-card p-3">
        <div className="text-sm text-muted-foreground">
          Setup outcome: {workspace.provisioningEventKinds.length ? workspace.provisioningEventKinds.join(", ") : "no provisioning events"}
        </div>
        <Button type="button" variant="outline" disabled={busy || !workspace.worktreeThreadId || Boolean(workspace.error)} onClick={async () => {
          setBusy(true);
          try {
            await rpc.call("rerunWorkspaceSetup", { taskId });
            refetch();
          } finally {
            setBusy(false);
          }
        }}>
          Re-run setup
        </Button>
      </div>
      {workspace.warnings.length ? (
        <div className="rounded-md border border-dashed border-border p-3 text-sm text-muted-foreground">{workspace.warnings.join(" ")}</div>
      ) : null}
    </div>
  );
}

function WorkspaceStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border bg-card p-3">
      <div className="text-xs uppercase tracking-[0.22em] text-muted-foreground">{label}</div>
      <div className="mt-1 truncate text-sm font-medium text-foreground">{value}</div>
    </div>
  );
}

const SCRATCH_PAD_SAVE_DEBOUNCE_MS = 600;
const SCRATCH_PAD_MAX_CHARS = 20000;

function ScratchPadPanel({ taskId }: { taskId: string }) {
  const rpc = useRpc<RpcContract>();
  const [text, setText] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const textRef = useRef(text);
  textRef.current = text;
  const syncRef = useRef(new ScratchPadSync());
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cancelPendingFlush = () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  };

  useEffect(() => {
    let cancelled = false;
    setLoaded(false);
    cancelPendingFlush();
    rpc.call("getTaskUiState", { taskId }).then((state) => {
      if (cancelled) return;
      setText(state.scratch ?? "");
      syncRef.current.reload(state.scratchRevision ?? 0);
      setLoaded(true);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [taskId, rpc]);

  // Only submits the text captured when the flush was scheduled, with the revision that was
  // current at that time; see scratch-pad-sync.ts for why a stale flush must not overwrite a
  // conflict reload that happened after it was queued.
  const save = (value: string, generation: number) => {
    const sync = syncRef.current;
    return rpc.call("saveScratchPad", { taskId, text: value, expectedRevision: sync.currentRevision() }).then((result) => {
      if (result.outcome === "conflict") {
        sync.applyConflict(result.scratchRevision ?? 0);
        setText(result.scratch ?? "");
        cancelPendingFlush();
        toast.info("Updated elsewhere, reloaded");
        return;
      }
      if (!sync.applyOk(generation, result.scratchRevision ?? sync.currentRevision() + 1)) return;
      setSavedAt(Date.now());
    }, (error: unknown) => {
      if (!sync.shouldFlush(generation)) return;
      toast.error(error instanceof Error ? error.message : "Failed to save scratch pad");
    });
  };

  // Flush a pending debounce on unmount (task switch, panel close) so the last keystroke is not
  // silently lost, unless a conflict reload since made it stale.
  useEffect(() => () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      const generation = syncRef.current.stampEdit();
      if (syncRef.current.shouldFlush(generation)) void save(textRef.current, generation);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [taskId]);

  const onChange = (value: string) => {
    const bounded = value.slice(0, SCRATCH_PAD_MAX_CHARS);
    setText(bounded);
    cancelPendingFlush();
    const generation = syncRef.current.stampEdit();
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      if (!syncRef.current.shouldFlush(generation)) return; // superseded by a conflict reload
      void save(bounded, generation);
    }, SCRATCH_PAD_SAVE_DEBOUNCE_MS);
  };

  if (!loaded) return <div className="p-4 text-sm text-muted-foreground">Loading...</div>;
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-foreground">Scratch pad</h3>
        <span className="text-xs text-muted-foreground">
          {savedAt ? `Saved ${relativeTime(savedAt)} ago` : "Local notes, not visible to sessions"} · {text.length}/{SCRATCH_PAD_MAX_CHARS}
        </span>
      </div>
      <textarea
        value={text}
        onChange={(event) => onChange(event.target.value)}
        maxLength={SCRATCH_PAD_MAX_CHARS}
        placeholder="Local notes for this task..."
        className="min-h-[360px] w-full resize-y rounded-md border border-border bg-card p-3 text-sm text-foreground outline-none focus:border-foreground"
      />
    </div>
  );
}

function MinimapPanel({ taskId }: { taskId: string }) {
  const rpc = useRpc<RpcContract>();
  const navigate = useBbNavigate();
  const [sessions, setSessions] = useState<SessionView[]>([]);

  const refetch = () => {
    rpc.call("listSessions", { taskId }).then(({ sessions: next }) => setSessions(next));
  };
  useEffect(() => {
    refetch();
  }, [taskId]);
  useRealtime("rpi:sessions", refetch);

  const ordered = useMemo(() => [...sessions].sort((a, b) => a.createdAt - b.createdAt), [sessions]);
  if (ordered.length === 0) return <div className="p-4 text-sm text-muted-foreground">No sessions yet.</div>;
  return (
    <div className="space-y-2">
      <h3 className="text-sm font-semibold text-foreground">Minimap</h3>
      <div className="flex flex-wrap gap-2">
        {ordered.map((session, index) => {
          const meta = statusMeta(session.rpiStatus);
          return (
            <button
              key={session.threadId}
              type="button"
              onClick={() => navigate.toThread(session.threadId)}
              title={session.title ?? session.threadId}
              className="inline-flex items-center gap-2 rounded-md border border-border bg-card px-3 py-2 text-xs transition hover:border-foreground/40"
            >
              <span className="text-muted-foreground">{index + 1}</span>
              <Icon name={meta.icon} className={cn("size-3.5", meta.className)} />
              <span className="font-medium text-foreground">{session.label ?? "freeform"}</span>
              <span className="text-muted-foreground">{relativeTime(session.threadUpdatedAt ?? session.updatedAt)}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

const ARTIFACT_GROUP_ORDER = [
  "research-questions",
  "research",
  "design-discussion",
  "prd",
  "tdd",
  "structure-outline",
  "plan",
  "pr-description",
  "other",
] as const;

function ArtifactIcon({ artifact }: { artifact: ArtifactRecord }) {
  const isImage = artifact.contentType.startsWith("image/");
  return <Icon name={isImage ? "Code" : "Code"} className={cn("size-4", isImage ? "text-foreground" : "text-muted-foreground")} />;
}

function ArtifactRow({
  artifact,
  selected,
  onSelect,
  onDelete,
  onRestore,
}: {
  artifact: ArtifactRecord;
  selected: boolean;
  onSelect: () => void;
  onDelete: () => void;
  onRestore: () => void;
}) {
  const path = `/plugins/rpi/tasks/${encodeURIComponent(artifact.taskId)}/artifacts/${encodeURIComponent(artifact.fileName)}`;
  return (
    <div className={cn("flex items-center gap-2 rounded-md border border-border bg-card px-3 py-2", selected && "border-foreground")}>
      <button type="button" onClick={onSelect} className="flex min-w-0 flex-1 items-center gap-2 text-left">
        <ArtifactIcon artifact={artifact} />
        <span className={cn("truncate text-sm font-medium", artifact.isDeleted ? "text-muted-foreground line-through" : "text-foreground")}>{artifact.fileName}</span>
      </button>
      <span className="text-xs text-muted-foreground">{artifact.commentCount}</span>
      <details className="relative">
        <summary className="flex size-7 cursor-pointer list-none items-center justify-center rounded-md border border-border text-muted-foreground hover:text-foreground">
          <Icon name="MoreHorizontal" className="size-4" />
        </summary>
        <div className="absolute right-0 z-10 mt-1 w-36 rounded-md border border-border bg-popover p-1 shadow-sm">
          <button type="button" onClick={onSelect} className="block w-full rounded px-2 py-1.5 text-left text-sm text-foreground hover:bg-muted">Open</button>
          <button type="button" onClick={() => void navigator.clipboard?.writeText(path)} className="block w-full rounded px-2 py-1.5 text-left text-sm text-foreground hover:bg-muted">Copy path</button>
          {artifact.isDeleted ? (
            <button type="button" onClick={onRestore} className="block w-full rounded px-2 py-1.5 text-left text-sm text-foreground hover:bg-muted">Restore</button>
          ) : (
            <button type="button" onClick={onDelete} className="block w-full rounded px-2 py-1.5 text-left text-sm text-foreground hover:bg-muted">Delete</button>
          )}
        </div>
      </details>
    </div>
  );
}

function ArtifactViewer({ taskId, fileName, onRestore }: { taskId: string; fileName: string; onRestore: () => void }) {
  const rpc = useRpc<RpcContract>();
  const { values: settings } = useSettings();
  const [mode, setMode] = useState<"preview" | "raw">("preview");
  const [artifact, setArtifact] = useState<ArtifactRecord | null>(null);
  const [versions, setVersions] = useState<ArtifactVersionRecord[]>([]);
  const [version, setVersion] = useState<number | null>(null);
  const [pinnedVersion, setPinnedVersion] = useState<number | null>(null);
  const [content, setContent] = useState<string | null>(null);
  const [isBinary, setIsBinary] = useState(false);
  const [url, setUrl] = useState<string | null>(null);
  const [commentThreads, setCommentThreads] = useState<CommentThreadRecord[]>([]);
  const [commentsNextOffset, setCommentsNextOffset] = useState<number | null>(null);
  const [showResolved, setShowResolved] = useState(false);
  const [composingBlock, setComposingBlock] = useState<number | null>(null);
  const [composerText, setComposerText] = useState("");
  const [sessions, setSessions] = useState<SessionView[]>([]);
  const [sendThreadId, setSendThreadId] = useState("");
  const [sendMode, setSendMode] = useState<"send" | "send-and-resolve">("send-and-resolve");

  useEffect(() => {
    setVersion(null);
    setPinnedVersion(null);
    setCommentThreads([]);
    setCommentsNextOffset(null);
    setComposingBlock(null);
  }, [taskId, fileName]);

  useEffect(() => {
    const configured = settings?.sendCommentsMode;
    if (configured === "send" || configured === "send-and-resolve") setSendMode(configured);
  }, [settings?.sendCommentsMode]);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      rpc.call("listArtifactVersions", { taskId, fileName }),
      rpc.call("getArtifact", { taskId, fileName, version: pinnedVersion }),
      rpc.call("listSessions", { taskId }),
    ]).then(([versionResult, artifactResult, sessionResult]) => {
      if (cancelled) return;
      setVersions(versionResult.versions);
      setArtifact(artifactResult.artifact);
      setContent(artifactResult.content);
      setIsBinary(artifactResult.isBinary);
      setUrl(artifactResult.url);
      setVersion(artifactResult.version?.version ?? null);
      setSessions(sessionResult.sessions);
      const latestThreadId = sessionResult.sessions[0]?.threadId;
      if (latestThreadId) setSendThreadId((current) => current || latestThreadId);
      if (artifactResult.artifact) {
        void rpc.call("listComments", { artifactId: artifactResult.artifact.id, includeResolved: showResolved, offset: 0 }).then((result) => {
          if (!cancelled) {
            setCommentThreads(result.threads);
            setCommentsNextOffset(result.nextOffset);
          }
        });
      }
    });
    return () => {
      cancelled = true;
    };
  }, [fileName, taskId, pinnedVersion, rpc, showResolved]);
  useRealtime("rpi:artifacts", (payload) => {
    if (!payload || typeof payload !== "object" || (payload as { taskId?: unknown }).taskId !== taskId) return;
    void Promise.all([
      rpc.call("listArtifactVersions", { taskId, fileName }),
      rpc.call("getArtifact", { taskId, fileName, version: pinnedVersion }),
    ]).then(([versionResult, artifactResult]) => {
      setVersions(versionResult.versions);
      setArtifact(artifactResult.artifact);
      setContent(artifactResult.content);
      setIsBinary(artifactResult.isBinary);
      setUrl(artifactResult.url);
      setVersion(artifactResult.version?.version ?? null);
      if (artifactResult.artifact) {
        void rpc.call("listComments", { artifactId: artifactResult.artifact.id, includeResolved: showResolved, offset: 0 }).then((result) => {
          setCommentThreads(result.threads);
          setCommentsNextOffset(result.nextOffset);
        });
      }
    });
  });
  useRealtime("rpi:comments", (payload) => {
    if (!artifact || !payload || typeof payload !== "object" || (payload as { artifactId?: unknown }).artifactId !== artifact.id) return;
    void rpc.call("listComments", { artifactId: artifact.id, includeResolved: showResolved, offset: 0 }).then((result) => {
      setCommentThreads(result.threads);
      setCommentsNextOffset(result.nextOffset);
    });
  });

  if (!artifact) return <div className="rounded-md border border-dashed border-border p-4 text-sm text-muted-foreground">Select an artifact.</div>;

  const versionMeta = versions.find((item) => item.version === version);
  const blocks = !isBinary && content !== null ? markdownBlocks(content) : [];

  const saveComment = async (block: (typeof blocks)[number]) => {
    if (!versionMeta || composerText.trim() === "") return;
    await rpc.call("createComment", {
      artifactId: artifact.id,
      versionId: versionMeta.id,
      contentText: composerText.trim(),
      blockText: block.text,
      prevBlockText: blocks[block.index - 1]?.text ?? null,
      nextBlockText: blocks[block.index + 1]?.text ?? null,
      anchorJson: { v: 1, blockIndex: block.index, start: block.start, end: block.end, selectedText: block.text },
      replyToId: null,
    });
    setComposerText("");
    setComposingBlock(null);
    const result = await rpc.call("listComments", { artifactId: artifact.id, includeResolved: showResolved });
    setCommentThreads(result.threads);
    setCommentsNextOffset(result.nextOffset);
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 rounded-md border border-border bg-card p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <h3 className="truncate text-sm font-semibold text-foreground">{artifact.fileName}</h3>
          <div className="text-xs text-muted-foreground">
            v{version ?? artifact.currentVersion}
            {versionMeta ? ` by ${versionMeta.createdBy} at ${new Date(versionMeta.createdAt).toLocaleString()}` : ""}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <select value={version ?? artifact.currentVersion} onChange={(event) => setPinnedVersion(Number.parseInt(event.target.value, 10))} className="h-8 rounded-md border border-border bg-background px-2 text-xs text-foreground">
            {versions.map((item) => (
              <option key={item.id} value={item.version}>v{item.version} {item.createdBy}</option>
            ))}
          </select>
          <button type="button" onClick={() => setMode("preview")} className={cn("h-8 rounded-md border px-2 text-xs", mode === "preview" ? "border-foreground text-foreground" : "border-border text-muted-foreground")}>Preview</button>
          <button type="button" onClick={() => setMode("raw")} className={cn("h-8 rounded-md border px-2 text-xs", mode === "raw" ? "border-foreground text-foreground" : "border-border text-muted-foreground")}>Raw</button>
        </div>
      </div>
      {artifact.isDeleted ? (
        <div className="flex items-center justify-between gap-3 rounded-md border border-border bg-muted px-3 py-2 text-sm text-muted-foreground">
          <span>This artifact is deleted.</span>
          <Button type="button" variant="outline" className="h-8" onClick={onRestore}>Restore</Button>
        </div>
      ) : null}
      <div className="grid min-h-[260px] flex-1 gap-3 overflow-hidden lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="min-h-0 overflow-auto rounded-md border border-border bg-background p-3">
          {mode === "preview" && isRasterPreview(artifact.contentType) && url ? (
            <img src={url} alt={artifact.fileName} className="max-h-full max-w-full rounded-md" />
          ) : mode === "preview" && isSandboxedPreview(artifact.contentType) && content !== null ? (
            <iframe title={artifact.fileName} sandbox="" srcDoc={content} className="h-full min-h-[240px] w-full rounded-md border-0 bg-background" />
          ) : mode === "preview" && !isBinary && content !== null ? (
            <div className="space-y-2">
              {blocks.map((block) => (
                <div key={block.index} className="group grid grid-cols-[28px_minmax(0,1fr)] gap-2 rounded-md border border-transparent hover:border-border">
                  <button
                    type="button"
                    aria-label="Add comment"
                    title="Add comment"
                    onClick={() => {
                      setComposingBlock(block.index);
                      setComposerText("");
                    }}
                    className="mt-2 flex size-7 items-center justify-center rounded-md border border-border text-muted-foreground opacity-0 transition hover:text-foreground group-hover:opacity-100"
                  >
                    <Icon name="Plus" className="size-4" />
                  </button>
                  <div className="min-w-0">
                    <Markdown content={block.text} />
                    {composingBlock === block.index ? (
                      <div className="mb-2 space-y-2 rounded-md border border-border bg-card p-2">
                        <textarea value={composerText} onChange={(event) => setComposerText(event.target.value)} className="min-h-20 w-full rounded-md border border-border bg-background p-2 text-sm text-foreground" />
                        <div className="flex justify-end gap-2">
                          <Button type="button" variant="outline" className="h-8" onClick={() => setComposingBlock(null)}>Cancel</Button>
                          <Button type="button" className="h-8" onClick={() => void saveComment(block)}>Save</Button>
                        </div>
                      </div>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          ) : isBinary ? (
            <div className="text-sm text-muted-foreground">Binary preview is available through the HTTP route.</div>
          ) : (
            <SourceCode content={content ?? ""} path={artifact.fileName} overflow="wrap" />
          )}
        </div>
        <CommentRail
          artifact={artifact}
          threads={commentThreads}
          showResolved={showResolved}
          setShowResolved={setShowResolved}
          sessions={sessions}
          sendThreadId={sendThreadId}
          setSendThreadId={setSendThreadId}
          sendMode={sendMode}
          setSendMode={setSendMode}
          nextOffset={commentsNextOffset}
          refetch={() => rpc.call("listComments", { artifactId: artifact.id, includeResolved: showResolved, offset: 0 }).then((result) => {
            setCommentThreads(result.threads);
            setCommentsNextOffset(result.nextOffset);
          })}
          loadMore={() => commentsNextOffset === null ? Promise.resolve() : rpc.call("listComments", { artifactId: artifact.id, includeResolved: showResolved, offset: commentsNextOffset }).then((result) => {
            setCommentThreads((current) => [...current, ...result.threads]);
            setCommentsNextOffset(result.nextOffset);
          })}
        />
      </div>
    </div>
  );
}

function CommentRail({
  artifact,
  threads,
  showResolved,
  setShowResolved,
  sessions,
  sendThreadId,
  setSendThreadId,
  sendMode,
  setSendMode,
  nextOffset,
  refetch,
  loadMore,
}: {
  artifact: ArtifactRecord;
  threads: CommentThreadRecord[];
  showResolved: boolean;
  setShowResolved: (value: boolean) => void;
  sessions: SessionView[];
  sendThreadId: string;
  setSendThreadId: (value: string) => void;
  sendMode: "send" | "send-and-resolve";
  setSendMode: (value: "send" | "send-and-resolve") => void;
  nextOffset: number | null;
  refetch: () => Promise<void>;
  loadMore: () => Promise<void>;
}) {
  const rpc = useRpc<RpcContract>();
  const [sending, setSending] = useState(false);
  const anchored = threads.filter((thread) => !thread.root.anchor?.orphaned);
  const unanchored = threads.filter((thread) => thread.root.anchor?.orphaned);
  const unresolvedIds = threads.filter((thread) => !thread.root.isResolved).map((thread) => thread.root.id);
  const sendIds = unresolvedIds.slice(0, 100);
  const sendLabel = unresolvedIds.length > sendIds.length
    ? `${sending ? "Sending" : "Send"} first ${sendIds.length} of ${unresolvedIds.length}`
    : `${sending ? "Sending" : "Send"} ${sendIds.length} comments to session`;

  const update = async (action: Promise<unknown>) => {
    await action;
    await refetch();
  };

  const sendSelected = async () => {
    if (!sendThreadId || sendIds.length === 0 || sending) return;
    setSending(true);
    try {
      const requestId = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
      await rpc.call("sendCommentsToSession", { threadId: sendThreadId, artifactId: artifact.id, commentIds: sendIds, mode: sendMode, requestId });
      await refetch();
    } finally {
      setSending(false);
    }
  };

  return (
    <aside className="min-h-0 overflow-auto rounded-md border border-border bg-background p-3">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h4 className="text-sm font-semibold text-foreground">Comments</h4>
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          <input type="checkbox" checked={showResolved} onChange={(event) => setShowResolved(event.target.checked)} />
          Show resolved
        </label>
      </div>
      <div className="mb-3 space-y-2 rounded-md border border-border bg-card p-2">
        <select value={sendThreadId} onChange={(event) => setSendThreadId(event.target.value)} className="h-8 w-full rounded-md border border-border bg-background px-2 text-xs text-foreground">
          {sessions.map((session) => <option key={session.threadId} value={session.threadId}>{session.title ?? session.threadId}</option>)}
        </select>
        <select value={sendMode} onChange={(event) => setSendMode(event.target.value as "send" | "send-and-resolve")} className="h-8 w-full rounded-md border border-border bg-background px-2 text-xs text-foreground">
          <option value="send-and-resolve">Send and resolve</option>
          <option value="send">Send</option>
        </select>
        <Button type="button" className="h-8 w-full" disabled={!sendThreadId || sendIds.length === 0 || sending} onClick={() => void sendSelected()}>
          {sendLabel}
        </Button>
      </div>
      <div className="space-y-3">
        {anchored.map((thread) => (
          <CommentThread key={thread.root.id} artifactId={artifact.id} thread={thread} update={update} />
        ))}
        {unanchored.length > 0 ? (
          <section className="space-y-2 border-t border-border pt-3">
            <div className="text-xs font-semibold uppercase tracking-[0.22em] text-muted-foreground">Unanchored</div>
            {unanchored.map((thread) => <CommentThread key={thread.root.id} artifactId={artifact.id} thread={thread} update={update} />)}
          </section>
        ) : null}
        {nextOffset === null ? null : (
          <Button type="button" variant="outline" className="h-8 w-full" onClick={() => void loadMore()}>
            Load more
          </Button>
        )}
      </div>
    </aside>
  );
}

function CommentThread({ artifactId, thread, update }: { artifactId: string; thread: CommentThreadRecord; update: (action: Promise<unknown>) => Promise<void> }) {
  const rpc = useRpc<RpcContract>();
  const [reply, setReply] = useState("");
  const [editing, setEditing] = useState(false);
  const [editText, setEditText] = useState(thread.root.contentText);
  const root = thread.root;
  return (
    <article className="space-y-2 rounded-md border border-border bg-card p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-xs font-medium text-foreground">{root.createdByAgent ? "Agent" : "You"} <span className="text-muted-foreground">{relativeTime(root.createdAt)}</span></div>
          <div className="text-xs text-muted-foreground">block {root.anchor?.orphaned ? "unanchored" : root.anchor?.blockIndex ?? "?"}</div>
        </div>
        <button type="button" className="text-xs text-muted-foreground hover:text-foreground" onClick={() => void update(rpc.call("resolveComments", { artifactId, commentIds: [root.id], resolved: !root.isResolved }))}>
          {root.isResolved ? "Unresolve" : "Resolve"}
        </button>
      </div>
      {editing ? (
        <div className="space-y-2">
          <textarea value={editText} onChange={(event) => setEditText(event.target.value)} className="min-h-20 w-full rounded-md border border-border bg-background p-2 text-sm text-foreground" />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" className="h-8" onClick={() => setEditing(false)}>Cancel</Button>
            <Button type="button" className="h-8" onClick={() => void update(rpc.call("editComment", { commentId: root.id, content: editText })).then(() => setEditing(false))}>Save</Button>
          </div>
        </div>
      ) : (
        <p className="whitespace-pre-wrap text-sm text-foreground">{root.contentText}</p>
      )}
      <div className="flex flex-wrap gap-2 text-xs">
        <button type="button" className="text-muted-foreground hover:text-foreground" onClick={() => setReply((value) => value || " ")}>Reply</button>
        {!root.createdByAgent ? <button type="button" className="text-muted-foreground hover:text-foreground" onClick={() => setEditing(true)}>Edit</button> : null}
        <button type="button" className="text-muted-foreground hover:text-foreground" onClick={() => void update(rpc.call("deleteComment", { artifactId, commentIds: [root.id] }))}>Delete</button>
      </div>
      {thread.replies.map((item) => (
        <div key={item.id} className="rounded-md border border-border bg-background p-2">
          <div className="text-xs font-medium text-foreground">{item.createdByAgent ? "Agent" : "You"} <span className="text-muted-foreground">{relativeTime(item.createdAt)}</span></div>
          <p className="whitespace-pre-wrap text-sm text-foreground">{item.contentText}</p>
        </div>
      ))}
      {reply ? (
        <div className="space-y-2">
          <textarea value={reply.trimStart()} onChange={(event) => setReply(event.target.value)} className="min-h-16 w-full rounded-md border border-border bg-background p-2 text-sm text-foreground" />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" className="h-8" onClick={() => setReply("")}>Cancel</Button>
            <Button type="button" className="h-8" onClick={() => void update(rpc.call("replyComment", { artifactId, commentId: root.id, content: reply.trim() })).then(() => setReply(""))}>Reply</Button>
          </div>
        </div>
      ) : null}
    </article>
  );
}

function isRasterPreview(contentType: string) {
  return ["image/png", "image/jpeg", "image/gif", "image/webp"].includes(contentType.toLowerCase());
}

function isSandboxedPreview(contentType: string) {
  return ["text/html", "application/xhtml+xml", "image/svg+xml"].includes(contentType.toLowerCase());
}

function ArtifactsPanel({ taskId, initialFileName }: { taskId: string; initialFileName?: string | null }) {
  const rpc = useRpc<RpcContract>();
  const [artifacts, setArtifacts] = useState<ArtifactRecord[]>([]);
  const [grouped, setGrouped] = useState(true);
  const [selected, setSelected] = useState<string | null>(initialFileName ?? null);
  const [busy, setBusy] = useState(false);

  const refetch = () => {
    rpc.call("listArtifacts", { taskId, includeDeleted: true }).then(({ artifacts: next }) => {
      setArtifacts(next);
      setSelected((current) => {
        if (current && next.some((artifact) => artifact.fileName === current)) return current;
        if (initialFileName && next.some((artifact) => artifact.fileName === initialFileName)) return initialFileName;
        return next.find((artifact) => !artifact.isDeleted)?.fileName ?? next[0]?.fileName ?? null;
      });
    });
  };

  useEffect(() => {
    refetch();
  }, [taskId, initialFileName]);
  useRealtime("artifacts", refetch);
  useRealtime("rpi:artifacts", refetch);

  const liveArtifacts = useMemo(() => artifacts.filter((artifact) => !artifact.isDeleted), [artifacts]);
  const deletedArtifacts = useMemo(() => artifacts.filter((artifact) => artifact.isDeleted), [artifacts]);
  const groups = useMemo(() => ARTIFACT_GROUP_ORDER.map((group) => ({
    group,
    artifacts: liveArtifacts.filter((artifact) => artifact.groupType === group),
  })).filter((group) => group.artifacts.length > 0 || group.group === "other"), [liveArtifacts]);

  const mutate = async (action: "deleteArtifact" | "restoreArtifact", fileName: string) => {
    await rpc.call(action, { taskId, fileName });
    refetch();
  };

  const hydrateNow = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await rpc.call("hydrateNow", { taskId });
      refetch();
    } finally {
      setBusy(false);
    }
  };

  const rows = (items: ArtifactRecord[]) => items.map((artifact) => (
    <ArtifactRow
      key={artifact.id}
      artifact={artifact}
      selected={selected === artifact.fileName}
      onSelect={() => setSelected(artifact.fileName)}
      onDelete={() => void mutate("deleteArtifact", artifact.fileName)}
      onRestore={() => void mutate("restoreArtifact", artifact.fileName)}
    />
  ));

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => setGrouped((value) => !value)} className={cn("inline-flex h-9 items-center gap-2 rounded-md border px-3 text-xs uppercase tracking-[0.2em]", grouped ? "border-foreground text-foreground" : "border-border text-muted-foreground")}>
            Grouped
          </button>
          <span className="text-xs text-muted-foreground">{artifacts.length} artifacts</span>
        </div>
        <Button type="button" variant="outline" className="h-9" disabled={busy} onClick={hydrateNow}>
          <Icon name="Download" className="size-4" />
          Hydrate now
        </Button>
      </div>
      <div className="grid min-h-0 flex-1 gap-3 lg:grid-cols-[minmax(220px,360px)_minmax(0,1fr)]">
        <div className="min-h-0 space-y-3 overflow-auto">
          {artifacts.length === 0 ? (
            <div className="rounded-md border border-dashed border-border p-4 text-sm text-muted-foreground">No artifacts yet.</div>
          ) : grouped ? (
            <>
              {groups.map((group) => (
                <section key={group.group} className="space-y-2">
                  <div className="text-xs font-semibold uppercase tracking-[0.22em] text-muted-foreground">{group.group.replaceAll("-", " ")} ({group.artifacts.length})</div>
                  <div className="space-y-2">{rows(group.artifacts)}</div>
                </section>
              ))}
              {deletedArtifacts.length > 0 ? (
                <section className="space-y-2">
                  <div className="text-xs font-semibold uppercase tracking-[0.22em] text-muted-foreground">DELETED ({deletedArtifacts.length})</div>
                  <div className="space-y-2">{rows(deletedArtifacts)}</div>
                </section>
              ) : null}
            </>
          ) : (
            <div className="space-y-3">
              <div className="space-y-2">{rows(liveArtifacts)}</div>
              {deletedArtifacts.length > 0 ? (
                <section className="space-y-2">
                  <div className="text-xs font-semibold uppercase tracking-[0.22em] text-muted-foreground">DELETED ({deletedArtifacts.length})</div>
                  <div className="space-y-2">{rows(deletedArtifacts)}</div>
                </section>
              ) : null}
            </div>
          )}
        </div>
        {selected ? <ArtifactViewer taskId={taskId} fileName={selected} onRestore={() => void mutate("restoreArtifact", selected)} /> : null}
      </div>
    </div>
  );
}

function TaskDetailPage({ taskId, artifactFileName }: { taskId: string; artifactFileName?: string | null }) {
  const rpc = useRpc<RpcContract>();
  const navigate = useBbNavigate();
  const [task, setTask] = useState<TaskRecord | null>(null);
  const [workspace, setWorkspace] = useState<TaskWorkspaceState | null>(null);
  const [sessions, setSessions] = useState<SessionView[]>([]);
  const [tab, setTab] = useState<"sessions" | "artifacts" | "workspace" | "auto-advance" | "scratch" | "minimap" | "tips">(artifactFileName ? "artifacts" : "sessions");
  const [uiState, setUiState] = useState<TaskUiState | null>(null);

  const refetch = () => {
    Promise.all([
      rpc.call("getTask", { taskId }),
      rpc.call("listSessions", { taskId }),
    ]).then(([taskResult, sessionResult]) => {
      setTask(taskResult.task);
      setWorkspace(taskResult.workspace);
      setSessions(sessionResult.sessions);
    });
  };

  useEffect(() => {
    refetch();
    rpc.call("getTaskUiState", { taskId }).then(setUiState);
  }, [taskId]);
  useEffect(() => {
    if (artifactFileName) setTab("artifacts");
  }, [artifactFileName]);
  useRealtime("tasks", refetch);
  useRealtime("rpi:sessions", refetch);
  useRealtime("rpi:ui-state", () => {
    rpc.call("getTaskUiState", { taskId }).then(setUiState);
  });

  if (!task || !workspace) {
    return <div className="p-4 text-sm text-muted-foreground">Loading...</div>;
  }

  // A failed attempt not yet retried stays visible (with Retry) so a failed-advance recovery
  // toast's "Retry it from Launch Attempts" instruction is actionable. Once retried, retryMarker
  // is set and the old row is superseded by its retry attempt, so it drops out of the list.
  const visibleAttempts = workspace.launchAttempts.filter((attempt) =>
    attempt.status === "pending" || attempt.status === "uncertain" || attempt.status === "retrying" ||
    (attempt.status === "failed" && attempt.retryMarker === null),
  );

  return (
    <div className="space-y-4">
      <button
        type="button"
        onClick={() => navigate.toPluginPanel("rpi", { subPath: "" })}
        className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
      >
        <Icon name="ChevronLeft" className="size-4" />
        Tasks
      </button>
      {uiState?.legacyTaskDirWarning ? (
        <div className="flex items-start justify-between gap-3 rounded-md border border-border bg-card p-3 text-sm text-foreground">
          <span>
            Task files are under the legacy directory; run <code>git mv {uiState.legacyTaskDirName} .rpi</code> in the repo.
          </span>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={async () => setUiState(await rpc.call("dismissLegacyTaskDirWarning", { taskId }))}
          >
            Dismiss
          </Button>
        </div>
      ) : null}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-2">
          <h2 className="text-2xl font-semibold tracking-tight text-foreground">{task.name}</h2>
          <div className="flex flex-wrap gap-2">
            <span className={pillClassName(task.isDraft ? "draft" : "step")}>{task.isDraft ? "Draft" : workspace.currentLabel ?? "Session"}</span>
            <span className={pillClassName("ghost")}>{task.workflowType}</span>
            <span className={pillClassName("ghost")}>{task.worktreeTiming}</span>
          </div>
        </div>
        {task.isDraft ? (
          <Button
            type="button"
            onClick={async () => {
              try {
                const result = await rpc.call("launchDraft", { taskId });
                navigate.toThread(result.threadId);
              } catch (error) {
                reportLaunchError(error);
              }
            }}
          >
            <Icon name="Play" className="size-4" />
            Launch
          </Button>
        ) : null}
      </div>
      <div className="flex items-center gap-2 border-b border-border pb-2 text-xs font-medium uppercase tracking-[0.24em] text-muted-foreground">
        <button type="button" onClick={() => setTab("sessions")} className={cn("rounded-md px-3 py-1.5", tab === "sessions" && "bg-card text-foreground")}>Sessions</button>
        <button type="button" onClick={() => setTab("artifacts")} className={cn("rounded-md px-3 py-1.5", tab === "artifacts" && "bg-card text-foreground")}>Artifacts</button>
        <button type="button" onClick={() => setTab("workspace")} className={cn("rounded-md px-3 py-1.5", tab === "workspace" && "bg-card text-foreground")}>Workspace</button>
        <button type="button" onClick={() => setTab("auto-advance")} className={cn("rounded-md px-3 py-1.5", tab === "auto-advance" && "bg-card text-foreground")}>Auto-advance</button>
        <button type="button" onClick={() => setTab("scratch")} className={cn("rounded-md px-3 py-1.5", tab === "scratch" && "bg-card text-foreground")}>Scratch</button>
        <button type="button" onClick={() => setTab("minimap")} className={cn("rounded-md px-3 py-1.5", tab === "minimap" && "bg-card text-foreground")}>Minimap</button>
        <button type="button" onClick={() => setTab("tips")} className={cn("rounded-md px-3 py-1.5", tab === "tips" && "bg-card text-foreground")}>Tips</button>
      </div>
      <WorkflowStrip workflowType={task.workflowType} worktreeTiming={task.worktreeTiming} currentLabel={workspace.currentLabel} />
      {tab === "artifacts" ? (
        <div className="min-h-[520px]">
          <ArtifactsPanel taskId={taskId} initialFileName={artifactFileName} />
        </div>
      ) : tab === "workspace" ? (
        <WorkspacePanel taskId={taskId} />
      ) : tab === "auto-advance" ? (
        <AutoAdvancePanel task={task} onUpdated={refetch} />
      ) : tab === "scratch" ? (
        <ScratchPadPanel taskId={taskId} />
      ) : tab === "minimap" ? (
        <MinimapPanel taskId={taskId} />
      ) : tab === "tips" ? (
        <TipsPanel taskId={taskId} label={workspace.currentLabel} />
      ) : (
        <>
          {visibleAttempts.length > 0 ? (
            <div className="space-y-2">
              {visibleAttempts.map((attempt) => <RecoverLaunchRow key={attempt.id} attempt={attempt} onResolved={refetch} />)}
            </div>
          ) : null}
          {sessions.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border bg-card/60 px-4 py-6 text-sm text-muted-foreground">
              No sessions yet.
            </div>
          ) : (
            <SessionsTable sessions={sessions} />
          )}
        </>
      )}
    </div>
  );
}

export function RpiArtifactThreadPanel({ threadId, params }: { threadId: string; params?: unknown }) {
  const rpc = useRpc<RpcContract>();
  const [session, setSession] = useState<SessionView | null | undefined>(undefined);
  const initialFileName = typeof params === "object" && params !== null && "fileName" in params ? String((params as { fileName?: unknown }).fileName ?? "") : null;

  useEffect(() => {
    rpc.call("getSession", { threadId }).then(({ session: next }) => setSession(next));
  }, [rpc, threadId]);

  if (session === undefined) return <div className="p-4 text-sm text-muted-foreground">Loading...</div>;
  if (!session) return <div className="p-4 text-sm text-muted-foreground">Not an RPI task session</div>;
  return (
    <div className="h-full min-h-0 p-3">
      <ArtifactsPanel taskId={session.taskId} initialFileName={initialFileName} />
    </div>
  );
}

export function RpiWorkspaceThreadPanel({ threadId }: { threadId: string }) {
  const rpc = useRpc<RpcContract>();
  const [session, setSession] = useState<SessionView | null | undefined>(undefined);

  useEffect(() => {
    rpc.call("getSession", { threadId }).then(({ session: next }) => setSession(next));
  }, [rpc, threadId]);

  if (session === undefined) return <div className="p-4 text-sm text-muted-foreground">Loading...</div>;
  if (!session) return <div className="p-4 text-sm text-muted-foreground">Not an RPI task session</div>;
  return (
    <div className="h-full min-h-0 overflow-auto p-3">
      <WorkspacePanel taskId={session.taskId} />
    </div>
  );
}

export function RpiTipsThreadPanel({ threadId }: { threadId: string }) {
  const rpc = useRpc<RpcContract>();
  const [session, setSession] = useState<SessionView | null | undefined>(undefined);

  useEffect(() => {
    rpc.call("getSession", { threadId }).then(({ session: next }) => setSession(next));
  }, [rpc, threadId]);

  if (session === undefined) return <div className="p-4 text-sm text-muted-foreground">Loading...</div>;
  if (!session) return <div className="p-4 text-sm text-muted-foreground">Not an RPI task session</div>;
  return (
    <div className="h-full min-h-0 overflow-auto p-3">
      <TipsPanel taskId={session.taskId} label={session.label} />
    </div>
  );
}

export function RpiScratchThreadPanel({ threadId }: { threadId: string }) {
  const rpc = useRpc<RpcContract>();
  const [session, setSession] = useState<SessionView | null | undefined>(undefined);

  useEffect(() => {
    rpc.call("getSession", { threadId }).then(({ session: next }) => setSession(next));
  }, [rpc, threadId]);

  if (session === undefined) return <div className="p-4 text-sm text-muted-foreground">Loading...</div>;
  if (!session) return <div className="p-4 text-sm text-muted-foreground">Not an RPI task session</div>;
  return (
    <div className="h-full min-h-0 overflow-auto p-3">
      <ScratchPadPanel taskId={session.taskId} />
    </div>
  );
}

export function RpiMinimapThreadPanel({ threadId }: { threadId: string }) {
  const rpc = useRpc<RpcContract>();
  const [session, setSession] = useState<SessionView | null | undefined>(undefined);

  useEffect(() => {
    rpc.call("getSession", { threadId }).then(({ session: next }) => setSession(next));
  }, [rpc, threadId]);

  if (session === undefined) return <div className="p-4 text-sm text-muted-foreground">Loading...</div>;
  if (!session) return <div className="p-4 text-sm text-muted-foreground">Not an RPI task session</div>;
  return (
    <div className="h-full min-h-0 overflow-auto p-3">
      <MinimapPanel taskId={session.taskId} />
    </div>
  );
}

export function RpiArtifactDirective({ attributes, source }: { attributes: Readonly<Record<string, string>>; source: string }) {
  const navigate = useBbNavigate();
  const taskId = attributes.task;
  const fileName = attributes.file;
  if (!taskId || !fileName || fileName.includes("..") || fileName.includes("/") || fileName.includes("\\")) return <code>{source}</code>;
  const open = () => {
    const accepted = navigate.openThreadPanel({
      actionId: "artifacts",
      title: fileName,
      params: { taskId, fileName },
    });
    if (!accepted) navigate.toPluginPanel("rpi", { subPath: `tasks/${taskId}/artifacts/${encodeURIComponent(fileName)}` });
  };
  return (
    <button type="button" onClick={open} className="inline-flex items-center gap-2 rounded-md border border-border bg-card px-2 py-1 text-sm font-medium text-foreground">
      <Icon name="Code" className="size-4" />
      {fileName}
    </button>
  );
}

// Sidebar thread-list replacement (Fable §11, shipped last/optional per plan §2.7). Groups this
// plugin's own task session threads under their task with a phase pill and relative time; every
// other thread (freeform sessions, other plugins' threads) renders as a plain row below, using
// bb's own sidebar feed (`experimental_useSidebarThreads`) for title/indicator/time. A manual
// "Use default list" toggle renders `Original` on request, on top of the host's own automatic
// fallback for a missing/crashing replacement.
function otherThreadGlyph(thread: { hasPendingInteraction: boolean; isUnread: boolean }) {
  if (thread.hasPendingInteraction) return { icon: "AlertCircle" as const, className: "text-destructive" };
  if (thread.isUnread) return { icon: "Circle" as const, className: "text-foreground" };
  return { icon: "Circle" as const, className: "text-muted-foreground" };
}

export function RpiThreadList({ activeThreadId, isCompactViewport, onNavigate, Original }: PluginThreadListProps) {
  const rpc = useRpc<RpcContract>();
  const navigate = useBbNavigate();
  const sidebar = experimental_useSidebarThreads();
  const [useDefault, setUseDefault] = useState(false);
  const [sessionsByThread, setSessionsByThread] = useState<Map<string, SessionView>>(new Map());
  const [taskNames, setTaskNames] = useState<Map<string, string>>(new Map());

  const refetch = () => {
    Promise.all([
      rpc.call("listSessions", { taskId: null }),
      rpc.call("listTasks", { archived: false }),
    ]).then(([sessionResult, taskResult]) => {
      setSessionsByThread(new Map(sessionResult.sessions.map((session) => [session.threadId, session])));
      setTaskNames(new Map(taskResult.tasks.map((task) => [task.id, task.name])));
    });
  };
  useEffect(() => {
    refetch();
  }, []);
  useRealtime("tasks", refetch);
  useRealtime("rpi:sessions", refetch);

  if (useDefault) {
    return (
      <div className="flex h-full min-h-0 flex-col">
        <button type="button" onClick={() => setUseDefault(false)} className="px-3 py-1.5 text-left text-[11px] uppercase tracking-[0.2em] text-muted-foreground hover:text-foreground">
          Use RPI list
        </button>
        <div className="min-h-0 flex-1"><Original /></div>
      </div>
    );
  }
  if (sidebar.status !== "ready") return <Original />;

  const groups = new Map<string, { taskName: string; threads: PluginSidebarThread[] }>();
  const other: PluginSidebarThread[] = [];
  for (const thread of sidebar.threads) {
    const session = sessionsByThread.get(thread.id);
    const taskName = session ? taskNames.get(session.taskId) : undefined;
    if (!session || !taskName) {
      other.push(thread);
      continue;
    }
    const group = groups.get(session.taskId) ?? { taskName, threads: [] };
    group.threads.push(thread);
    groups.set(session.taskId, group);
  }
  const sortedOther = [...other].sort((a, b) => b.updatedAt - a.updatedAt);

  const go = (threadId: string) => {
    navigate.toThread(threadId);
    onNavigate();
  };

  return (
    <div className="flex h-full min-h-0 flex-col overflow-y-auto p-2">
      <button type="button" onClick={() => setUseDefault(true)} className="px-1 pb-2 text-left text-[11px] uppercase tracking-[0.2em] text-muted-foreground hover:text-foreground">
        Use default list
      </button>
      <div className="space-y-3">
        {[...groups.entries()].map(([taskId, group]) => (
          <div key={taskId} className="space-y-1">
            <div className="px-1 text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">{group.taskName}</div>
            {group.threads
              .slice()
              .sort((a, b) => b.updatedAt - a.updatedAt)
              .map((thread) => {
                const session = sessionsByThread.get(thread.id)!;
                const meta = statusMeta(session.rpiStatus);
                return (
                  <button
                    key={thread.id}
                    type="button"
                    onClick={() => go(thread.id)}
                    title={thread.title ?? thread.titleFallback ?? undefined}
                    className={cn(
                      "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm",
                      thread.id === activeThreadId ? "bg-card text-foreground" : "text-muted-foreground hover:bg-card/60",
                    )}
                  >
                    <Icon name={meta.icon} className={cn("size-3.5 shrink-0", meta.className)} />
                    <span className="truncate">{thread.title ?? thread.titleFallback ?? "Untitled"}</span>
                    <span className={cn("ml-auto shrink-0 text-[10px]", isCompactViewport && "hidden")}>{session.label ?? ""}</span>
                  </button>
                );
              })}
          </div>
        ))}
        {sortedOther.length > 0 ? (
          <div className="space-y-1">
            <div className="px-1 text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">Other</div>
            {sortedOther.map((thread) => {
              const glyph = otherThreadGlyph(thread);
              return (
                <button
                  key={thread.id}
                  type="button"
                  onClick={() => go(thread.id)}
                  title={thread.indicatorLabel ?? undefined}
                  className={cn(
                    "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm",
                    thread.id === activeThreadId ? "bg-card text-foreground" : "text-muted-foreground hover:bg-card/60",
                  )}
                >
                  <Icon name={glyph.icon} className={cn("size-3.5 shrink-0", glyph.className)} />
                  <span className="truncate">{thread.title ?? thread.titleFallback ?? "Untitled"}</span>
                  <span className="ml-auto shrink-0 text-[10px]">{relativeTime(thread.updatedAt)}</span>
                </button>
              );
            })}
          </div>
        ) : null}
      </div>
    </div>
  );
}

export const viewing = new Set<string>();

function NotificationCheckbox({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="flex items-center justify-between gap-3 rounded-md border border-border bg-card px-3 py-2 text-sm text-foreground">
      <span>{label}</span>
      <Checkbox checked={checked} onCheckedChange={(value) => onChange(value === true)} />
    </label>
  );
}

export function RpiNotificationSettings() {
  const rpc = useRpc<RpcContract>();
  const [prefs, setPrefs] = useState<Prefs["notifications"]>(DEFAULT_NOTIFICATION_PREFS);
  const audioUnlockBlocked = useAudioUnlockBlocked();

  const refresh = () => {
    rpc.call("getPrefs", {}).then((next) => setPrefs(normalizeClientNotificationPrefs(next.notifications)));
  };
  useEffect(() => {
    refresh();
  }, []);
  useRealtime("prefs", refresh);

  const save = (next: Prefs["notifications"]) => {
    const normalized = normalizeClientNotificationPrefs(next);
    setPrefs(normalized);
    void rpc.call("setPrefs", { notifications: normalized });
  };
  const updateKind = (channel: "sound" | "toast", kind: keyof Prefs["notifications"]["sound"], checked: boolean) => {
    save({ ...prefs, [channel]: { ...prefs[channel], [kind]: checked } });
  };

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-sm font-semibold uppercase tracking-[0.24em] text-foreground">Notifications</h2>
        <p className="mt-1 text-sm text-muted-foreground">Cmd Shift J is reserved by Chromium, so RPI uses Cmd Shift U by default.</p>
      </div>
      <div className="grid gap-3 lg:grid-cols-2">
        <NotificationCheckbox label="Enable notifications" checked={prefs.enabled} onChange={(checked) => save({ ...prefs, enabled: checked })} />
        <NotificationCheckbox label="Sound for ready sessions" checked={prefs.sound.ready_for_input} onChange={(checked) => updateKind("sound", "ready_for_input", checked)} />
        <NotificationCheckbox label="Toast for ready sessions" checked={prefs.toast.ready_for_input} onChange={(checked) => updateKind("toast", "ready_for_input", checked)} />
        <NotificationCheckbox label="Sound for approvals" checked={prefs.sound.needs_approval} onChange={(checked) => updateKind("sound", "needs_approval", checked)} />
        <NotificationCheckbox label="Toast for approvals" checked={prefs.toast.needs_approval} onChange={(checked) => updateKind("toast", "needs_approval", checked)} />
        <NotificationCheckbox label="Sound for comments" checked={prefs.sound.comment} onChange={(checked) => updateKind("sound", "comment", checked)} />
        <NotificationCheckbox label="Toast for comments" checked={prefs.toast.comment} onChange={(checked) => updateKind("toast", "comment", checked)} />
      </div>
      <div className="grid gap-3 lg:grid-cols-2">
        <label className="space-y-2 rounded-md border border-border bg-card p-3 text-sm text-foreground">
          <span className="block font-medium">Volume {Math.round(prefs.volume * 100)}%</span>
          <input
            type="range"
            min="0"
            max="1"
            step="0.05"
            value={prefs.volume}
            onChange={(event) => save({ ...prefs, volume: Number(event.currentTarget.value) })}
            className="w-full accent-foreground"
          />
        </label>
        <label className="space-y-2 rounded-md border border-border bg-card p-3 text-sm text-foreground">
          <span className="block font-medium">Jump hotkey</span>
          <Input value={prefs.jumpHotkey} onChange={(event) => save({ ...prefs, jumpHotkey: event.currentTarget.value })} />
        </label>
      </div>
      {audioUnlockBlocked ? (
        <p className="text-xs text-destructive">Sound is blocked by the browser. Click Test sound to allow it.</p>
      ) : null}
      <Button type="button" variant="outline" onClick={() => void playNotificationSound(prefs.volume, true)}>
        <Icon name="Play" className="size-4" />
        Test sound
      </Button>
      <RpiNotificationBridge />
    </div>
  );
}

const WORKFLOW_TYPE_OPTIONS: Array<{ value: WorkflowType; label: string }> = [
  { value: "rpi", label: "RPI" },
  { value: "outline_only", label: "Outline" },
  { value: "prd_tdd", label: "PRD / TDD" },
  { value: "oneshot", label: "Oneshot" },
  { value: "freeform", label: "Freeform" },
];

const EMPTY_WORKFLOW_OVERRIDE: WorkflowOverride = {};

export function RpiDefaultsSettings() {
  const rpc = useRpc<RpcContract>();
  const [prefs, setPrefs] = useState<Prefs | null>(null);

  const refresh = () => {
    rpc.call("getPrefs", {}).then(setPrefs);
  };
  useEffect(() => {
    refresh();
  }, []);
  useRealtime("prefs", refresh);

  if (!prefs) return <div className="p-2 text-sm text-muted-foreground">Loading...</div>;

  const saveDefaults = (patch: Partial<Prefs["defaults"]>) => {
    void rpc.call("setPrefs", { defaults: patch }).then(setPrefs);
  };
  const saveWorkflow = (workflowType: WorkflowType, patch: WorkflowOverride) => {
    void rpc.call("setPrefs", { workflowDefaults: { [workflowType]: patch } }).then(setPrefs);
  };

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-sm font-semibold uppercase tracking-[0.24em] text-foreground">Defaults</h2>
        <p className="mt-1 text-sm text-muted-foreground">Provider, model, reasoning, and permission mode used for new tasks, per workflow type. Blank falls back to the row above.</p>
      </div>
      <div className="grid gap-3 lg:grid-cols-2">
        <label className="space-y-1 rounded-md border border-border bg-card p-3 text-sm text-foreground">
          <span className="block font-medium">Provider</span>
          <Input value={prefs.defaults.providerId ?? ""} onChange={(event) => saveDefaults({ providerId: event.currentTarget.value || null })} placeholder="e.g. anthropic" />
        </label>
        <label className="space-y-1 rounded-md border border-border bg-card p-3 text-sm text-foreground">
          <span className="block font-medium">Model</span>
          <Input value={prefs.defaults.model ?? ""} onChange={(event) => saveDefaults({ model: event.currentTarget.value || null })} placeholder="e.g. claude-sonnet-5" />
        </label>
        <label className="space-y-1 rounded-md border border-border bg-card p-3 text-sm text-foreground">
          <span className="block font-medium">Reasoning effort</span>
          <Input value={prefs.defaults.reasoningLevel ?? ""} onChange={(event) => saveDefaults({ reasoningLevel: event.currentTarget.value || null })} placeholder="e.g. high" />
        </label>
        <label className="space-y-1 rounded-md border border-border bg-card p-3 text-sm text-foreground">
          <span className="block font-medium">Research subagent model</span>
          <Input value={prefs.defaults.researchModel ?? ""} onChange={(event) => saveDefaults({ researchModel: event.currentTarget.value || null })} placeholder="e.g. claude-haiku-4-5" />
        </label>
      </div>
      <div className="space-y-2">
        <h3 className="text-xs font-semibold uppercase tracking-[0.22em] text-muted-foreground">Per workflow type</h3>
        <div className="overflow-hidden rounded-xl border border-border bg-card">
          <table className="min-w-full border-collapse text-sm">
            <thead className="border-b border-border text-left text-[11px] uppercase tracking-[0.2em] text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-medium">Workflow</th>
                <th className="px-3 py-2 font-medium">Provider</th>
                <th className="px-3 py-2 font-medium">Model</th>
                <th className="px-3 py-2 font-medium">Reasoning</th>
                <th className="px-3 py-2 font-medium">Permission</th>
              </tr>
            </thead>
            <tbody>
              {WORKFLOW_TYPE_OPTIONS.map((option) => {
                const override = prefs.workflowDefaults[option.value] ?? EMPTY_WORKFLOW_OVERRIDE;
                return (
                  <tr key={option.value} className="border-b border-border last:border-b-0">
                    <td className="px-3 py-2 font-medium text-foreground">{option.label}</td>
                    <td className="px-3 py-2">
                      <Input className="h-8" value={override.providerId ?? ""} onChange={(event) => saveWorkflow(option.value, { providerId: event.currentTarget.value || null })} />
                    </td>
                    <td className="px-3 py-2">
                      <Input className="h-8" value={override.model ?? ""} onChange={(event) => saveWorkflow(option.value, { model: event.currentTarget.value || null })} />
                    </td>
                    <td className="px-3 py-2">
                      <Input className="h-8" value={override.reasoningLevel ?? ""} onChange={(event) => saveWorkflow(option.value, { reasoningLevel: event.currentTarget.value || null })} />
                    </td>
                    <td className="px-3 py-2">
                      <ComposerToolbarSelect
                        value={override.permissionMode ?? ""}
                        onChange={(value) => saveWorkflow(option.value, { permissionMode: (value === "" ? null : value) as WorkflowOverride["permissionMode"] })}
                        options={[
                          { value: "", label: "Inherit" },
                          { value: "default", label: "Default" },
                          { value: "accept_edits", label: "Accept edits" },
                          { value: "auto", label: "Auto" },
                          { value: "bypass", label: "Bypass" },
                        ]}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

export function RpiThreadHeaderAction({ threadId }: { threadId: string; projectId: string; isCompactViewport: boolean }) {
  const rpc = useRpc<RpcContract>();
  const navigate = useBbNavigate();
  const { values: settings } = useSettings();
  const iterate = async () => {
    // showIterateConfirmation (item 8: wired, was stored-but-unread): true is bb's own default, so
    // omitted/unloaded settings keep today's confirm-first behavior.
    if (settings?.showIterateConfirmation !== false && !window.confirm("Start a fresh session from here? The current session keeps running.")) return;
    const result = await rpc.call("iterateInFreshSession", { threadId });
    navigate.toThread(result.threadId);
  };
  const [session, setSession] = useState<SessionView | null>(null);
  const [uiState, setUiState] = useState<TaskUiState>({});

  const [hasPendingLaunchAttempt, setHasPendingLaunchAttempt] = useState(false);

  const refetch = () => {
    rpc.call("getSession", { threadId }).then(({ session: next }) => {
      setSession(next);
      if (next) {
        rpc.call("getTaskUiState", { taskId: next.taskId }).then(setUiState);
        // Duplicate-launch guard for the Suggested-next button: disable it while a launch_attempt
        // for this task is still pending/uncertain/retrying, same statuses launchPhase's own
        // activeLaunchAttempt check treats as "already launching".
        rpc.call("listLaunchAttempts", { taskId: next.taskId }).then(({ attempts }) =>
          setHasPendingLaunchAttempt(attempts.some((attempt) => attempt.status === "pending" || attempt.status === "uncertain" || attempt.status === "retrying")),
        );
      }
    });
  };

  useEffect(() => {
    viewing.add(threadId);
    void rpc.call("setViewingSession", { threadId, viewing: true });
    refetch();
    return () => {
      viewing.delete(threadId);
      void rpc.call("setViewingSession", { threadId, viewing: false });
    };
  }, [threadId]);
  useRealtime("rpi:sessions", refetch);
  useRealtime("rpi:ui-state", refetch);

  // Archive-current-task hotkey (⌘E), gated on `session` so it is only live while an RPI
  // task session is the thread actually being viewed. Scoped to this component's own rendered
  // root (`actionRootRef`, set on the wrapping div below) through the same `usePanelHotkeys` owner
  // pattern T/g-t use on their own panel root, not `document`/`document.documentElement` +
  // `capture:true`, which fired regardless of what had focus ("outside the panel") and could
  // out-race any other handler on the page. Skips a combo that collides with the user's
  // configured jump hotkey so it always wins.
  const jumpHotkeyForArchive = useConfiguredJumpHotkey();
  const actionRootRef = useRef<HTMLDivElement | null>(null);
  usePanelHotkeys(actionRootRef, (event) => {
    if (!session) return;
    if (shouldHandleHotkey(event, jumpHotkeyForArchive)) return;
    if (!shouldHandleHotkey(event, "mod+e")) return;
    event.preventDefault();
    if (!window.confirm("Archive this task? Sessions stay but the task leaves the active list.")) return;
    void rpc.call("archiveTask", { taskId: session.taskId }).then(() => navigate.toPluginPanel("rpi", { subPath: "" }));
  }, [session, jumpHotkeyForArchive, rpc, navigate]);

  if (!session) return null;
  const extracted = nextStep(session);
  const suggested = suggestedNextFor(session);
  const gauge = contextGaugeText(session.contextUsage);
  const contextWarningDismissed = Boolean(uiState.contextWarningDismissed?.[threadId]);

  return (
    <div ref={actionRootRef} className="flex items-center gap-2">
      <RpiNotificationBridge />
      {settings?.showTaskPhaseLabels === false ? null : (
        <span className={pillClassName(session.label ? "step" : "ghost")}>{session.label ?? "freeform"}</span>
      )}
      <SessionStatus status={session.rpiStatus} />
      <ContextGauge usage={session.contextUsage} />
      {gauge?.warn && !contextWarningDismissed ? (
        <span className="inline-flex items-center gap-2 rounded-md border border-warning/40 bg-warning/10 px-2 py-1 text-xs text-warning">
          Context high
          <button type="button" className="font-semibold underline" onClick={iterate}>
            Iterate in fresh session
          </button>
          <button
            type="button"
            aria-label="Dismiss context warning"
            onClick={async () => setUiState(await rpc.call("dismissContextWarning", { taskId: session.taskId, threadId }))}
          >
            <Icon name="X" className="size-3" />
          </button>
        </span>
      ) : null}
      <Button
        type="button"
        variant={extracted ? "default" : "outline"}
        className="h-7 px-2 text-xs"
        disabled={!extracted}
        onClick={async () => {
          try {
            const result = await rpc.call("proceed", { threadId });
            if (result.threadId) navigate.toThread(result.threadId);
          } catch (error) {
            reportLaunchError(error);
          }
        }}
      >
        {extracted?.nextStepSummary ?? "Proceed"}
      </Button>
      {suggested ? (
        <span className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            className="h-7 px-2 text-xs"
            disabled={hasPendingLaunchAttempt}
            onClick={async () => {
              try {
                const result = await rpc.call("launchSkill", { taskId: session.taskId, skillId: suggested.skillId! });
                navigate.toThread(result.threadId);
              } catch (error) {
                reportLaunchError(error);
              }
            }}
          >
            Suggested next: {suggested.buttonText}
          </Button>
          {suggested.mismatch ? (
            <span className="text-xs text-muted-foreground">
              Agent suggested {suggested.extractedSkillId}; workflow expects {suggested.skillId}
            </span>
          ) : null}
        </span>
      ) : null}
      <Button type="button" variant="outline" className="h-7 px-2 text-xs" onClick={iterate}>
        Iterate
      </Button>
      <Button
        type="button"
        variant="outline"
        className="h-7 px-2 text-xs"
        onClick={async () => {
          const result = await rpc.call("forkSession", { threadId });
          navigate.toThread(result.threadId);
        }}
      >
        Fork
      </Button>
      <Button
        type="button"
        variant="outline"
        className="h-7 px-2 text-xs"
        onClick={() => void rpc.call("interruptSession", { threadId })}
      >
        Interrupt
      </Button>
    </div>
  );
}

function SidebarSummary({
  tasks,
  onCreateTask,
}: {
  tasks: TaskRow[];
  onCreateTask: () => void;
}) {
  const draftCount = tasks.filter((task) => task.isDraft).length;
  const taskCount = tasks.filter((task) => !task.archived).length;
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Button type="button" onClick={onCreateTask} className="h-10 px-4 text-xs uppercase tracking-[0.2em]">
          <Icon name="Plus" className="size-4" />
          Create task
          <span className="ml-1 rounded bg-background/10 px-1.5 py-0.5 text-[10px] font-semibold">T</span>
        </Button>
      </div>
      <div className="space-y-2 text-sm">
        <div className="flex items-center justify-between rounded-lg border border-border bg-card/70 px-3 py-2">
          <span className="text-muted-foreground">Drafts</span>
          <span className="font-medium text-foreground">{draftCount}</span>
        </div>
        <div className="flex items-center justify-between rounded-lg border border-border bg-card/70 px-3 py-2">
          <span className="text-muted-foreground">Tasks</span>
          <span className="font-medium text-foreground">{taskCount}</span>
        </div>
      </div>
    </div>
  );
}

export function RpiPanel({ subPath }: { subPath: string }) {
  const rpc = useRpc<RpcContract>();
  const navigate = useBbNavigate();
  const [tasks, setTasks] = useState<TaskRow[]>([]);
  const [showBoard, setShowBoard] = useState(false);
  const [view, setView] = useState<"tasks" | "drafts" | "new">("tasks");
  const [detailTaskId, setDetailTaskId] = useState<string | null>(null);
  const { projectId } = useBbContext();

  const refetch = () => {
    rpc.call("listTasks", { projectId: projectId ?? null, archived: false }).then(({ tasks: nextTasks }) => {
      setTasks(nextTasks);
    });
  };

  useEffect(() => {
    refetch();
  }, [projectId]);
  useRealtime("tasks", refetch);

  useEffect(() => {
    const artifactMatch = /^tasks\/([^/]+)\/artifacts\/(.+)$/.exec(subPath);
    if (artifactMatch) {
      setDetailTaskId(artifactMatch[1]);
      return;
    }
    const taskMatch = /^tasks\/([^/]+)$/.exec(subPath);
    if (taskMatch) {
      setDetailTaskId(taskMatch[1]);
      return;
    }
    setDetailTaskId(null);
    if (subPath === "new") {
      setView("new");
      return;
    }
    if (subPath === "drafts") {
      setView("drafts");
      return;
    }
    setView("tasks");
  }, [subPath]);
  useRealtime("rpi:sessions", refetch);

  const visibleTasks = useMemo(() => {
    if (view === "drafts") return tasks.filter((task) => task.isDraft);
    return tasks;
  }, [tasks, view]);

  const onSwitch = (next: "tasks" | "drafts" | "new") => {
    if (next === "new") {
      navigate.toPluginPanel("rpi", { subPath: "new" });
      return;
    }
    navigate.toPluginPanel("rpi", { subPath: next === "tasks" ? "" : "drafts" });
  };

  // T (new task) and the g-then-t chord (go to tasks) while this panel has focus. Scoped to this
  // panel's own root element (`panelRootRef`), never `document`, so the key is only ever seen, and
  // only ever preventDefault-ed, while focus is inside this panel; `shouldHandleHotkey`'s
  // not-in-editable guard still applies so typing in the composer textarea never triggers either
  // one. Skips a combo that collides with the user's configured jump hotkey so it always wins.
  const jumpHotkey = useConfiguredJumpHotkey();
  const panelRootRef = useRef<HTMLDivElement | null>(null);
  const awaitingTRef = useRef(false);
  const chordTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clearChordRef = useRef(() => {
    awaitingTRef.current = false;
    if (chordTimerRef.current) clearTimeout(chordTimerRef.current);
    chordTimerRef.current = null;
  });
  usePanelHotkeys(panelRootRef, (event) => {
    if (shouldHandleHotkey(event, jumpHotkey)) return;
    if (awaitingTRef.current) {
      clearChordRef.current();
      if (shouldHandleHotkey(event, "t")) {
        event.preventDefault();
        onSwitch("tasks");
      }
      return;
    }
    if (shouldHandleHotkey(event, "g")) {
      awaitingTRef.current = true;
      chordTimerRef.current = setTimeout(clearChordRef.current, 800);
      return;
    }
    if (shouldHandleHotkey(event, "t")) {
      event.preventDefault();
      onSwitch("new");
    }
  }, [jumpHotkey, navigate]);
  // Dispose the pending chord timer on unmount (task switch, panel close), same reasoning as the
  // scratch pad's debounce cleanup: an in-flight "g" wait must not leak a timer past the panel's
  // own lifetime.
  useEffect(() => clearChordRef.current, []);

  return (
    <div ref={panelRootRef} className="flex h-full min-h-0 flex-col gap-4 overflow-hidden p-4">
      <RpiNotificationBridge />
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold tracking-tight text-foreground">RPI</h1>
          <p className="text-xs text-muted-foreground">Tasks, drafts, and phase planning inside bb.</p>
        </div>
        <Button type="button" onClick={() => onSwitch("new")} className="h-10 px-4 text-xs uppercase tracking-[0.2em]">
          <Icon name="Plus" className="size-4" />
          Create task
          <span className="ml-1 rounded bg-background/10 px-1.5 py-0.5 text-[10px] font-semibold">T</span>
        </Button>
      </div>

      <div className="flex items-center gap-2 border-b border-border pb-2 text-sm font-medium uppercase tracking-[0.22em] text-muted-foreground">
        <button
          type="button"
          onClick={() => onSwitch("tasks")}
          className={cn("rounded-md px-3 py-1.5 transition", view === "tasks" && "bg-card text-foreground")}
        >
          Tasks
        </button>
        <button
          type="button"
          onClick={() => onSwitch("drafts")}
          className={cn("rounded-md px-3 py-1.5 transition", view === "drafts" && "bg-card text-foreground")}
        >
          Drafts
        </button>
        <button
          type="button"
          onClick={() => onSwitch("new")}
          className={cn("rounded-md px-3 py-1.5 transition", view === "new" && "bg-card text-foreground")}
        >
          New task
        </button>
      </div>

      <div className="grid min-h-0 flex-1 gap-4 lg:grid-cols-[220px_minmax(0,1fr)]">
        <aside className="space-y-4 overflow-hidden rounded-2xl border border-border bg-card/40 p-4">
          <SidebarSummary tasks={tasks} onCreateTask={() => onSwitch("new")} />
          <div className="space-y-2">
            <SectionTitle title="Task view" />
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setShowBoard(false)}
                className={cn("rounded-md border px-3 py-2 text-xs uppercase tracking-[0.22em]", !showBoard ? "border-foreground bg-background text-foreground" : "border-border text-muted-foreground")}
              >
                List
              </button>
              <button
                type="button"
                onClick={() => setShowBoard(true)}
                className={cn("rounded-md border px-3 py-2 text-xs uppercase tracking-[0.22em]", showBoard ? "border-foreground bg-background text-foreground" : "border-border text-muted-foreground")}
              >
                Board
              </button>
            </div>
          </div>
        </aside>

        <main className="min-h-0 overflow-auto rounded-2xl border border-border bg-background/80 p-4">
          {detailTaskId ? (
            <TaskDetailPage taskId={detailTaskId} artifactFileName={/^tasks\/[^/]+\/artifacts\/(.+)$/.exec(subPath)?.[1] ? decodeURIComponent(/^tasks\/[^/]+\/artifacts\/(.+)$/.exec(subPath)![1]!) : null} />
          ) : view === "new" ? (
            <NewTaskPage tasks={tasks} />
          ) : (
            <div className="space-y-4">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2 text-xs uppercase tracking-[0.24em] text-muted-foreground">
                  <span>{view === "drafts" ? "Drafts" : "Tasks"}</span>
                  <span className="text-border">•</span>
                  <span>{visibleTasks.length} tasks</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs uppercase tracking-[0.24em] text-muted-foreground">List</span>
                  <button
                    type="button"
                    onClick={() => setShowBoard((value) => !value)}
                    className={cn(
                      "inline-flex items-center gap-2 rounded-md border px-3 py-2 text-xs uppercase tracking-[0.24em]",
                      showBoard ? "border-foreground bg-card text-foreground" : "border-border text-muted-foreground",
                    )}
                  >
                    {showBoard ? "Board" : "List"}
                  </button>
                </div>
              </div>
              <TaskListView tasks={visibleTasks} boardMode={showBoard} />
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
