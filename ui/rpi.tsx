import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { DragEvent, FormEvent, KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent, ReactNode, RefObject } from "react";
import {
  Markdown,
  experimental_SourceCode as SourceCode,
  experimental_useSidebarThreadActions,
  experimental_useSidebarThreads,
  useBbContext,
  useBbNavigate,
  useComposerView,
  useRealtime,
  useRpc,
  useSettings,
} from "@get-bb/plugin-sdk/app";
import type { PluginSidebarThread, PluginThreadListProps } from "@get-bb/plugin-sdk/app";
import { toast } from "sonner";
import type {
  ArtifactRecord,
  ArtifactVersionRecord,
  ContextWarningRule,
  LaunchAttemptRecord,
  ListModelsOutput,
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
import { modelDisplay, modelOptionValue, parseModelOptionValue } from "../models";
import { AUTO_ADVANCE, BOARD_COLUMNS, FIRST_SKILL_BY_WORKFLOW, SKILL_BY_ID, WORKFLOW_GRAPH_LABELS, WORKFLOW_GRAPHS, shouldShowComposerBanner, suggestedNextForSession, type SuggestedNext } from "../transitions";
import { ARTIFACT_COMMENTS_WIDTH_RANGE, ARTIFACT_LIST_WIDTH_RANGE, ARTIFACT_PANEL_STACK_BREAKPOINT, artifactLayoutMode, clampWidth } from "../artifact-layout";
import {
  PHASE_DESCRIPTIONS,
  SUPERSEDED,
  attentionQueue,
  attentionText,
  effectiveStatus,
  labelStep,
  needsHuman,
  nextStepSummary,
  phaseProgress,
  plural,
  statusMeta,
  type PhaseProgressEntry,
  type StatusTone,
} from "../status";
import { markdownBlocks } from "../blocks";
import { ScratchPadSync } from "../scratch-pad-sync";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Icon, type IconName } from "@/components/ui/icon";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { COARSE_POINTER_CHILD_ICON_BUTTON_CLASS, COARSE_POINTER_COMPACT_ICON_SIZE_CLASS } from "@/components/ui/coarse-pointer-sizing";
import { cn } from "@/lib/utils";

// Launch RPCs (launchDraft, launchSkill, proceed, resolveLaunchAttempt retry) can reject with a
// LaunchRejectedError (launch.ts), e.g. code `no_source_host` when a task has no project source
// and no host. Show its message instead of failing silently.
const LAUNCH_ERROR_MESSAGES: Record<string, string> = {
  session_running: "That session is still running. Wait for it to finish.",
  pending_interaction: "The session is waiting for a response. Resolve it before advancing.",
  task_archived: "This task is archived.",
  missing_completed_turn: "The session has not completed a turn yet.",
  stale_extraction: "The session is still processing. Try again in a moment.",
  invalid_next_step: "No next step was found. The session may need a manual message.",
  human_gate: "This transition requires your approval.",
  launch_blocked: "A launch is already in progress for this task.",
  no_source_host: "No host available. Set a project source or pick a host for this task.",
};

function reportLaunchError(error: unknown) {
  if (error instanceof Error && "code" in error) {
    const msg = LAUNCH_ERROR_MESSAGES[(error as { code: string }).code];
    if (msg) { toast.error(msg); return; }
  }
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
      <h2 className="text-sm font-semibold text-foreground">
        {title}
      </h2>
      {count === undefined ? null : (
        <span className="text-xs text-muted-foreground">{count}</span>
      )}
    </div>
  );
}

// Text-only coloring for icon glyphs that render a status without a pill (thread list, minimap).
const TONE_TEXT_CLASS: Record<StatusTone, string> = {
  success: "text-success",
  warning: "text-warning",
  danger: "text-destructive",
  attention: "text-attention",
  muted: "text-muted-foreground",
  active: "text-success motion-safe:animate-pulse",
};

const TONE_PILL_CLASS: Record<StatusTone, string> = {
  success: "bg-success/10 text-success",
  warning: "bg-warning/10 text-warning",
  danger: "bg-destructive/10 text-destructive",
  attention: "bg-attention/15 text-attention",
  muted: "bg-muted text-muted-foreground",
  active: "bg-success/10 text-success motion-safe:animate-pulse",
};

// Row shading only for a session that needs a retry (failed) or is actively working (active); a
// session merely waiting on the human (attention) is the normal state and gets no tint
// (PRODUCT.md #2: red is reserved for failure).
const ROW_SHADE_CLASS: Partial<Record<StatusTone, string>> = {
  danger: "bg-destructive/5 ring-1 ring-destructive/20",
  active: "bg-background/70 shadow-sm ring-1 ring-border/60",
};

// Hint tooltips are the panel's teaching layer (PRODUCT.md #5), so a hint trigger is always a real
// focusable button: keyboard users reach it, and a tap toggles it open on phones (the remote
// shell), where Radix never opens a tooltip on touch. The click stops at the trigger so a hint
// inside a clickable row never opens the row.
function HintTrigger({ hint, className, children }: { hint: ReactNode; className?: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <Tooltip open={open} onOpenChange={setOpen}>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            setOpen((value) => !value);
          }}
          className={cn("relative z-10 inline-flex min-w-0 max-w-full cursor-default appearance-none rounded text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring", className)}
        >
          {children}
        </button>
      </TooltipTrigger>
      <TooltipContent>{hint}</TooltipContent>
    </Tooltip>
  );
}

// The one keyboard-reachable control of a clickable row (a task or session name). The row itself
// keeps a pointer onClick for mouse convenience but carries no role or tabIndex, so the
// accessible tree sees a plain table row holding one link-like button, never a link wrapping
// nested controls. Other controls in the row stop propagation so they do not also open the row.
function RowLink({ onOpen, hint, className, children }: { onOpen: () => void; hint?: ReactNode; className?: string; children: ReactNode }) {
  const link = (
    <button
      type="button"
      onClick={(event) => {
        event.stopPropagation();
        onOpen();
      }}
      className={cn("min-w-0 max-w-full rounded text-left font-medium text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring", className)}
    >
      {children}
    </button>
  );
  if (!hint) return link;
  return (
    <Tooltip>
      <TooltipTrigger asChild>{link}</TooltipTrigger>
      <TooltipContent>{hint}</TooltipContent>
    </Tooltip>
  );
}

function stopRowClick(event: ReactMouseEvent) {
  event.stopPropagation();
}

// Row surface shared by every clickable task/session row: one hover token the host guarantees to
// differ from the surface in every theme (`--state-hover`), unlike `bg-card/70` over `bg-card`,
// which is invisible where card equals background.
const CLICKABLE_ROW_CLASS = "cursor-pointer hover:bg-state-hover";

// Arrow-key roving for one horizontal group of tabs or radios (APG tabs and radiogroup patterns):
// Left/Right wrap, Home/End jump, and moving focus also activates, so a single Tab stop reaches
// the group and arrows choose within it. Attach to the container; the selected item is the only
// one with tabIndex 0.
function rovingKeyDown(event: ReactKeyboardEvent<HTMLElement>) {
  const items = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('[role="tab"],[role="radio"]'));
  const index = items.indexOf(document.activeElement as HTMLElement);
  if (index === -1) return;
  let next: number;
  if (event.key === "ArrowRight" || event.key === "ArrowDown") next = (index + 1) % items.length;
  else if (event.key === "ArrowLeft" || event.key === "ArrowUp") next = (index - 1 + items.length) % items.length;
  else if (event.key === "Home") next = 0;
  else if (event.key === "End") next = items.length - 1;
  else return;
  event.preventDefault();
  items[next]!.focus();
  items[next]!.click();
}

const TAB_CLASS = "shrink-0 whitespace-nowrap rounded px-3 py-1.5 text-sm font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
function tabClass(selected: boolean) {
  return cn(TAB_CLASS, selected ? "bg-state-active text-foreground" : "text-muted-foreground hover:text-foreground");
}

// Two-to-three way segmented control (List/Board, Preview/Raw): a radiogroup with the selected
// segment exposed through aria-checked, not just a border color, and arrow keys to switch.
function Segmented<T extends string>({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: T;
  onChange: (next: T) => void;
  options: ReadonlyArray<{ value: T; label: string }>;
}) {
  return (
    <div role="radiogroup" aria-label={label} onKeyDown={rovingKeyDown} className="flex shrink-0 gap-0.5 rounded-md border border-border p-0.5">
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={selected}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(option.value)}
            className={cn(
              "h-7 rounded px-2.5 text-xs font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              selected ? "bg-state-active text-foreground" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

// Archive-with-confirmation, shared by the sidebar's row menu and the failed-session Dismiss
// action: one pending id and one dialog per owner, and the archive itself is bb's own
// (experimental_useSidebarThreadActions), so children and open panes are handled by the host.
function useArchiveThread(copy: { title: string; description: string; confirmLabel: string }) {
  const threadActions = experimental_useSidebarThreadActions();
  const [pendingThreadId, setPendingThreadId] = useState<string | null>(null);
  const dialog = (
    <ConfirmDialog
      open={pendingThreadId !== null}
      onOpenChange={(open) => setPendingThreadId(open ? pendingThreadId : null)}
      title={copy.title}
      description={copy.description}
      confirmLabel={copy.confirmLabel}
      onConfirm={() => {
        if (pendingThreadId) threadActions.archive(pendingThreadId);
      }}
    />
  );
  return { request: setPendingThreadId, dialog };
}

const DISMISS_SESSION_COPY = {
  title: "Dismiss this session?",
  description: "Archives its thread in bb and removes it from the task. The task's artifacts stay; you can start a fresh session on the same phase any time.",
  confirmLabel: "Dismiss",
};

// Recovery for a failed or lost session, rendered where the session is surfaced (needs-you band
// and sessions table) so the copy "start fresh or dismiss" always has the controls it names.
// Start fresh launches a new session on the same phase (iterateInFreshSession, the RPC Iterate
// already uses); the newer session supersedes this one, so it leaves the inbox by itself.
// Dismiss archives the thread; listSessions drops archived-thread sessions.
function SessionRecoveryActions({ threadId, onDismiss, className }: { threadId: string; onDismiss: (threadId: string) => void; className?: string }) {
  const rpc = useRpc<RpcContract>();
  const navigate = useBbNavigate();
  const [busy, setBusy] = useState(false);
  const startFresh = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const result = await rpc.call("iterateInFreshSession", { threadId });
      navigate.toThread(result.threadId);
    } catch (error) {
      reportLaunchError(error);
    } finally {
      setBusy(false);
    }
  };
  return (
    <span className={cn("relative z-10 flex shrink-0 items-center gap-1", className)} onClick={stopRowClick}>
      <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => void startFresh()}>
        <Icon name={busy ? "Spinner" : "RotateCcw"} className="size-3.5" />
        Start fresh
      </Button>
      <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={() => onDismiss(threadId)}>
        Dismiss
      </Button>
    </span>
  );
}

function StatusPill({ tone, label, icon, hint }: { tone: StatusTone; label: string; icon: IconName; hint?: string }) {
  const pill = (
    <span className={cn("inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium", TONE_PILL_CLASS[tone])}>
      <Icon name={icon} className={COARSE_POINTER_COMPACT_ICON_SIZE_CLASS} />
      {label}
    </span>
  );
  if (!hint) return pill;
  return <HintTrigger hint={hint} className="rounded-full">{pill}</HintTrigger>;
}

function SessionStatus({ status }: { status: string }) {
  const meta = statusMeta(status);
  return <StatusPill tone={meta.tone} label={meta.text} icon={meta.icon} hint={meta.hint || undefined} />;
}

// Replaces pillClassName's three-variant badge (draft/step/ghost) with one filled/outline
// distinction: draft and ghost were always muted variants of the same visual idea as a status
// pill, so they collapse into the same non-emphasis style.
function LabelPill({ label, emphasis = false }: { label: string; emphasis?: boolean }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium",
        emphasis ? "border border-border bg-card text-foreground" : TONE_PILL_CLASS.muted,
      )}
    >
      {label}
    </span>
  );
}

function TaskStepPill({ task }: { task: TaskRow }) {
  return <LabelPill label={task.stepLabel} emphasis={!task.isDraft} />;
}

// Warning threshold (plan §2.8, now resolved per session): `contextThresholdFor` in
// context-threshold.ts, from prefs.contextWarning plus the session's providerId/model, exposed as
// SessionView.contextWarnThreshold.
function contextGaugeText(usage: SessionView["contextUsage"], threshold: number) {
  if (!usage) return null;
  const percent = Math.round(usage.percent * 100);
  return {
    percent,
    warn: usage.percent >= threshold,
    title: `${usage.usedTokens.toLocaleString()} / ${usage.modelContextWindow.toLocaleString()} tokens${usage.estimated ? " (estimated)" : ""}, warn at ${Math.round(threshold * 100)}%`,
  };
}

function ContextGauge({ usage, threshold }: { usage: SessionView["contextUsage"]; threshold: number }) {
  const meta = contextGaugeText(usage, threshold);
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

// Shared session-state fetch (session row, per-task UI state, pending-launch-attempt guard) for
// the thread-header cluster and the composer banner (phase 10 header/composer split): both need
// the same three RPC round trips and the same two realtime channels, so the fetch lives here once
// instead of being duplicated in each component. `threadId` is null for composer scopes that are
// not a thread (queued-message, side-chat, new-thread), in which case this resolves to "no RPI
// session" without calling the server.
function useRpiSessionState(threadId: string | null) {
  const rpc = useRpc<RpcContract>();
  const [session, setSession] = useState<SessionView | null>(null);
  const [uiState, setUiState] = useState<TaskUiState>({});
  const [hasPendingLaunchAttempt, setHasPendingLaunchAttempt] = useState(false);

  const refetch = () => {
    if (!threadId) {
      setSession(null);
      setUiState({});
      setHasPendingLaunchAttempt(false);
      return;
    }
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
      } else {
        setUiState({});
        setHasPendingLaunchAttempt(false);
      }
    });
  };

  useEffect(() => {
    refetch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [threadId]);
  useRealtime("rpi:sessions", refetch);
  useRealtime("rpi:ui-state", refetch);

  return { session, uiState, setUiState, hasPendingLaunchAttempt, refetch };
}

// Attention count chip: a small filled badge, not a bare dot, so "N sessions need you" reads at a
// glance without borrowing danger's red (PRODUCT.md #2).
function AttentionCountChip({ n }: { n: number }) {
  return (
    <span className={cn("inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-xs font-semibold", TONE_PILL_CLASS.attention)}>
      <span aria-hidden>{n}</span>
      <span className="sr-only">{plural(n, "session")} {n === 1 ? "needs" : "need"} you</span>
    </span>
  );
}

// Mini phase strip for a task table row: same phaseProgress derivation the task detail page's
// WorkflowStrip uses, without per-session sessions data (a task row does not fetch its sessions).
function PhaseStripMini({ task }: { task: TaskRow }) {
  const steps = useMemo(
    () => phaseProgress({ workflowType: task.workflowType, worktreeTiming: task.worktreeTiming, currentLabel: task.currentLabel, sessions: [] }),
    [task.workflowType, task.worktreeTiming, task.currentLabel],
  );
  const currentIndex = steps.findIndex((step) => step.state === "current");
  return (
    <div className="flex items-center gap-2">
      <div className="flex items-center gap-0.5">
        {steps.map((step, index) => (
          <span
            key={`${step.step}-${index}`}
            className={cn(
              "h-1 w-3 rounded-[2px]",
              step.state === "done"
                ? "bg-muted-foreground/50"
                : step.state === "current"
                  ? task.attentionCount > 0 ? "bg-attention" : "bg-success"
                  : "bg-border",
            )}
          />
        ))}
      </div>
      <div className="flex flex-col">
        <span className="text-sm text-foreground">{task.stepLabel}</span>
        {currentIndex >= 0 ? (
          <span className="text-xs text-muted-foreground">{currentIndex + 1} of {steps.length}</span>
        ) : null}
      </div>
    </div>
  );
}

// >= 1100px fits four board columns, >= 760px fits two, otherwise one; measured from the panel's
// own width (useElementWidth), not a viewport breakpoint, so a narrow split panel never gets
// columns squeezed to nothing.
function boardColumnsClass(width: number): string {
  if (width >= 1100) return "grid-cols-4";
  if (width >= 760) return "grid-cols-2";
  return "grid-cols-1";
}

function TaskCompactRow({ task, onOpen }: { task: TaskRow; onOpen: () => void }) {
  return (
    <div onClick={onOpen} className={cn("flex flex-col gap-1.5 border-b border-border px-4 py-3 last:border-b-0", CLICKABLE_ROW_CLASS)}>
      <div className="flex items-center justify-between gap-2">
        <RowLink onOpen={onOpen} className="truncate">{task.name}</RowLink>
        <span className="shrink-0 text-xs text-muted-foreground">{plural(task.sessionCount, "session")} · {relativeTime(task.updatedAt)}</span>
      </div>
      <div className="flex items-center justify-between gap-2">
        {task.isDraft ? <LabelPill label="Draft" /> : <PhaseStripMini task={task} />}
        {task.attentionCount > 0 ? <AttentionCountChip n={task.attentionCount} /> : null}
      </div>
    </div>
  );
}

function TaskTable({ tasks, compact }: { tasks: TaskRow[]; compact: boolean }) {
  const navigate = useBbNavigate();
  const open = (taskId: string) => navigate.toPluginPanel("rpi", { subPath: `tasks/${taskId}` });

  if (compact) {
    return (
      <div className="overflow-hidden rounded-xl border border-border bg-card">
        {tasks.map((task) => <TaskCompactRow key={task.id} task={task} onOpen={() => open(task.id)} />)}
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card">
      <table className="min-w-full border-collapse text-sm">
        <thead className="border-b border-border text-left text-[11px] uppercase tracking-[0.2em] text-muted-foreground">
          <tr>
            <th className="px-4 py-3 font-medium">Task</th>
            <th className="px-4 py-3 font-medium">Phase</th>
            <th className="px-4 py-3 font-medium">Needs you</th>
            <th className="px-4 py-3 font-medium">Sessions</th>
            <th className="px-4 py-3 font-medium">Updated</th>
          </tr>
        </thead>
        <tbody>
          {tasks.map((task) => (
            <tr key={task.id} onClick={() => open(task.id)} className={cn("border-b border-border last:border-b-0", CLICKABLE_ROW_CLASS)}>
              <td className="px-4 py-3">
                <div className="flex flex-col items-start gap-1">
                  <RowLink onOpen={() => open(task.id)}>{task.name}</RowLink>
                  <span className="font-mono text-xs text-muted-foreground">{task.slug}</span>
                </div>
              </td>
              <td className="px-4 py-3">
                {task.isDraft ? <LabelPill label="Draft" /> : <PhaseStripMini task={task} />}
              </td>
              <td className="px-4 py-3">
                {task.attentionCount > 0 ? <AttentionCountChip n={task.attentionCount} /> : <span className="text-xs text-muted-foreground">0</span>}
              </td>
              <td className="px-4 py-3 text-muted-foreground">{task.sessionCount}</td>
              <td className="px-4 py-3 text-muted-foreground">{relativeTime(task.updatedAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function TaskBoard({ tasks, width }: { tasks: TaskRow[]; width: number }) {
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
    <div className={cn("grid gap-3", boardColumnsClass(width))}>
      {columns.map((column) => (
        <section key={column.id} className="min-h-[240px] rounded-xl border border-border bg-card/60 p-3">
          <div className="mb-3 flex items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-foreground">
              {column.title}
            </h3>
            <span className="text-xs text-muted-foreground">{groups[column.id].length}</span>
          </div>
          <div className="space-y-2">
            {groups[column.id].map((task) => {
              const open = () => navigate.toPluginPanel("rpi", { subPath: `tasks/${task.id}` });
              return (
              <article key={task.id} onClick={open} className="cursor-pointer rounded-lg border border-border bg-background/70 p-3 transition hover:border-foreground/40">
                <div className="space-y-2">
                  <div className="flex items-start justify-between gap-3">
                    <h4 className="min-w-0 leading-tight"><RowLink onOpen={open}>{task.name}</RowLink></h4>
                    <span className="inline-flex items-center gap-2 text-xs text-muted-foreground">
                      {relativeTime(task.updatedAt)}
                    </span>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {task.isDraft ? <LabelPill label="Draft" /> : <TaskStepPill task={task} />}
                    <span className="text-xs text-muted-foreground">{plural(task.sessionCount, "session")}</span>
                    {task.attentionCount > 0 ? <AttentionCountChip n={task.attentionCount} /> : null}
                  </div>
                </div>
              </article>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}

function TaskListView({
  tasks,
  boardMode,
  compact,
  boardWidth,
}: {
  tasks: TaskRow[];
  boardMode: boolean;
  compact: boolean;
  boardWidth: number;
}) {
  return boardMode ? <TaskBoard tasks={tasks} width={boardWidth} /> : <TaskTable tasks={tasks} compact={compact} />;
}

function ComposerToolbarSelect({
  value,
  onChange,
  options,
  className,
  id,
  describedBy,
}: {
  value: string;
  onChange: (next: string) => void;
  options: Array<{ value: string; label: string; description?: string }>;
  className?: string;
  id?: string;
  describedBy?: string;
}) {
  return (
    <select
      id={id}
      aria-describedby={describedBy}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      className={cn("h-10 min-w-0 rounded-md border border-border bg-card px-3 text-sm text-foreground outline-none transition focus:border-foreground", className)}
    >
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
}

// Page-lifetime cache of the model catalog, keyed by hostId ("" for "no host chosen yet"), so the
// New task form, a task's Settings tab, and the composer banner's model popover share one
// listModels fetch instead of each re-fetching bb's provider catalog. Never invalidated; a stale
// entry only matters if a provider is installed/removed mid-session, and a full page reload (or a
// hostId change, which is a fresh cache key) already covers that.
const modelCatalogCache = new Map<string, Promise<ListModelsOutput>>();
const FAILED_MODEL_CATALOG: ListModelsOutput = { providers: [], models: [], error: { code: "failed", providerId: "" } };

function fetchModelCatalog(rpc: ReturnType<typeof useRpc<RpcContract>>, hostId: string | null): Promise<ListModelsOutput> {
  const key = hostId ?? "";
  let cached = modelCatalogCache.get(key);
  if (!cached) {
    cached = rpc.call("listModels", { hostId: hostId ?? null }).catch(() => FAILED_MODEL_CATALOG);
    modelCatalogCache.set(key, cached);
  }
  return cached;
}

type ModelSelectValue = { providerId: string | null; model: string | null; reasoningLevel: string | null };

// Shared model + reasoning-effort picker fed by bb's own provider catalog (listModels), used by
// the New task form, a task's Settings tab, the composer banner's model popover, and the defaults
// settings page, so "which models exist" is answered in exactly one place per PRODUCT.md #3.
function ModelSelect({
  hostId,
  value,
  onChange,
  allowDefault = true,
  defaultOptionLabel = "Default (from settings)",
  size = "md",
  label,
}: {
  hostId: string | null;
  value: ModelSelectValue;
  onChange: (next: ModelSelectValue) => void;
  allowDefault?: boolean;
  defaultOptionLabel?: string;
  size?: "md" | "sm";
  label: string;
}) {
  const rpc = useRpc<RpcContract>();
  const [catalog, setCatalog] = useState<ListModelsOutput | null>(null);
  const selectId = useId();
  const reasoningId = useId();

  useEffect(() => {
    let cancelled = false;
    setCatalog(null);
    fetchModelCatalog(rpc, hostId).then((result) => {
      if (!cancelled) setCatalog(result);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hostId]);

  const selectClass = cn(
    "w-full rounded-md border border-border bg-background px-2 text-sm text-foreground",
    size === "sm" ? "h-8" : "h-9",
  );

  if (!catalog) {
    return (
      <div className="space-y-1">
        <label htmlFor={selectId} className="block text-xs text-muted-foreground">{label}</label>
        <select id={selectId} disabled className={selectClass}>
          <option>Loading models...</option>
        </select>
      </div>
    );
  }

  if (catalog.error && catalog.models.length === 0) {
    return (
      <div className="space-y-1">
        <label className="block text-xs text-muted-foreground">{label}</label>
        <p className="text-xs text-muted-foreground">Could not load models from bb ({catalog.error.code})</p>
      </div>
    );
  }

  // researchModel (RpiDefaultsSettings) has no providerId of its own; when the caller passes one
  // in with providerId null, match by model id alone so a saved bare model string still shows as
  // known instead of falling into the "not available" branch below.
  const selectedModel = value.model
    ? (catalog.models.find((entry) => entry.providerId === value.providerId && entry.model === value.model) ??
      (value.providerId === null ? catalog.models.find((entry) => entry.model === value.model) : undefined) ??
      null)
    : null;
  const knownValue = value.providerId === null && value.model === null ? true : selectedModel !== null;
  const selectValue = selectedModel ? modelOptionValue(selectedModel.providerId, selectedModel.model) : modelOptionValue(value.providerId, value.model);

  return (
    <div className="space-y-1">
      <label htmlFor={selectId} className="block text-xs text-muted-foreground">{label}</label>
      <select
        id={selectId}
        value={knownValue ? selectValue : "__unavailable"}
        onChange={(event) => {
          const parsed = parseModelOptionValue(event.target.value);
          onChange({ providerId: parsed.providerId, model: parsed.model, reasoningLevel: null });
        }}
        className={selectClass}
      >
        {allowDefault ? <option value="">{defaultOptionLabel}</option> : null}
        {!knownValue ? (
          <option value="__unavailable" disabled>
            {`${modelOptionValue(value.providerId, value.model) || `${value.providerId ?? ""}/${value.model ?? ""}`} (not available)`}
          </option>
        ) : null}
        {catalog.providers.map((provider) => {
          const providerModels = catalog.models.filter((entry) => entry.providerId === provider.id);
          if (providerModels.length === 0) return null;
          return (
            <optgroup key={provider.id} label={provider.displayName}>
              {providerModels.map((entry) => (
                <option key={`${entry.providerId}/${entry.model}`} value={modelOptionValue(entry.providerId, entry.model)}>
                  {entry.displayName}{entry.isDefault ? " (default)" : ""}
                </option>
              ))}
            </optgroup>
          );
        })}
      </select>
      {selectedModel && selectedModel.reasoningEfforts.length > 0 ? (
        <select
          id={reasoningId}
          aria-label={`${label} reasoning effort`}
          value={value.reasoningLevel ?? ""}
          onChange={(event) => onChange({ ...value, reasoningLevel: event.target.value || null })}
          className={selectClass}
        >
          <option value="">Default</option>
          {selectedModel.reasoningEfforts.map((effort) => (
            <option key={effort} value={effort}>{capitalize(effort)}</option>
          ))}
        </select>
      ) : null}
    </div>
  );
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
  const [providerId, setProviderId] = useState<string | null>(null);
  const [model, setModel] = useState<string | null>(null);
  const [reasoningLevel, setReasoningLevel] = useState<string | null>(null);
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
          providerId,
          model,
          reasoningLevel,
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
          providerId,
          model,
          reasoningLevel,
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

  const firstSkillId = FIRST_SKILL_BY_WORKFLOW[workflowType];
  const firstPhaseLabel = firstSkillId ? labelStep(SKILL_BY_ID[firstSkillId].label) : null;
  const primaryLabel = firstPhaseLabel ? `Create and start ${firstPhaseLabel}` : "Create";
  const workflowSteps = WORKFLOW_GRAPHS[workflowType];
  // Helper copy is linked with aria-describedby rather than nested in the <label>, so a control's
  // name is "Worktree", not "Worktree Research and planning run in...".
  const hintId = useId();
  const worktreeHintId = `${hintId}-worktree`;
  const workflowHintId = `${hintId}-workflow`;
  const autoAdvanceHintId = `${hintId}-auto-advance`;

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-lg font-semibold text-foreground">New task</h1>
        <p className="text-sm text-muted-foreground">Describe the task, then choose where and how it runs.</p>
      </div>

      <form onSubmit={createDraft} className="space-y-4">
        <div className="space-y-4 rounded-2xl border border-border bg-card/70 p-4 shadow-sm">
          <textarea
            value={text}
            onChange={(event) => setText(event.target.value)}
            placeholder="Describe the task..."
            aria-label="Task description"
            className="min-h-[220px] w-full resize-y rounded-xl border border-border bg-background/80 p-4 text-base leading-7 text-foreground outline-none placeholder:text-muted-foreground focus:border-foreground"
          />
          <label className="block max-w-[320px] space-y-1 text-xs text-muted-foreground">
            <span className="block">Task name</span>
            <Input
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Task name"
              className="h-10"
            />
          </label>

          <div className="grid gap-4 lg:grid-cols-2">
            <div className="space-y-3 rounded-xl border border-border bg-card p-3">
              <h2 className="text-sm font-semibold text-foreground">Where</h2>
              <label className="block space-y-1 text-xs text-muted-foreground">
                <span className="block">Project</span>
                <ComposerToolbarSelect
                  className="w-full"
                  value={projectId}
                  onChange={setProjectId}
                  options={projectOptions.map((project) => ({ value: project.id, label: project.name }))}
                />
              </label>
              <label className="block space-y-1 text-xs text-muted-foreground">
                <span className="block">Machine</span>
                <ComposerToolbarSelect
                  className="w-full"
                  value={hostId}
                  onChange={setHostId}
                  options={hostOptions.map((host) => ({ value: host.id, label: host.name }))}
                />
              </label>
              <div className="space-y-1 text-xs text-muted-foreground">
                <label htmlFor={`${hintId}-worktree-select`} className="block">Worktree</label>
                <ComposerToolbarSelect
                  id={`${hintId}-worktree-select`}
                  describedBy={worktreeHintId}
                  className="w-full"
                  value={worktreeTiming}
                  onChange={(value) => setWorktreeTiming(value as "now" | "later" | "never")}
                  options={[
                    { value: "now", label: "From the start" },
                    { value: "later", label: "After planning" },
                    { value: "never", label: "No worktree" },
                  ]}
                />
                <span id={worktreeHintId} className="block text-muted-foreground">Research and planning run in the main checkout; implementation gets its own branch.</span>
              </div>
              <label className="block space-y-1 text-xs text-muted-foreground">
                <span className="block">Working directory</span>
                <Input
                  value={defaultDirectory}
                  onChange={(event) => setDefaultDirectory(event.target.value)}
                  placeholder="Default: repo root"
                  className="h-9"
                />
              </label>
            </div>

            <div className="space-y-3 rounded-xl border border-border bg-card p-3">
              <h2 className="text-sm font-semibold text-foreground">How</h2>
              <div className="space-y-1 text-xs text-muted-foreground">
                <label htmlFor={`${hintId}-workflow-select`} className="block">Workflow</label>
                <ComposerToolbarSelect
                  id={`${hintId}-workflow-select`}
                  describedBy={workflowHintId}
                  className="w-full"
                  value={workflowType}
                  onChange={(value) => setWorkflowType(value as "rpi" | "outline_only" | "prd_tdd" | "oneshot" | "freeform")}
                  options={(Object.keys(WORKFLOW_GRAPH_LABELS) as WorkflowType[]).map((key) => ({
                    value: key,
                    label: `${WORKFLOW_GRAPH_LABELS[key]} (${plural(WORKFLOW_GRAPHS[key].length, "step")})`,
                  }))}
                />
                <span id={workflowHintId} className="block text-muted-foreground">{workflowSteps.join(" \u2192 ")}</span>
              </div>
              <label className="block space-y-1 text-xs text-muted-foreground">
                <span className="block">Permissions</span>
                <ComposerToolbarSelect
                  className="w-full"
                  value={permissionMode}
                  onChange={(value) => setPermissionMode(value as "default" | "accept_edits" | "auto" | "bypass")}
                  options={[
                    { value: "default", label: "Default" },
                    { value: "accept_edits", label: "Accept edits" },
                    { value: "auto", label: "Auto" },
                    { value: "bypass", label: "Bypass" },
                  ]}
                />
              </label>
              <div className="space-y-1 text-xs text-muted-foreground">
                <label className="flex w-fit cursor-pointer items-center gap-2 py-1 text-sm font-medium text-foreground">
                  <Checkbox checked={autoAdvance} onCheckedChange={(checked) => setAutoAdvance(checked === true)} aria-describedby={autoAdvanceHintId} />
                  Auto-advance
                </label>
                <span id={autoAdvanceHintId} className="block">Phases chain automatically; you approve before implementation and before the PR.</span>
              </div>
              <ModelSelect
                hostId={hostId || null}
                value={{ providerId, model, reasoningLevel }}
                onChange={(next) => {
                  setProviderId(next.providerId);
                  setModel(next.model);
                  setReasoningLevel(next.reasoningLevel);
                }}
                allowDefault
                label="Model"
              />
              <span className="block text-xs text-muted-foreground">Applies to every session of this task. You can change it later in the task's Settings tab.</span>
            </div>
          </div>

          <div className="flex items-center justify-end gap-2">
            <button
              type="submit"
              disabled={busy || text.trim() === "" || projectId === ""}
              className="inline-flex h-10 items-center gap-2 rounded-md border border-border bg-card px-4 text-sm font-semibold text-foreground transition hover:border-foreground/40 disabled:cursor-not-allowed disabled:text-muted-foreground disabled:opacity-60"
            >
              <Icon name="EditFile" className="size-4" />
              Save as draft
            </button>
            <button
              type="button"
              onClick={createAndLaunch}
              disabled={busy || text.trim() === "" || projectId === ""}
              title={primaryLabel}
              className="inline-flex h-10 items-center gap-2 rounded-md bg-foreground px-4 text-sm font-semibold text-background transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Icon name="Play" className="size-4" />
              {primaryLabel}
            </button>
          </div>
        </div>
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
                onClick={() => navigate.toPluginPanel("rpi", { subPath: `tasks/${task.id}` })}
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
        <LabelPill label={isPending ? "launching..." : attempt.status} />
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
                  <LabelPill label={candidate.strong ? "strong" : "weak"} emphasis={candidate.strong} />
                </button>
              ))}
            </div>
          ) : null}
          <div className="flex flex-wrap items-center gap-2">
            <Input value={threadId} onChange={(event) => setThreadId(event.target.value)} placeholder="Thread id to adopt" aria-label="Thread id to adopt" className="h-9 max-w-[220px]" />
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

function truncateForBanner(text: string): string {
  return text.length > 22 ? `${text.slice(0, 22)}…` : text;
}

function capitalize(text: string): string {
  return text.length === 0 ? text : text[0]!.toUpperCase() + text.slice(1);
}

// Attempt N (1-based, oldest first) among sessions of the task sharing the same non-null label;
// `total` is the group size, so callers only show ", attempt N" when there was more than one.
function attemptOrdinals(sessions: SessionView[]): Map<string, { ordinal: number; total: number }> {
  const byLabel = new Map<string, SessionView[]>();
  for (const session of sessions) {
    if (session.label === null) continue;
    const list = byLabel.get(session.label) ?? [];
    list.push(session);
    byLabel.set(session.label, list);
  }
  const ordinals = new Map<string, { ordinal: number; total: number }>();
  for (const list of byLabel.values()) {
    const ordered = [...list].sort((a, b) => a.createdAt - b.createdAt);
    ordered.forEach((session, index) => ordinals.set(session.threadId, { ordinal: index + 1, total: ordered.length }));
  }
  return ordinals;
}

function startedAgoText(createdAt: number): string {
  const rt = relativeTime(createdAt);
  return rt === "now" ? "just started" : `started ${rt} ago`;
}

// Live finding (D.0.4): the previous version always rendered "forked from attempt {ordinal of
// forkedFrom within ITS OWN label group}", which reads as a self-reference ("attempt 1 forked from
// attempt 1") whenever the source session belongs to a different labelStep than the fork, since
// attempt numbering is only meaningful within one label group. Only show an attempt number when
// the fork source shares this session's labelStep; otherwise name its phase; otherwise (no
// resolvable source) fall back to "started ... ago".
function forkSubLine(session: SessionView, allSessions: SessionView[], ordinals: Map<string, { ordinal: number; total: number }>): string {
  const forkedFrom = session.forkedFromThreadId ? allSessions.find((other) => other.threadId === session.forkedFromThreadId) : undefined;
  if (!forkedFrom || forkedFrom.threadId === session.threadId) return startedAgoText(session.createdAt);
  const sourceStep = labelStep(forkedFrom.label);
  if (sourceStep !== null && sourceStep === labelStep(session.label)) {
    return `forked from attempt ${ordinals.get(forkedFrom.threadId)?.ordinal ?? 1}`;
  }
  return `forked from ${sourceStep ?? "session"}`;
}

// "What it wants" cell: needsHuman statuses reuse attentionText verbatim; a superseded session
// says what it handed off (its own next-step extraction, if any); running/interrupted get a short
// present-tense line; anything else (launching, resuming, interrupt_requested) falls back to
// statusMeta's hint.
function sessionWhatItWants(session: SessionView, effective: string): string {
  if (needsHuman(effective)) return attentionText(session);
  if (effective === SUPERSEDED) {
    const summary = nextStepSummary(session.nextStepJson);
    return summary ? `Handed off: ${summary}` : "Finished";
  }
  if (effective === "running") return "Working";
  if (effective === "interrupted") return "Stopped by you";
  return statusMeta(effective).hint;
}

function sessionRowOrder(a: { effective: string; session: SessionView }, b: { effective: string; session: SessionView }): number {
  const rank = (effective: string) => (needsHuman(effective) ? 0 : 1);
  const rankDiff = rank(a.effective) - rank(b.effective);
  if (rankDiff !== 0) return rankDiff;
  const aTime = a.session.threadUpdatedAt ?? a.session.updatedAt;
  const bTime = b.session.threadUpdatedAt ?? b.session.updatedAt;
  return bTime - aTime;
}

// `sessions` is the (possibly phase-filtered) rows to render; `allSessions` is every session of
// the task, unfiltered, since effectiveStatus/attemptOrdinals/forkedFrom lookups all need the
// task's whole history, not just the visible slice.
function SessionsTable({
  sessions,
  allSessions,
  task,
  compact,
}: {
  sessions: SessionView[];
  allSessions: SessionView[];
  task: TaskRecord;
  compact: boolean;
}) {
  const navigate = useBbNavigate();
  const open = (threadId: string) => navigate.toThread(threadId);
  const archive = useArchiveThread(DISMISS_SESSION_COPY);
  const ordinals = useMemo(() => attemptOrdinals(allSessions), [allSessions]);
  const rows = useMemo(
    () =>
      sessions
        .map((session) => ({ session, effective: effectiveStatus(session, allSessions, task) }))
        .sort(sessionRowOrder),
    [sessions, allSessions, task],
  );
  const isDanger = (effective: string) => effective === "failed" || effective === "lost";

  if (compact) {
    return (
      <div className="space-y-2">
        {rows.map(({ session, effective }) => {
          const meta = statusMeta(effective);
          const ordinal = ordinals.get(session.threadId);
          const attemptSuffix = ordinal && ordinal.total > 1 ? `, attempt ${ordinal.ordinal}` : "";
          const subLine = forkSubLine(session, allSessions, ordinals);
          return (
            <div
              key={session.threadId}
              onClick={() => open(session.threadId)}
              className={cn("space-y-1.5 rounded-lg border border-border bg-card p-3", CLICKABLE_ROW_CLASS, isDanger(effective) && ROW_SHADE_CLASS.danger)}
            >
              <div className="flex items-center justify-between gap-2">
                <StatusPill tone={meta.tone} label={meta.text} icon={meta.icon} hint={meta.hint || undefined} />
                <RowLink onOpen={() => open(session.threadId)} className="truncate text-sm">{capitalize(labelStep(session.label) ?? "Session")}{attemptSuffix}</RowLink>
              </div>
              <div className="text-xs text-muted-foreground">{subLine}</div>
              <div className="text-sm text-foreground">{sessionWhatItWants(session, effective)}</div>
              <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                <ContextGauge usage={session.contextUsage} threshold={session.contextWarnThreshold} />
                <span>{relativeTime(session.threadUpdatedAt ?? session.updatedAt)}</span>
              </div>
              {isDanger(effective) ? <SessionRecoveryActions threadId={session.threadId} onDismiss={archive.request} className="pt-1" /> : null}
            </div>
          );
        })}
        {archive.dialog}
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card">
      <table className="min-w-full border-collapse text-sm">
        <thead className="border-b border-border text-left text-[11px] uppercase tracking-[0.2em] text-muted-foreground">
          <tr>
            <th className="w-[130px] px-4 py-3 font-medium">Status</th>
            <th className="px-4 py-3 font-medium">Session</th>
            <th className="px-4 py-3 font-medium">What it wants</th>
            <th className="px-4 py-3 font-medium">Context</th>
            <th className="px-4 py-3 font-medium">Updated</th>
            <th className="px-4 py-3 font-medium" aria-hidden="true" />
          </tr>
        </thead>
        <tbody>
          {rows.map(({ session, effective }) => {
            const meta = statusMeta(effective);
            const ordinal = ordinals.get(session.threadId);
            const attemptSuffix = ordinal && ordinal.total > 1 ? `, attempt ${ordinal.ordinal}` : "";
            const subLine = forkSubLine(session, allSessions, ordinals);
            return (
              <tr
                key={session.threadId}
                onClick={() => open(session.threadId)}
                className={cn("border-b border-border last:border-b-0", CLICKABLE_ROW_CLASS, isDanger(effective) && ROW_SHADE_CLASS.danger)}
              >
                <td className="w-[130px] px-4 py-3"><StatusPill tone={meta.tone} label={meta.text} icon={meta.icon} hint={meta.hint || undefined} /></td>
                <td className="px-4 py-3">
                  <div className="flex flex-col items-start gap-0.5">
                    <RowLink onOpen={() => open(session.threadId)} hint={session.workingDirectory ?? "Working directory unknown"} className="truncate">
                      {capitalize(labelStep(session.label) ?? "Session")}{attemptSuffix}
                    </RowLink>
                    <span className="text-xs text-muted-foreground">{subLine}</span>
                  </div>
                </td>
                <td className="max-w-[360px] truncate px-4 py-3 text-muted-foreground">{sessionWhatItWants(session, effective)}</td>
                <td className="px-4 py-3"><ContextGauge usage={session.contextUsage} threshold={session.contextWarnThreshold} /></td>
                <td className="px-4 py-3 text-muted-foreground">{relativeTime(session.threadUpdatedAt ?? session.updatedAt)}</td>
                <td className="px-4 py-3">
                  {isDanger(effective) ? (
                    <SessionRecoveryActions threadId={session.threadId} onDismiss={archive.request} className="justify-end" />
                  ) : (
                    // Visual affordance only: the row (pointer) and the session name (keyboard) are
                    // the controls, so this is a styled span, not a second button.
                    <Button asChild variant="outline" size="sm" className="pointer-events-none" aria-hidden>
                      <span>Open</span>
                    </Button>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {archive.dialog}
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

// Task detail Settings tab's "Model" section: changing it here patches the task record (same
// providerId/model/reasoningLevel launch.ts's optionalExecution copies onto threads.spawn), so it
// applies to every session launched from now on. A running session already has its own execution
// options resolved and keeps them; this only changes what the next launch uses.
function TaskModelPanel({ task, onUpdated }: { task: TaskRecord; onUpdated: () => void }) {
  const rpc = useRpc<RpcContract>();
  const [catalog, setCatalog] = useState<ListModelsOutput | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchModelCatalog(rpc, task.hostId).then((result) => {
      if (!cancelled) setCatalog(result);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [task.hostId]);

  const save = async (next: ModelSelectValue) => {
    await rpc.call("updateTask", { taskId: task.id, patch: { providerId: next.providerId, model: next.model, reasoningLevel: next.reasoningLevel } });
    toast.success("Model updated for the next sessions");
    onUpdated();
  };

  return (
    <div className="max-w-sm space-y-2">
      <ModelSelect
        hostId={task.hostId}
        value={{ providerId: task.providerId, model: task.model, reasoningLevel: task.reasoningLevel }}
        onChange={(next) => void save(next)}
        allowDefault
        label="Model"
      />
      <p className="text-xs text-muted-foreground">
        Current: {catalog ? modelDisplay(catalog, task.providerId, task.model) : "..."} · used by every session launched from now on; running sessions keep theirs.
      </p>
    </div>
  );
}

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

// `variant="panel"` (default) is the standalone thread-side-panel look (RpiTipsThreadPanel);
// `variant="inline"` is the task detail page's compact dismissible row under the phase strip.
// Only presentation differs; the tips-per-phase list, dismissed state, and showPhaseTips setting
// are the same fetch and the same "Hide tips"/"Don't show again" action either way.
function TipsPanel({ taskId, label, variant = "panel" }: { taskId: string; label: string | null | undefined; variant?: "inline" | "panel" }) {
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

  const dismiss = async () => {
    const next = await rpc.call("dismissTaskTip", { taskId, label: tipKey });
    setState(next);
  };

  if (variant === "inline") {
    if (hidden) return null;
    return (
      <div className="flex items-start justify-between gap-3 rounded-md border border-border bg-primary/5 px-3 py-2 text-xs text-muted-foreground">
        <div className="flex items-start gap-2">
          <Icon name="Info" className="mt-0.5 size-3.5 shrink-0 text-primary" />
          <span>{tips.join(" ")}</span>
        </div>
        <Button type="button" variant="ghost" className="h-6 shrink-0 px-2 text-xs" onClick={dismiss}>
          Hide tips
        </Button>
      </div>
    );
  }

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
        <Button type="button" variant="outline" className="h-8" onClick={dismiss}>
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
        <div className="mb-2 text-sm font-semibold text-foreground">Requested vs resolved</div>
        <div className="grid gap-2 text-sm lg:grid-cols-2">
          <div><span className="text-muted-foreground">Path requested </span><span className="text-foreground">{workspace.pathTemplate.requested ?? "default"}</span></div>
          <div><span className="text-muted-foreground">Path resolved </span><span className="text-foreground">{workspace.pathTemplate.resolved ?? "pending"}</span></div>
          <div><span className="text-muted-foreground">Branch requested </span><span className="text-foreground">{workspace.branchTemplate.requested ?? workspace.sourceRef ?? "default"}</span></div>
          <div><span className="text-muted-foreground">Branch resolved </span><span className="text-foreground">{workspace.branchTemplate.resolved ?? "pending"}</span></div>
        </div>
      </div>
      <div className="overflow-hidden rounded-md border border-border bg-card">
        <table className="min-w-full border-collapse text-sm">
          <thead className="border-b border-border text-left text-[11px] uppercase tracking-[0.2em] text-muted-foreground">
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
      <div className="text-xs text-muted-foreground">{label}</div>
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
        aria-label="Scratch pad notes"
        className="min-h-[360px] w-full resize-y rounded-md border border-border bg-card p-3 text-sm text-foreground outline-none focus:border-foreground"
      />
    </div>
  );
}

function MinimapPanel({ taskId }: { taskId: string }) {
  const rpc = useRpc<RpcContract>();
  const navigate = useBbNavigate();
  const [sessions, setSessions] = useState<SessionView[]>([]);
  const [worktreeTiming, setWorktreeTiming] = useState<"now" | "later" | "never">("later");

  const refetch = () => {
    rpc.call("listSessions", { taskId }).then(({ sessions: next }) => setSessions(next));
  };
  useEffect(() => {
    refetch();
    rpc.call("getTask", { taskId }).then(({ task }) => {
      if (task) setWorktreeTiming(task.worktreeTiming);
    });
  }, [taskId]);
  useRealtime("rpi:sessions", refetch);

  const ordered = useMemo(() => [...sessions].sort((a, b) => a.createdAt - b.createdAt), [sessions]);
  if (ordered.length === 0) return <div className="p-4 text-sm text-muted-foreground">No sessions yet.</div>;
  return (
    <div className="space-y-2">
      <h3 className="text-sm font-semibold text-foreground">Minimap</h3>
      <div className="flex flex-wrap gap-2">
        {ordered.map((session, index) => {
          // A settled session (ready_for_input/failed/lost/interrupted) whose phase already moved on
          // shows the same muted "done" glyph the sessions table uses, not its stale waiting color.
          const effective = effectiveStatus(session, sessions, { workflowType: session.workflowType, worktreeTiming });
          const meta = statusMeta(effective);
          return (
            <button
              key={session.threadId}
              type="button"
              onClick={() => navigate.toThread(session.threadId)}
              title={session.title ?? session.threadId}
              className="inline-flex items-center gap-2 rounded-md border border-border bg-card px-3 py-2 text-xs transition hover:border-foreground/40"
            >
              <span className="text-muted-foreground">{index + 1}</span>
              <Icon name={meta.icon} className={cn("size-3.5", TONE_TEXT_CLASS[meta.tone])} />
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

// Sentence-case rail group labels, keyed the same as ARTIFACT_GROUP_ORDER/artifacts.ts's
// ARTIFACT_TYPE_ORDER.
const ARTIFACT_GROUP_LABELS: Record<(typeof ARTIFACT_GROUP_ORDER)[number], string> = {
  "research-questions": "Research questions",
  research: "Research",
  "design-discussion": "Design discussion",
  prd: "PRD",
  tdd: "TDD",
  "structure-outline": "Structure outline",
  plan: "Plan",
  "pr-description": "PR description",
  other: "Task files",
};

// Mirrors artifacts.ts's middleEllipsis (kept as a small duplicate, not an import: artifacts.ts
// pulls in node:crypto/better-sqlite3 for its write path, so it is backend-only and never bundled
// into this frontend file, the same reason ARTIFACT_GROUP_ORDER above duplicates artifacts.ts's
// ARTIFACT_TYPE_ORDER instead of importing it).
function middleEllipsis(name: string, max: number): string {
  if (name.length <= max) return name;
  const head = name.slice(0, Math.max(0, max - 12));
  const tail = name.slice(name.length - 11);
  return `${head}\u2026${tail}`;
}

function ArtifactIcon({ artifact }: { artifact: ArtifactRecord }) {
  const isImage = artifact.contentType.startsWith("image/");
  const isText = artifact.contentType.startsWith("text/");
  const name: IconName = isImage ? "Eye" : isText ? "FileText" : "Code";
  return <Icon name={name} className={cn("size-4", isImage || isText ? "text-foreground" : "text-muted-foreground")} />;
}

function ArtifactRow({
  artifact,
  selected,
  onSelect,
  onDelete,
  onRestore,
  nameMaxLength,
}: {
  artifact: ArtifactRecord;
  selected: boolean;
  onSelect: () => void;
  onDelete: () => void;
  onRestore: () => void;
  nameMaxLength: number;
}) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const path = `/plugins/rpi/tasks/${encodeURIComponent(artifact.taskId)}/artifacts/${encodeURIComponent(artifact.fileName)}`;
  return (
    <div className={cn("flex items-center gap-2 rounded-md border px-3 py-2", selected ? "border-foreground/50 bg-card" : "border-transparent hover:bg-card/70")}>
      {/* The button is the tooltip trigger (focusable) and carries the full name; the visible
          text is the middle-ellipsized form, so keyboard and screen-reader users get the whole name. */}
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            onClick={onSelect}
            aria-label={`${artifact.fileName}${artifact.isDeleted ? " (deleted)" : ""}`}
            className="flex min-w-0 flex-1 items-center gap-2 rounded text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <ArtifactIcon artifact={artifact} />
            <span className={cn("text-sm font-medium", artifact.isDeleted ? "text-muted-foreground line-through" : "text-foreground")}>
              {middleEllipsis(artifact.fileName, nameMaxLength)}
            </span>
          </button>
        </TooltipTrigger>
        <TooltipContent>{artifact.fileName}</TooltipContent>
      </Tooltip>
      {artifact.commentCount > 0 ? <span className="shrink-0 text-xs text-muted-foreground">{artifact.commentCount}</span> : null}
      <Popover>
        <PopoverTrigger asChild>
          <button type="button" aria-label="Artifact actions" className={cn("flex items-center justify-center rounded-md border border-border text-muted-foreground hover:text-foreground", COARSE_POINTER_CHILD_ICON_BUTTON_CLASS)}>
            <Icon name="MoreHorizontal" className="size-4" />
          </button>
        </PopoverTrigger>
        <PopoverContent className="w-36 p-1">
          <button type="button" onClick={onSelect} className="block w-full rounded px-2 py-1.5 text-left text-sm text-foreground hover:bg-muted">Open</button>
          <button type="button" onClick={() => void navigator.clipboard?.writeText(path)} className="block w-full rounded px-2 py-1.5 text-left text-sm text-foreground hover:bg-muted">Copy path</button>
          {artifact.isDeleted ? (
            <button type="button" onClick={onRestore} className="block w-full rounded px-2 py-1.5 text-left text-sm text-foreground hover:bg-muted">Restore</button>
          ) : (
            <button type="button" onClick={() => setConfirmDelete(true)} className="block w-full rounded px-2 py-1.5 text-left text-sm text-foreground hover:bg-muted">Delete</button>
          )}
        </PopoverContent>
      </Popover>
      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title={`Delete ${artifact.fileName}?`}
        description="It can be restored from this menu until the task is archived."
        confirmLabel="Delete"
        onConfirm={onDelete}
      />
    </div>
  );
}

// Shared destructive-confirmation dialog (phase 2 swap-in for window.confirm): gets the mobile
// bottom-sheet behavior of components/ui/dialog.tsx for free at every call site that uses it.
function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  confirmLabel: string;
  onConfirm: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button type="button" variant="destructive" onClick={() => { onOpenChange(false); onConfirm(); }}>{confirmLabel}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// Panel-width-driven layout for the Artifacts panel (phase 10 header/composer split, part B):
// measures the panel's own rendered width instead of reading a Tailwind `lg:` viewport breakpoint,
// so a wide window with a narrow side panel does not get the desktop three-column layout squeezed
// into ~150px. `useLayoutEffect` (not `useEffect`) measures before first paint so there is no
// one-frame flash at the wrong width.
//
// Callback-ref pattern (live finding, D.0.1): a plain `useRef` object never changes identity, so
// `useLayoutEffect(..., [ref])` only ever runs once, against whatever `ref.current` was at that
// first commit. A component that renders a "Loading..." branch before its real root (e.g.
// TaskDetailPage) mounts with `ref.current === null` on that first commit, and the effect then
// never re-runs once the real root mounts later, so width stays 0 forever and every
// width-driven `compact` branch downstream never engages. Returning a state setter as the ref
// callback instead means React calls it every time the underlying DOM node actually changes
// (including null -> real node), so the observer effect (keyed on that node) always re-runs.
function useElementWidth(): [width: number, ref: (node: HTMLElement | null) => void] {
  const [node, setNode] = useState<HTMLElement | null>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    if (!node) return;
    setWidth(node.getBoundingClientRect().width);
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) setWidth(entry.contentRect.width);
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, [node]);
  return [width, setNode];
}

function readPersistedWidth(key: string, fallback: number, range: { min: number; max: number }) {
  if (typeof window === "undefined") return fallback;
  const parsed = Number.parseInt(window.localStorage.getItem(key) ?? "", 10);
  return Number.isFinite(parsed) ? clampWidth(parsed, range) : fallback;
}

// Draggable-divider width, persisted to localStorage (no generic `task_ui_state` key path exists
// for this; see docs/phases/10-header-composer.md). `drag` updates in-memory state only (many
// calls per pointermove); `commit`/`step` also persist, matching the pointerup-persists,
// keyboard-steps-and-persists contract SplitHandle drives this with.
function usePersistedWidth(key: string, fallback: number, range: { min: number; max: number }) {
  const [width, setWidth] = useState(() => readPersistedWidth(key, fallback, range));
  const apply = (delta: number, persist: boolean) => {
    setWidth((current) => {
      const next = clampWidth(current + delta, range);
      if (persist && typeof window !== "undefined") window.localStorage.setItem(key, String(next));
      return next;
    });
  };
  return {
    width,
    range,
    drag: (delta: number) => apply(delta, false),
    step: (delta: number) => apply(delta, true),
    commit: () => apply(0, true),
  };
}

function readPersistedSet(key: string): Set<string> | null {
  if (typeof window === "undefined") return null;
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(key) ?? "");
    return Array.isArray(parsed) ? new Set(parsed.filter((item): item is string => typeof item === "string")) : null;
  } catch {
    return null;
  }
}

// A set of ids persisted to localStorage as a JSON array, same read-once-then-persist-on-change
// shape as usePersistedWidth above. Backs the Artifacts rail's collapsed-group state
// (`rpi:artifacts:collapsed:<taskId>`, one such set per task): membership means "collapsed", so
// the default (nothing saved yet) is every group expanded. `key` changing (a different task)
// re-reads localStorage for the new key, since this hook's owner does not remount across tasks.
function usePersistedSet(key: string) {
  const [value, setValue] = useState<Set<string>>(() => readPersistedSet(key) ?? new Set());
  useEffect(() => {
    setValue(readPersistedSet(key) ?? new Set());
  }, [key]);
  const persist = (next: Set<string>) => {
    if (typeof window !== "undefined") window.localStorage.setItem(key, JSON.stringify([...next]));
    return next;
  };
  return {
    has: (id: string) => value.has(id),
    toggle: (id: string) => setValue((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return persist(next);
    }),
    expand: (id: string) => setValue((current) => {
      if (!current.has(id)) return current;
      const next = new Set(current);
      next.delete(id);
      return persist(next);
    }),
  };
}

// Draggable divider: plain pointer events (no drag-and-drop API) on a 14px hit area drawing a 6px
// `cursor-col-resize` bar. `onDrag` runs during the pointer move (in-memory only); `onCommit`
// persists once on pointerup, or immediately after each keyboard step. Keyboard: a focusable
// `role="separator"` is a widget, so it exposes the width it controls through aria-value*; arrow
// keys move 16px per press.
function SplitHandle({
  ariaLabel,
  width,
  onDrag,
  onStep,
  onCommit,
}: {
  ariaLabel: string;
  width: { width: number; range: { min: number; max: number } };
  onDrag: (deltaPx: number) => void;
  onStep: (deltaPx: number) => void;
  onCommit: () => void;
}) {
  const draggingRef = useRef<{ lastX: number } | null>(null);
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={ariaLabel}
      aria-valuenow={Math.round(width.width)}
      aria-valuemin={width.range.min}
      aria-valuemax={width.range.max}
      aria-valuetext={`${Math.round(width.width)} pixels`}
      tabIndex={0}
      className="group -mx-1 flex w-3.5 shrink-0 cursor-col-resize touch-none justify-center focus-visible:outline-none"
      onPointerDown={(event) => {
        event.currentTarget.setPointerCapture(event.pointerId);
        draggingRef.current = { lastX: event.clientX };
      }}
      onPointerMove={(event) => {
        const dragging = draggingRef.current;
        if (!dragging) return;
        onDrag(event.clientX - dragging.lastX);
        dragging.lastX = event.clientX;
      }}
      onPointerUp={(event) => {
        if (!draggingRef.current) return;
        draggingRef.current = null;
        event.currentTarget.releasePointerCapture(event.pointerId);
        onCommit();
      }}
      onKeyDown={(event) => {
        if (event.key === "ArrowLeft") onStep(-16);
        else if (event.key === "ArrowRight") onStep(16);
        else return;
        event.preventDefault();
      }}
    >
      <span aria-hidden className="h-full w-1.5 rounded bg-transparent group-hover:bg-border group-focus-visible:bg-ring" />
    </div>
  );
}

// createdBy is either the literal "ui"/"cli" senders or a session threadId; resolves it to
// something a human reads as an author ("you", "cli", a session's title, or the raw value as a
// last resort for a session no longer in `sessions`).
function versionAuthor(createdBy: string, sessions: SessionView[]): string {
  if (createdBy === "ui") return "you";
  if (createdBy === "cli") return "cli";
  const session = sessions.find((candidate) => candidate.threadId === createdBy);
  return session ? session.title ?? createdBy : createdBy;
}

function versionTimeLabel(createdAt: number): string {
  const date = new Date(createdAt);
  const time = date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  return date.toDateString() === new Date().toDateString() ? time : `${date.toLocaleDateString()} ${time}`;
}

// Default send target for a fresh artifact/version: the session that wrote the version being
// viewed if it is still live, else the newest live session, else the newest session of any kind.
function defaultSendThreadId(sessions: SessionView[], task: TaskRecord, versionCreatedBy: string | null | undefined): string {
  const notSuperseded = sessions.filter((session) => effectiveStatus(session, sessions, task) !== SUPERSEDED);
  const author = versionCreatedBy ? notSuperseded.find((session) => session.threadId === versionCreatedBy) : undefined;
  if (author) return author.threadId;
  const newestLive = [...notSuperseded].sort((a, b) => b.createdAt - a.createdAt)[0];
  if (newestLive) return newestLive.threadId;
  const newest = [...sessions].sort((a, b) => b.createdAt - a.createdAt)[0];
  return newest?.threadId ?? "";
}

function ArtifactViewer({ taskId, fileName, task, panelWidth }: { taskId: string; fileName: string; task: TaskRecord; panelWidth: number }) {
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
  const [viewerWidth, setViewerRoot] = useElementWidth();
  const layoutMode = artifactLayoutMode(panelWidth, viewerWidth);
  const commentsWidth = usePersistedWidth("rpi.artifacts.split.comments", 320, ARTIFACT_COMMENTS_WIDTH_RANGE);

  useEffect(() => {
    setVersion(null);
    setPinnedVersion(null);
    setCommentThreads([]);
    setCommentsNextOffset(null);
    setComposingBlock(null);
    setSendThreadId("");
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
      const defaultThreadId = defaultSendThreadId(sessionResult.sessions, task, artifactResult.version?.createdBy ?? null);
      if (defaultThreadId) setSendThreadId((current) => current || defaultThreadId);
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
  }, [fileName, taskId, pinnedVersion, rpc, showResolved, task]);
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

  const gutterKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    if (event.target instanceof HTMLTextAreaElement) return;
    const gutters = Array.from(event.currentTarget.querySelectorAll<HTMLElement>("[data-gutter]"));
    if (gutters.length === 0) return;
    const current = gutters.indexOf(document.activeElement as HTMLElement);
    const next = event.key === "ArrowDown" ? Math.min(current + 1, gutters.length - 1) : Math.max(current - 1, 0);
    event.preventDefault();
    gutters[next]!.focus();
    gutters[next]!.scrollIntoView({ block: "nearest" });
  };

  const previewNode = (
    <>
      {mode === "preview" && isRasterPreview(artifact.contentType) && url ? (
        <img src={url} alt={artifact.fileName} className="max-h-full max-w-full rounded-md" />
      ) : mode === "preview" && isSandboxedPreview(artifact.contentType) && content !== null ? (
        <iframe title={artifact.fileName} sandbox="" srcDoc={content} className="h-full min-h-[240px] w-full rounded-md border-0 bg-background" />
      ) : mode === "preview" && !isBinary && content !== null ? (
        // One Tab stop for the whole document: the gutter buttons are tabIndex -1 and reached with
        // ArrowUp/ArrowDown from the container (or from each other), Enter comments on that line,
        // so a 300-line plan is not 300 stops on the way to the comments rail.
        <div
          role="group"
          tabIndex={0}
          aria-label={`${artifact.fileName}. Press down arrow to move between lines, Enter to comment on one.`}
          onKeyDown={gutterKeyDown}
          className="space-y-0.5 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {blocks.map((block) => (
            <div key={block.index} className="group grid grid-cols-[28px_minmax(0,1fr)] gap-2 rounded-md border border-transparent hover:border-border focus-within:border-border">
              <button
                type="button"
                tabIndex={-1}
                data-gutter
                aria-label={`Add comment on line ${block.index + 1}`}
                onClick={() => {
                  setComposingBlock(block.index);
                  setComposerText("");
                }}
                className="mt-1.5 flex size-7 items-center justify-center rounded-md border border-border text-muted-foreground opacity-0 transition hover:text-foreground focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring group-hover:opacity-100 pointer-coarse:size-9 pointer-coarse:opacity-100"
              >
                <Icon name="Plus" className="size-4" />
              </button>
              <div className="min-w-0">
                {block.code ? (
                  <pre className="whitespace-pre-wrap font-mono text-xs text-foreground">{content!.slice(block.start, block.end).replace(/\n$/, "")}</pre>
                ) : (
                  <Markdown content={block.text} />
                )}
                {composingBlock === block.index ? (
                  <div className="mb-2 space-y-2 rounded-md border border-border bg-card p-2">
                    <textarea
                      value={composerText}
                      onChange={(event) => setComposerText(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Escape") setComposingBlock(null);
                      }}
                      autoFocus
                      aria-label={`Comment on line ${block.index + 1}`}
                      className="min-h-20 w-full rounded-md border border-border bg-background p-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    />
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
    </>
  );

  const commentRailNode = (
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
  );

  return (
    <div
      ref={setViewerRoot}
      className={cn("flex min-h-0 flex-1 flex-col gap-3 rounded-md border border-border bg-card p-3", layoutMode !== "split-rail" && "overflow-auto")}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <h3 className="flex min-w-0 text-sm font-semibold text-foreground">
            <HintTrigger hint={artifact.fileName}><span className="block truncate">{artifact.fileName}</span></HintTrigger>
          </h3>
          <div className="text-xs text-muted-foreground">
            v{version ?? artifact.currentVersion} · written by {versionMeta ? versionAuthor(versionMeta.createdBy, sessions) : "?"}
            {versionMeta ? ` · ${versionTimeLabel(versionMeta.createdAt)}` : ""}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <select value={version ?? artifact.currentVersion} onChange={(event) => setPinnedVersion(Number.parseInt(event.target.value, 10))} aria-label="Version" className="h-8 rounded-md border border-border bg-background px-2 text-xs text-foreground">
            {versions.map((item) => (
              <option key={item.id} value={item.version}>v{item.version} · {versionAuthor(item.createdBy, sessions)}</option>
            ))}
          </select>
          <Segmented label="View" value={mode} onChange={setMode} options={[{ value: "preview", label: "Preview" }, { value: "raw", label: "Raw" }]} />
        </div>
      </div>
      {artifact.isDeleted ? (
        <div className="rounded-md border border-border bg-muted px-3 py-2 text-sm text-muted-foreground">
          This artifact is deleted. Restore it from its row menu in the list.
        </div>
      ) : null}
      {layoutMode === "split-rail" ? (
        <div className="flex min-h-[260px] flex-1 gap-0 overflow-hidden">
          <div className="min-h-0 min-w-0 flex-1 overflow-auto rounded-md border border-border bg-background p-3">{previewNode}</div>
          <SplitHandle
            ariaLabel="Resize comments rail"
            width={commentsWidth}
            onDrag={(delta) => commentsWidth.drag(-delta)}
            onStep={(delta) => commentsWidth.step(-delta)}
            onCommit={commentsWidth.commit}
          />
          <div style={{ width: commentsWidth.width }} className="min-h-0 min-w-0 shrink-0">{commentRailNode}</div>
        </div>
      ) : (
        <>
          <div className="rounded-md border border-border bg-background p-3">{previewNode}</div>
          <div className="rounded-md border border-border">
            <div className="flex items-baseline gap-2 px-3 py-2 text-xs font-semibold text-muted-foreground">
              <span className="text-foreground">Comments</span>
              <span>{commentThreads.length}</span>
            </div>
            <div className="p-3 pt-0">{commentRailNode}</div>
          </div>
        </>
      )}
    </div>
  );
}

// "Design" for a labeled phase session, else the session's own title truncated to 24 chars: the
// send button and its confirming toast both name the target this way.
function shortSessionTitle(session: SessionView): string {
  const step = labelStep(session.label);
  if (step) return capitalize(step);
  const title = session.title ?? session.threadId;
  return title.length > 24 ? `${title.slice(0, 24)}\u2026` : title;
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
  const sendTarget = sessions.find((session) => session.threadId === sendThreadId);
  const sendTargetTitle = sendTarget ? shortSessionTitle(sendTarget) : "session";
  const sendLabel = unresolvedIds.length > sendIds.length
    ? `${sending ? "Sending" : "Send"} first ${sendIds.length} of ${plural(unresolvedIds.length, "comment")} to ${sendTargetTitle}`
    : `${sending ? "Sending" : "Send"} ${plural(sendIds.length, "comment")} to ${sendTargetTitle}`;

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
      toast.success(`Sent ${plural(sendIds.length, "comment")} to ${sendTargetTitle}`);
    } finally {
      setSending(false);
    }
  };

  return (
    <aside className="min-w-0 rounded-md border border-border bg-background p-3">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h4 className="text-sm font-semibold text-foreground">Comments</h4>
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          <input type="checkbox" checked={showResolved} onChange={(event) => setShowResolved(event.target.checked)} />
          Show resolved
        </label>
      </div>
      <div className="mb-3 space-y-2 rounded-md border border-border bg-card p-2">
        <select value={sendThreadId} onChange={(event) => setSendThreadId(event.target.value)} aria-label="Send to session" className="h-8 w-full rounded-md border border-border bg-background px-2 text-xs text-foreground">
          {sessions.map((session) => <option key={session.threadId} value={session.threadId}>{session.title ?? session.threadId}</option>)}
        </select>
        <select value={sendMode} onChange={(event) => setSendMode(event.target.value as "send" | "send-and-resolve")} aria-label="After sending" className="h-8 w-full rounded-md border border-border bg-background px-2 text-xs text-foreground">
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
            <div className="text-xs font-medium text-muted-foreground">Unanchored</div>
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
  const [confirmDelete, setConfirmDelete] = useState(false);
  const root = thread.root;
  const deleteComment = async () => {
    await update(rpc.call("deleteComment", { artifactId, commentIds: [root.id] }));
    toast.success("Comment deleted");
  };
  return (
    <article className="space-y-2 rounded-md border border-border bg-card p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-xs font-medium text-foreground">{root.createdByAgent ? "Agent" : "You"} <span className="text-muted-foreground">{relativeTime(root.createdAt)}</span></div>
          <div className="text-xs text-muted-foreground">{root.anchor?.orphaned ? "unanchored" : `line ${(root.anchor?.blockIndex ?? 0) + 1}`}</div>
        </div>
        <button type="button" className="text-xs text-muted-foreground hover:text-foreground" onClick={() => void update(rpc.call("resolveComments", { artifactId, commentIds: [root.id], resolved: !root.isResolved }))}>
          {root.isResolved ? "Unresolve" : "Resolve"}
        </button>
      </div>
      {editing ? (
        <div className="space-y-2">
          <textarea value={editText} onChange={(event) => setEditText(event.target.value)} aria-label="Edit comment" className="min-h-20 w-full rounded-md border border-border bg-background p-2 text-sm text-foreground" />
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
        <button type="button" className="text-muted-foreground hover:text-foreground" onClick={() => setConfirmDelete(true)}>Delete</button>
      </div>
      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title="Delete this comment?"
        description="Also deletes any replies."
        confirmLabel="Delete"
        onConfirm={() => void deleteComment()}
      />
      {thread.replies.map((item) => (
        <div key={item.id} className="rounded-md border border-border bg-background p-2">
          <div className="text-xs font-medium text-foreground">{item.createdByAgent ? "Agent" : "You"} <span className="text-muted-foreground">{relativeTime(item.createdAt)}</span></div>
          <p className="whitespace-pre-wrap text-sm text-foreground">{item.contentText}</p>
        </div>
      ))}
      {reply ? (
        <div className="space-y-2">
          <textarea value={reply.trimStart()} onChange={(event) => setReply(event.target.value)} aria-label="Reply" className="min-h-16 w-full rounded-md border border-border bg-background p-2 text-sm text-foreground" />
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
  const [task, setTask] = useState<TaskRecord | null>(null);
  const [selected, setSelected] = useState<string | null>(initialFileName ?? null);
  const [busy, setBusy] = useState(false);
  const [panelWidth, setPanelRoot] = useElementWidth();
  // Forced stacked below the breakpoint regardless of viewer width; see artifact-layout.ts.
  const stacked = panelWidth > 0 && panelWidth < ARTIFACT_PANEL_STACK_BREAKPOINT;
  const listWidth = usePersistedWidth("rpi.artifacts.split.list", 300, ARTIFACT_LIST_WIDTH_RANGE);
  const collapsedGroups = usePersistedSet(`rpi:artifacts:collapsed:${taskId}`);

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
    rpc.call("getTask", { taskId }).then(({ task: next }) => setTask(next));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [taskId, initialFileName]);
  useRealtime("artifacts", refetch);
  useRealtime("rpi:artifacts", refetch);

  const liveArtifacts = useMemo(() => artifacts.filter((artifact) => !artifact.isDeleted), [artifacts]);
  const deletedArtifacts = useMemo(() => artifacts.filter((artifact) => artifact.isDeleted), [artifacts]);
  const groups = useMemo(() => ARTIFACT_GROUP_ORDER.map((group) => ({
    group,
    artifacts: liveArtifacts.filter((artifact) => artifact.groupType === group),
  })).filter((group) => group.artifacts.length > 0), [liveArtifacts]);

  // A deep-linked or freshly-loaded selection always becomes visible, even if the user (or a
  // previous visit to this task) left its group collapsed.
  useEffect(() => {
    if (!selected) return;
    const artifact = artifacts.find((item) => item.fileName === selected);
    if (artifact) collapsedGroups.expand(artifact.groupType);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, artifacts]);

  const mutate = async (action: "deleteArtifact" | "restoreArtifact", fileName: string) => {
    await rpc.call(action, { taskId, fileName });
    refetch();
    toast.success(action === "deleteArtifact" ? `Deleted ${fileName}` : `Restored ${fileName}`);
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
      nameMaxLength={stacked ? 30 : 40}
    />
  ));

  const groupHeader = (group: { group: (typeof ARTIFACT_GROUP_ORDER)[number]; artifacts: ArtifactRecord[] }) => {
    const collapsed = collapsedGroups.has(group.group);
    const openComments = group.artifacts.reduce((sum, artifact) => sum + artifact.commentCount, 0);
    return (
      <button
        type="button"
        aria-expanded={!collapsed}
        onClick={() => collapsedGroups.toggle(group.group)}
        className="flex w-full items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground"
      >
        <Icon name={collapsed ? "ChevronRight" : "ChevronDown"} className="size-3.5 shrink-0" />
        <span className="flex-1 truncate text-left">{ARTIFACT_GROUP_LABELS[group.group]}</span>
        <span>{group.artifacts.length}</span>
        {openComments > 0 ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <span className={cn("inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-xs font-semibold", TONE_PILL_CLASS.attention)}>
                <span aria-hidden>{openComments}</span>
                <span className="sr-only">, {plural(openComments, "open comment")}</span>
              </span>
            </TooltipTrigger>
            <TooltipContent>{plural(openComments, "open comment")}</TooltipContent>
          </Tooltip>
        ) : null}
      </button>
    );
  };

  const listNode = (
    <div className="min-h-0 min-w-0 space-y-3 overflow-auto">
      {artifacts.length === 0 ? (
        <div className="rounded-md border border-dashed border-border p-4 text-sm text-muted-foreground">
          No artifacts yet. The first phase writes task.md and 01-research-questions-*.md here.
        </div>
      ) : (
        <>
          {groups.map((group) => (
            <section key={group.group} className="space-y-1.5">
              {groupHeader(group)}
              {collapsedGroups.has(group.group) ? null : <div className="space-y-1.5 pl-1">{rows(group.artifacts)}</div>}
            </section>
          ))}
          {deletedArtifacts.length > 0 ? (
            <section className="space-y-1.5">
              <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                <span className="flex-1 truncate">Deleted</span>
                <span>{deletedArtifacts.length}</span>
              </div>
              <div className="space-y-1.5 pl-1">{rows(deletedArtifacts)}</div>
            </section>
          ) : null}
        </>
      )}
    </div>
  );

  const viewerNode = selected && task ? (
    <ArtifactViewer taskId={taskId} fileName={selected} task={task} panelWidth={panelWidth} />
  ) : null;

  return (
    <TooltipProvider delayDuration={300}>
    <div ref={setPanelRoot} className="flex h-full min-h-0 flex-1 flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        {stacked && selected ? (
          <Button type="button" variant="outline" className="h-8 w-fit" onClick={() => setSelected(null)}>
            <Icon name="ChevronLeft" className="size-4" />
            Artifacts {artifacts.length}
          </Button>
        ) : (
          <div className="flex items-baseline gap-2">
            <h3 className="text-sm font-semibold text-foreground">Artifacts</h3>
            <span className="text-sm font-semibold text-muted-foreground">{artifacts.length}</span>
          </div>
        )}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button type="button" variant="outline" className="h-8" disabled={busy} onClick={() => void hydrateNow()}>
              <Icon name="Download" className="size-4" />
              Reimport files
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            Re-import artifact files from .rpi/tasks/{task?.slug ?? taskId}/ in the workspace into the plugin. Use it after editing files outside bb.
          </TooltipContent>
        </Tooltip>
      </div>
      {stacked ? (
        selected ? (
          <div className="flex min-h-0 flex-1 flex-col gap-3">
            {viewerNode}
          </div>
        ) : (
          <div className="min-h-0 flex-1 overflow-auto">{listNode}</div>
        )
      ) : (
        <div className="flex min-h-0 flex-1 gap-0">
          <div style={{ width: listWidth.width }} className="min-h-0 min-w-0 shrink-0">{listNode}</div>
          <SplitHandle ariaLabel="Resize artifact list" width={listWidth} onDrag={listWidth.drag} onStep={listWidth.step} onCommit={listWidth.commit} />
          <div className="min-h-0 min-w-0 flex-1">
            {viewerNode ?? (
              <div className="flex h-full min-h-[200px] items-center justify-center rounded-md border border-dashed border-border p-4 text-center text-sm text-muted-foreground">
                Select an artifact to read it. Hover a line and press + to comment.
              </div>
            )}
          </div>
        </div>
      )}
    </div>
    </TooltipProvider>
  );
}

const WORKTREE_TIMING_META: Record<"now" | "later" | "never", { text: string; hint: string }> = {
  now: { text: "worktree from the start", hint: "The task gets its own branch and worktree directory before research starts." },
  later: { text: "worktree after planning", hint: "Research and planning run in the main checkout; implementation gets its own branch and directory." },
  never: { text: "no worktree", hint: "Every phase runs in the main checkout; no separate branch or directory is created." },
};

const PERMISSION_MODE_HINT: Record<string, string> = {
  default: "The agent asks before edits and commands it is not already approved for.",
  accept_edits: "The agent applies file edits without asking, but still asks before running commands.",
  auto: "The agent edits files and runs commands without asking, within its allowed scope.",
  bypass: "The agent skips bb's permission prompts entirely for this task.",
};

function TaskMetaTerm({ text, hint }: { text: string; hint: string }) {
  return (
    <HintTrigger hint={hint} className="underline decoration-dotted decoration-muted-foreground/60 underline-offset-2">
      {text}
    </HintTrigger>
  );
}

// Current step's 4px bar reuses the tone's own color; "active" (running) and "success" (settled)
// both read as the same green bar the rest of the panel already uses for in-progress/done work.
const TONE_BAR_CLASS: Record<StatusTone, string> = {
  attention: "bg-attention",
  warning: "bg-warning",
  danger: "bg-destructive",
  success: "bg-success",
  active: "bg-success",
  muted: "bg-muted-foreground",
};

// Live phase strip: one button per workflow step (phaseProgress, status.ts), replacing the old
// static "RPI WORKFLOW" card. Clicking a step sets/clears the sessions-section phase filter.
function PhaseStrip({
  workflowType,
  worktreeTiming,
  currentLabel,
  sessions,
  activeFilter,
  onSelect,
  compact,
}: {
  workflowType: WorkflowType;
  worktreeTiming: "now" | "later" | "never";
  currentLabel: string | null;
  sessions: SessionView[];
  activeFilter: string | null;
  onSelect: (step: string) => void;
  compact: boolean;
}) {
  const steps = useMemo(
    () => phaseProgress({ workflowType, worktreeTiming, currentLabel, sessions }),
    [workflowType, worktreeTiming, currentLabel, sessions],
  );
  const firstFutureIndex = steps.findIndex((entry) => entry.state === "future");
  return (
    <div className={cn("flex gap-1.5", compact && "flex-wrap")}>
      {steps.map((entry: PhaseProgressEntry, index) => {
        const isActive = activeFilter === entry.step;
        const barClass = entry.state === "current" ? TONE_BAR_CLASS[entry.tone ?? "muted"] : entry.state === "done" ? "bg-muted-foreground/50" : "bg-border";
        return (
          <Tooltip key={entry.step}>
            <TooltipTrigger asChild>
              <button
                type="button"
                aria-current={entry.state === "current" ? "step" : undefined}
                aria-pressed={isActive}
                onClick={() => onSelect(entry.step)}
                className={cn(
                  "min-w-0 rounded-md border px-3 py-2 text-left",
                  entry.state === "current" ? "flex-[1.6]" : "flex-1",
                  compact && "min-w-[120px]",
                  entry.state === "current" ? "border-foreground bg-card" : entry.state === "future" ? "border-dashed border-border" : "border-border",
                )}
              >
                <span className={cn("block h-1 rounded-sm", barClass)} />
                <span className={cn("mt-1.5 flex gap-2", compact ? "flex-col items-start gap-0.5" : "items-center justify-between")}>
                  <span
                    className={cn(
                      "truncate whitespace-nowrap text-xs",
                      entry.state === "current" ? "font-medium text-foreground" : entry.state === "done" ? "text-muted-foreground" : "text-muted-foreground/70",
                    )}
                  >
                    {entry.step}
                  </span>
                  <span className="shrink-0 text-xs">
                    {entry.needsHuman > 0 ? (
                      <>
                        <span className={TONE_TEXT_CLASS[entry.tone ?? "muted"]}>
                          {entry.needsHuman} {entry.needsHuman === 1 ? "needs you" : "need you"}
                        </span>
                        <span className="text-muted-foreground"> / {entry.count}</span>
                      </>
                    ) : entry.count > 0 ? (
                      <span className="text-muted-foreground">{entry.count}</span>
                    ) : index === firstFutureIndex ? (
                      <span className="text-muted-foreground">next</span>
                    ) : null}
                  </span>
                </span>
              </button>
            </TooltipTrigger>
            <TooltipContent>{PHASE_DESCRIPTIONS[entry.step] ?? entry.step}</TooltipContent>
          </Tooltip>
        );
      })}
    </div>
  );
}

// The task's newest still-relevant session: needsHuman ones first, then running, then anything
// else live (settled/interrupted); a superseded session is never a candidate. Backs the header's
// "Open current session" button.
function currentSessionFor(sessions: SessionView[], task: TaskRecord): SessionView | null {
  const live = sessions
    .map((session) => ({ session, effective: effectiveStatus(session, sessions, task) }))
    .filter(({ effective }) => effective !== SUPERSEDED);
  if (live.length === 0) return null;
  const rank = (effective: string) => (needsHuman(effective) ? 0 : effective === "running" ? 1 : 2);
  live.sort((a, b) => {
    const rankDiff = rank(a.effective) - rank(b.effective);
    if (rankDiff !== 0) return rankDiff;
    const aTime = a.session.threadUpdatedAt ?? a.session.updatedAt;
    const bTime = b.session.threadUpdatedAt ?? b.session.updatedAt;
    return bTime - aTime;
  });
  return live[0]!.session;
}

function TaskDetailPage({ taskId, artifactFileName }: { taskId: string; artifactFileName?: string | null }) {
  const rpc = useRpc<RpcContract>();
  const navigate = useBbNavigate();
  const [task, setTask] = useState<TaskRecord | null>(null);
  const [workspace, setWorkspace] = useState<TaskWorkspaceState | null>(null);
  const [sessions, setSessions] = useState<SessionView[]>([]);
  const [artifactCount, setArtifactCount] = useState<number | null>(null);
  const [tab, setTab] = useState<"sessions" | "artifacts" | "settings">(artifactFileName ? "artifacts" : "sessions");
  const [uiState, setUiState] = useState<TaskUiState | null>(null);
  // Which workflow step the sessions table is filtered to; null shows every session. Set from
  // PhaseStrip clicks, and once from the current step on first load (see the effect below).
  const [phaseFilter, setPhaseFilter] = useState<string | null>(null);
  const initializedFilterRef = useRef<string | null>(null);
  const [panelWidth, setRoot] = useElementWidth();
  const compact = panelWidth > 0 && panelWidth < 560;
  const [modelCatalog, setModelCatalog] = useState<ListModelsOutput | null>(null);

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
  const refetchArtifactCount = () => {
    rpc.call("listArtifacts", { taskId }).then(({ artifacts }) => setArtifactCount(artifacts.length));
  };

  useEffect(() => {
    refetch();
    refetchArtifactCount();
    rpc.call("getTaskUiState", { taskId }).then(setUiState);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [taskId]);
  useEffect(() => {
    if (artifactFileName) setTab("artifacts");
  }, [artifactFileName]);
  useEffect(() => {
    let cancelled = false;
    fetchModelCatalog(rpc, task?.hostId ?? null).then((result) => {
      if (!cancelled) setModelCatalog(result);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [task?.hostId]);
  useRealtime("tasks", refetch);
  useRealtime("rpi:sessions", refetch);
  useRealtime("rpi:ui-state", () => {
    rpc.call("getTaskUiState", { taskId }).then(setUiState);
  });
  useRealtime("artifacts", refetchArtifactCount);
  useRealtime("rpi:artifacts", refetchArtifactCount);

  useEffect(() => {
    if (!workspace) return;
    if (initializedFilterRef.current === taskId) return;
    initializedFilterRef.current = taskId;
    const currentStep = labelStep(workspace.currentLabel);
    const hasSessions = currentStep !== null && sessions.some((session) => labelStep(session.label) === currentStep);
    setPhaseFilter(hasSessions ? currentStep : null);
  }, [taskId, workspace, sessions]);

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

  const filteredSessions = phaseFilter ? sessions.filter((session) => labelStep(session.label) === phaseFilter) : sessions;
  const currentSession = currentSessionFor(sessions, task);

  // The tab shows the total session count; the heading under the strip (below) already says how
  // many of those are live or phase-filtered, so this is not effectiveStatus-filtered.
  const tabs: Array<{ id: "sessions" | "artifacts" | "settings"; label: string }> = [
    { id: "sessions", label: `Sessions ${sessions.length}` },
    { id: "artifacts", label: artifactCount === null ? "Artifacts" : `Artifacts ${artifactCount}` },
    { id: "settings", label: "Settings" },
  ];

  return (
    <div ref={setRoot} className="flex min-h-0 flex-1 flex-col gap-4">
      <button
        type="button"
        onClick={() => navigate.toPluginPanel("rpi", { subPath: "" })}
        className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
      >
        <Icon name="ChevronLeft" className="size-4" />
        All tasks
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
          <p className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
            <span className="font-mono">{task.slug}</span>
            <span aria-hidden="true">·</span>
            <span>{WORKFLOW_GRAPH_LABELS[task.workflowType]} workflow</span>
            <span aria-hidden="true">·</span>
            <TaskMetaTerm text={WORKTREE_TIMING_META[task.worktreeTiming].text} hint={WORKTREE_TIMING_META[task.worktreeTiming].hint} />
            <span aria-hidden="true">·</span>
            <TaskMetaTerm
              text={`${task.permissionMode ?? "default"} permissions`}
              hint={PERMISSION_MODE_HINT[task.permissionMode ?? "default"] ?? PERMISSION_MODE_HINT.default!}
            />
            <span aria-hidden="true">·</span>
            <TaskMetaTerm
              text={task.autoAdvance ? "auto-advance on" : "auto-advance off"}
              hint={task.autoAdvance
                ? "The task moves to the next phase automatically when a phase finishes cleanly, except at gates you chose to keep manual."
                : "You approve each phase transition yourself; nothing advances automatically."}
            />
            <span aria-hidden="true">·</span>
            <TaskMetaTerm
              text={task.providerId && task.model ? (modelCatalog ? modelDisplay(modelCatalog, task.providerId, task.model) : `${task.providerId}/${task.model}`) : "default model"}
              hint="Model used for new sessions of this task; change it in Settings."
            />
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <Popover>
            <PopoverTrigger asChild>
              <Button type="button" variant="outline">
                <Icon name="FileText" className="size-4" />
                Scratch
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-[440px] max-w-[90vw] p-0">
              <div className="p-3">
                <ScratchPadPanel taskId={taskId} />
              </div>
            </PopoverContent>
          </Popover>
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
          ) : currentSession ? (
            <Button type="button" onClick={() => navigate.toThread(currentSession.threadId)}>
              <Icon name="ArrowUpRight" className="size-4" />
              Open current session
            </Button>
          ) : (
            <Tooltip>
              <TooltipTrigger asChild>
                <span>
                  <Button type="button" disabled>
                    <Icon name="ArrowUpRight" className="size-4" />
                    Open current session
                  </Button>
                </span>
              </TooltipTrigger>
              <TooltipContent>No live session yet</TooltipContent>
            </Tooltip>
          )}
        </div>
      </div>
      <div role="tablist" onKeyDown={rovingKeyDown} className={cn("flex w-fit max-w-full gap-1 rounded-md border border-border p-1", compact && "overflow-x-auto")}>
        {tabs.map((entry) => (
          <button
            key={entry.id}
            type="button"
            role="tab"
            id={`rpi-task-tab-${entry.id}`}
            aria-selected={tab === entry.id}
            aria-controls={`rpi-task-tabpanel-${entry.id}`}
            tabIndex={tab === entry.id ? 0 : -1}
            onClick={() => setTab(entry.id)}
            className={tabClass(tab === entry.id)}
          >
            {entry.label}
          </button>
        ))}
      </div>
      <div id={`rpi-task-tabpanel-${tab}`} role="tabpanel" aria-labelledby={`rpi-task-tab-${tab}`} className="flex min-h-0 flex-1 flex-col">
        {tab === "artifacts" ? (
          <div className="flex min-h-[520px] flex-1 flex-col">
            <ArtifactsPanel taskId={taskId} initialFileName={artifactFileName} />
          </div>
        ) : tab === "settings" ? (
          <div className="space-y-6">
            <div className="space-y-3">
              <h3 className="text-sm font-semibold text-foreground">Model</h3>
              <TaskModelPanel task={task} onUpdated={refetch} />
            </div>
            <div className="space-y-3">
              <h3 className="text-sm font-semibold text-foreground">Workspace</h3>
              <WorkspacePanel taskId={taskId} />
            </div>
            <div className="space-y-3">
              <h3 className="text-sm font-semibold text-foreground">Auto-advance</h3>
              <AutoAdvancePanel task={task} onUpdated={refetch} />
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <PhaseStrip
              workflowType={task.workflowType}
              worktreeTiming={task.worktreeTiming}
              currentLabel={workspace.currentLabel}
              sessions={sessions}
              activeFilter={phaseFilter}
              onSelect={(step) => setPhaseFilter((current) => (current === step ? null : step))}
              compact={compact}
            />
            <TipsPanel taskId={taskId} label={workspace.currentLabel} variant="inline" />
            {visibleAttempts.length > 0 ? (
              <div className="space-y-2">
                {visibleAttempts.map((attempt) => <RecoverLaunchRow key={attempt.id} attempt={attempt} onResolved={refetch} />)}
              </div>
            ) : null}
            <div className="flex items-baseline justify-between gap-3">
              <h3 className="text-sm font-semibold text-foreground">
                {phaseFilter ? `Sessions in ${phaseFilter} ${filteredSessions.length}` : `Sessions ${filteredSessions.length}`}
              </h3>
              {phaseFilter ? (
                <Button type="button" variant="link" className="h-auto p-0 text-xs" onClick={() => setPhaseFilter(null)}>
                  Show all {sessions.length}
                </Button>
              ) : null}
            </div>
            {filteredSessions.length === 0 ? (
              <div className="rounded-xl border border-dashed border-border bg-card/60 px-4 py-6 text-sm text-muted-foreground">
                No sessions yet.
              </div>
            ) : (
              <SessionsTable sessions={filteredSessions} allSessions={sessions} task={task} compact={compact} />
            )}
          </div>
        )}
      </div>
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
// Sidebar status dot. One filled circle per row, colored by tone; `pulse` animates work in
// progress; `child` adds a dashed ring so subagent and fork rows read as nested under a session.
// Host token classes only: subagent activity uses `primary` (the theme accent, blue in bb's
// default themes) because the host exposes no dedicated info/blue token.
const DOT_FILL_CLASS: Record<StatusTone | "primary" | "foreground", string> = {
  success: "bg-success",
  warning: "bg-warning",
  danger: "bg-destructive",
  attention: "bg-attention",
  muted: "bg-muted-foreground/50",
  active: "bg-success",
  primary: "bg-primary",
  foreground: "bg-foreground",
};
function Dot({ tone, pulse = false, child = false }: { tone: keyof typeof DOT_FILL_CLASS; pulse?: boolean; child?: boolean }) {
  return (
    <span className={cn("flex size-3.5 shrink-0 items-center justify-center rounded-full", child && "border border-dashed border-muted-foreground/60")} aria-hidden>
      <span className={cn("size-2 rounded-full", DOT_FILL_CLASS[tone], pulse && "motion-safe:animate-pulse")} />
    </span>
  );
}

function otherThreadDot(thread: { hasPendingInteraction: boolean; isUnread: boolean }, busy = false, child = false) {
  if (thread.hasPendingInteraction) return <Dot tone="danger" child={child} />;
  if (busy) return <Dot tone="primary" pulse child={child} />;
  if (thread.isUnread) return <Dot tone="foreground" child={child} />;
  return <Dot tone="muted" child={child} />;
}

// The words behind otherThreadDot's colors, for the row's visually hidden status text.
function otherThreadStatusText(thread: { hasPendingInteraction: boolean; isUnread: boolean }, busy = false): string {
  if (thread.hasPendingInteraction) return "Waiting for you";
  if (busy) return "Running";
  if (thread.isUnread) return "Unread";
  return "Idle";
}

// Sidebar group collapse state (`rpi:sidebar:collapsed`, one map for the whole sidebar): unlike
// usePersistedSet (membership = collapsed, default expanded), a sidebar group's default depends on
// the group's own content (does it hold the active thread or a needs-human session), so this
// persists only explicit overrides and leaves the default to the caller.
function readCollapsedOverrides(key: string): Record<string, boolean> {
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(key) ?? "");
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const entries = Object.entries(parsed as Record<string, unknown>).filter((entry): entry is [string, boolean] => typeof entry[1] === "boolean");
    return Object.fromEntries(entries);
  } catch {
    return {};
  }
}

function useCollapseOverrides(key: string) {
  const [overrides, setOverrides] = useState<Record<string, boolean>>(() => readCollapsedOverrides(key));
  const set = (id: string, collapsed: boolean) => {
    setOverrides((current) => {
      const next = { ...current, [id]: collapsed };
      if (typeof window !== "undefined") window.localStorage.setItem(key, JSON.stringify(next));
      return next;
    });
  };
  return { get: (id: string) => overrides[id], set };
}

function sidebarSessionTime(session: SessionView): number {
  return session.threadUpdatedAt ?? session.updatedAt;
}

export function RpiThreadList({ activeThreadId, activeProjectId, isCompactViewport, onNavigate, Original }: PluginThreadListProps) {
  const rpc = useRpc<RpcContract>();
  const navigate = useBbNavigate();
  const sidebar = experimental_useSidebarThreads();
  const threadActions = experimental_useSidebarThreadActions();
  const archive = useArchiveThread({
    title: "Archive this thread?",
    description: "Archives the thread and its children, and closes any panes showing them.",
    confirmLabel: "Archive",
  });
  const [useDefault, setUseDefault] = useState(false);
  const [sessionsByThread, setSessionsByThread] = useState<Map<string, SessionView>>(new Map());
  const [taskMeta, setTaskMeta] = useState<Map<string, { name: string; projectId: string; workflowType: WorkflowType; worktreeTiming: "now" | "later" | "never" }>>(new Map());
  const [projectNameById, setProjectNameById] = useState<Map<string, string>>(new Map());
  const [launchingFromTask, setLaunchingFromTask] = useState<string | null>(null);
  const [forkingThreadId, setForkingThreadId] = useState<string | null>(null);
  const collapseOverrides = useCollapseOverrides("rpi:sidebar:collapsed");
  const doneGroups = usePersistedSet("rpi:sidebar:done-expanded");

  const refetch = () => {
    Promise.all([
      rpc.call("listSessions", { taskId: null }),
      rpc.call("listTasks", { archived: false }),
      rpc.call("listProjects", { includePersonal: true }),
    ]).then(([sessionResult, taskResult, projects]) => {
      setSessionsByThread(new Map(sessionResult.sessions.map((session) => [session.threadId, session])));
      setTaskMeta(new Map(taskResult.tasks.map((task) => [task.id, { name: task.name, projectId: task.projectId, workflowType: task.workflowType, worktreeTiming: task.worktreeTiming }])));
      setProjectNameById(new Map(projects.map((project) => [project.id, project.name])));
    });
  };
  useEffect(() => {
    refetch();
  }, []);
  useRealtime("tasks", refetch);
  useRealtime("rpi:sessions", refetch);

  // Continue a task from the sidebar without opening it first: forks a fresh thread off its most
  // recent session (same RPC the "Iterate" confirm dialogs use), so the new chat keeps the task's
  // context instead of starting blank.
  const startNewChat = async (taskId: string, fromThreadId: string) => {
    if (launchingFromTask) return;
    setLaunchingFromTask(taskId);
    try {
      const result = await rpc.call("iterateInFreshSession", { threadId: fromThreadId });
      go(result.threadId);
    } catch (error) {
      reportLaunchError(error);
    } finally {
      setLaunchingFromTask(null);
    }
  };

  // Row-level actions (Fork/Archive/Delete). Archive and delete go through bb's own host API
  // (experimental_useSidebarThreadActions), same as the default sidebar, so they get bb's real
  // recursive-child handling and delete confirmation for free instead of a re-implementation here.
  // Fork reuses the same forkSession RPC the thread header's "Fork" menu item already calls.
  const forkThread = async (threadId: string) => {
    if (forkingThreadId) return;
    setForkingThreadId(threadId);
    try {
      const result = await rpc.call("forkSession", { threadId });
      go(result.threadId);
    } catch (error) {
      reportLaunchError(error);
    } finally {
      setForkingThreadId(null);
    }
  };

  const [draggingThreadId, setDraggingThreadId] = useState<string | null>(null);
  const [dragOverTaskId, setDragOverTaskId] = useState<string | null>(null);
  const dragDepth = useRef(new Map<string, number>());
  const adoptThread = async (threadId: string, taskId: string) => {
    try {
      await rpc.call("adoptThread", { threadId, taskId });
      toast.success(`Moved to ${taskMeta.get(taskId)?.name ?? "task"}`);
      refetch();
    } catch (error) {
      reportLaunchError(error);
    }
  };
  // Threads that are not RPI sessions can be dragged onto a task header. dataTransfer carries
  // only the thread id under a plugin-private type so other drop targets ignore it. The drag
  // image is a small chip with the thread title rather than the whole row; enter/leave are
  // depth-counted per target so crossing the header's child elements does not flicker.
  const DRAG_TYPE = "application/x-rpi-thread";
  const dragSourceProps = (threadId: string, title: string) => ({
    draggable: true,
    onDragStart: (event: DragEvent<HTMLElement>) => {
      event.dataTransfer.setData(DRAG_TYPE, threadId);
      event.dataTransfer.effectAllowed = "move";
      const chip = document.createElement("div");
      chip.textContent = title;
      chip.className = "pointer-events-none fixed -left-[9999px] top-0 max-w-56 truncate rounded-md border border-border bg-popover px-2 py-1 text-xs text-popover-foreground shadow-md";
      document.body.appendChild(chip);
      event.dataTransfer.setDragImage(chip, 12, 14);
      requestAnimationFrame(() => chip.remove());
      setDraggingThreadId(threadId);
    },
    onDragEnd: () => {
      setDraggingThreadId(null);
      setDragOverTaskId(null);
      dragDepth.current.clear();
    },
  });
  const dropTargetProps = (taskId: string) => ({
    onDragEnter: (event: DragEvent<HTMLElement>) => {
      if (!event.dataTransfer.types.includes(DRAG_TYPE)) return;
      event.preventDefault();
      dragDepth.current.set(taskId, (dragDepth.current.get(taskId) ?? 0) + 1);
      setDragOverTaskId(taskId);
    },
    onDragOver: (event: DragEvent<HTMLElement>) => {
      if (!event.dataTransfer.types.includes(DRAG_TYPE)) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = "move";
    },
    onDragLeave: () => {
      const depth = (dragDepth.current.get(taskId) ?? 1) - 1;
      dragDepth.current.set(taskId, depth);
      if (depth <= 0) setDragOverTaskId((current) => (current === taskId ? null : current));
    },
    onDrop: (event: DragEvent<HTMLElement>) => {
      const threadId = event.dataTransfer.getData(DRAG_TYPE);
      dragDepth.current.set(taskId, 0);
      setDragOverTaskId(null);
      setDraggingThreadId(null);
      if (!threadId) return;
      event.preventDefault();
      void adoptThread(threadId, taskId);
    },
  });

  const rowActions = (thread: { id: string }, adoptable = false) => (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label="Thread actions"
          onClick={(event) => event.stopPropagation()}
          className="flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground opacity-0 group-hover:opacity-100 hover:bg-card focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring data-[state=open]:opacity-100"
        >
          <Icon name="MoreHorizontal" className="size-3.5" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-36 p-1" onClick={(event) => event.stopPropagation()}>
        <button
          type="button"
          disabled={forkingThreadId === thread.id}
          onClick={() => void forkThread(thread.id)}
          className="block w-full rounded px-2 py-1.5 text-left text-sm text-foreground hover:bg-muted disabled:opacity-50"
        >
          Fork
        </button>
        {adoptable && taskMeta.size > 0 ? (
          <Popover>
            <PopoverTrigger asChild>
              <button type="button" className="flex w-full items-center rounded px-2 py-1.5 text-left text-sm text-foreground hover:bg-muted">
                <span className="flex-1">Move to task</span>
                <Icon name="ChevronRight" className="size-3.5 text-muted-foreground" />
              </button>
            </PopoverTrigger>
            <PopoverContent side="right" align="start" className="max-h-64 w-48 overflow-y-auto p-1">
              {[...taskMeta.entries()].map(([taskId, meta]) => (
                <button
                  key={taskId}
                  type="button"
                  onClick={() => void adoptThread(thread.id, taskId)}
                  className="block w-full truncate rounded px-2 py-1.5 text-left text-sm text-foreground hover:bg-muted"
                >
                  {meta.name}
                </button>
              ))}
            </PopoverContent>
          </Popover>
        ) : null}
        <button
          type="button"
          onClick={() => archive.request(thread.id)}
          className="block w-full rounded px-2 py-1.5 text-left text-sm text-foreground hover:bg-muted"
        >
          Archive
        </button>
        <button
          type="button"
          onClick={() => threadActions.requestDelete(thread.id)}
          className="block w-full rounded px-2 py-1.5 text-left text-sm text-destructive hover:bg-destructive/10"
        >
          Delete
        </button>
      </PopoverContent>
    </Popover>
  );

  // Grouped by task so a session's effective status (status.ts: does a later session already
  // supersede it) can be computed against the rest of its task's sessions, same as the panel's
  // needs-you band and the task detail sessions table.
  const sessionsByTaskId = useMemo(() => {
    const map = new Map<string, SessionView[]>();
    for (const session of sessionsByThread.values()) {
      const list = map.get(session.taskId);
      if (list) list.push(session);
      else map.set(session.taskId, [session]);
    }
    return map;
  }, [sessionsByThread]);

  if (useDefault) {
    return (
      <div className="flex h-full min-h-0 flex-col">
        <button type="button" onClick={() => setUseDefault(false)} className="px-3 py-1.5 text-left text-xs text-muted-foreground hover:text-foreground">
          Show RPI list
        </button>
        <div className="min-h-0 flex-1"><Original /></div>
      </div>
    );
  }
  if (sidebar.status !== "ready") return <Original />;

  // Subagent and fork threads are children (parentThreadId) of a session thread. They are not RPI
  // sessions, so without this they land in "Other threads" and a task whose session is quietly
  // waiting on three running subagents looks finished. Nest every descendant under its session.
  const childrenByParent = new Map<string, PluginSidebarThread[]>();
  for (const thread of sidebar.threads) {
    if (!thread.parentThreadId || sessionsByThread.has(thread.id)) continue;
    const list = childrenByParent.get(thread.parentThreadId) ?? [];
    list.push(thread);
    childrenByParent.set(thread.parentThreadId, list);
  }
  const descendantsOf = (threadId: string): PluginSidebarThread[] => {
    const out: PluginSidebarThread[] = [];
    const stack = [...(childrenByParent.get(threadId) ?? [])];
    while (stack.length) {
      const next = stack.pop()!;
      out.push(next);
      stack.push(...(childrenByParent.get(next.id) ?? []));
    }
    return out.sort((a, b) => b.createdAt - a.createdAt);
  };
  const threadIsBusy = (thread: PluginSidebarThread) =>
    thread.hasPendingInteraction || Object.values(thread.activity).some((n) => n > 0) || thread.indicator === "runtime" || thread.indicator === "background-agent" || thread.indicator === "workflow";

  const groups = new Map<string, { taskName: string; threads: PluginSidebarThread[] }>();
  const nested = new Set<string>();
  const other: PluginSidebarThread[] = [];
  for (const thread of sidebar.threads) {
    const session = sessionsByThread.get(thread.id);
    const taskName = session ? taskMeta.get(session.taskId)?.name : undefined;
    if (!session || !taskName) continue;
    for (const child of descendantsOf(thread.id)) nested.add(child.id);
  }
  for (const thread of sidebar.threads) {
    const session = sessionsByThread.get(thread.id);
    const taskName = session ? taskMeta.get(session.taskId)?.name : undefined;
    if (!session || !taskName) {
      if (!nested.has(thread.id)) other.push(thread);
      continue;
    }
    const group = groups.get(session.taskId) ?? { taskName, threads: [] };
    group.threads.push(thread);
    groups.set(session.taskId, group);
  }
  const sortedOther = [...other].sort((a, b) => b.createdAt - a.createdAt);
  // Sentinel id (not a real task id, task ids come from the RPC and never start with "__") so
  // the "Other threads" bucket collapses through the same persisted map as task groups.
  const OTHER_GROUP_KEY = "__other__";
  const otherHasActive = sortedOther.some((thread) => thread.id === activeThreadId);
  const otherCollapsed = collapseOverrides.get(OTHER_GROUP_KEY) ?? !otherHasActive;

  const go = (threadId: string) => {
    navigate.toThread(threadId);
    onNavigate();
  };

  // Each group's rows split into live (not superseded) and done (superseded); live sessions decide
  // the group's needs-human flag, its default expand/collapse, and its sort position among groups.
  const groupEntries = [...groups.entries()].map(([taskId, group]) => {
    const task = taskMeta.get(taskId);
    const taskSessions = sessionsByTaskId.get(taskId) ?? [];
    const rows = group.threads.map((thread) => {
      const session = sessionsByThread.get(thread.id)!;
      const effective = task ? effectiveStatus(session, taskSessions, task) : session.rpiStatus;
      return { thread, session, effective };
    });
    // Stable order only: newest session first by creation time. Status rank, last-update time,
    // and the selected thread are deliberately not sort keys; using them made rows jump on click.
    const byCreated = (a: { session: SessionView }, b: { session: SessionView }) => b.session.createdAt - a.session.createdAt;
    const live = rows.filter((row) => row.effective !== SUPERSEDED).sort(byCreated);
    const done = rows.filter((row) => row.effective === SUPERSEDED).sort(byCreated);
    const needsHumanCount = live.filter((row) => needsHuman(row.effective)).length;
    const hasActive =
      rows.some((row) => row.thread.id === activeThreadId) ||
      rows.some((row) => descendantsOf(row.thread.id).some((child) => child.id === activeThreadId || threadIsBusy(child)));
    const firstCreated = Math.min(...rows.map((row) => row.session.createdAt));
    const latestThreadId = (live[0] ?? done[0])?.thread.id ?? null;
    return { taskId, taskName: group.taskName, projectId: task?.projectId ?? null, live, done, needsHumanCount, hasActive, firstCreated, latestThreadId };
  });
  // One flat list of tasks, newest task first by its first session's creation time. Nothing that
  // changes on click or as work progresses (active project, needs-you, last update) is a sort
  // key: the list must not reorder under the user. The project is shown as a muted subtitle only
  // when tasks span more than one project.
  groupEntries.sort((a, b) => b.firstCreated - a.firstCreated);
  const showProjectNames = new Set(groupEntries.map((entry) => entry.projectId ?? "__unknown__")).size > 1;
  const projectLabel = (projectId: string | null) => (projectId && projectNameById.get(projectId)) || "Unknown project";

  const ordinalsByTask = new Map<string, Map<string, { ordinal: number; total: number }>>();
  const ordinalsFor = (taskId: string) => {
    const cached = ordinalsByTask.get(taskId);
    if (cached) return cached;
    const computed = attemptOrdinals(sessionsByTaskId.get(taskId) ?? []);
    ordinalsByTask.set(taskId, computed);
    return computed;
  };

  const childRow = (thread: PluginSidebarThread) => {
    const busy = threadIsBusy(thread);
    return (
      <div key={thread.id} className="group flex items-center gap-0.5">
        <button
          type="button"
          onClick={() => go(thread.id)}
          title={thread.indicatorLabel ?? undefined}
          className={cn(
            "flex min-w-0 flex-1 items-center gap-2 rounded-md px-1.5 py-1 text-left text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            thread.id === activeThreadId ? "bg-card text-foreground" : "text-muted-foreground hover:text-foreground",
          )}
        >
          {otherThreadDot(thread, busy, true)}
          <span className="sr-only">{otherThreadStatusText(thread, busy)}, </span>
          <span className="truncate">{thread.title ?? thread.titleFallback ?? "Subagent"}</span>
          <span className={cn("ml-auto shrink-0", isCompactViewport && "hidden")}>{relativeTime(thread.updatedAt)}</span>
        </button>
        {rowActions(thread)}
      </div>
    );
  };

  const sessionRow = (thread: PluginSidebarThread, session: SessionView, effective: string, taskId: string) => {
    const meta = statusMeta(effective);
    const ordinal = ordinalsFor(taskId).get(session.threadId);
    const attemptSuffix = ordinal && ordinal.total > 1 ? `, attempt ${ordinal.ordinal}` : "";
    const title = session.label ? `${capitalize(labelStep(session.label) ?? "Session")}${attemptSuffix}` : (thread.title ?? thread.titleFallback ?? "Session");
    const children = descendantsOf(thread.id);
    const busyChildren = children.filter(threadIsBusy).length;
    return (
      <div key={thread.id} className="space-y-0.5">
        <div className="group flex items-center gap-0.5">
          <button
            type="button"
            onClick={() => go(thread.id)}
            className={cn(
              "flex min-w-0 flex-1 items-center gap-2 rounded-md px-1.5 py-1 text-left text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              thread.id === activeThreadId ? "bg-card text-foreground" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {/* Status is color-only in the dot, so the row's own name carries it for screen readers;
                the hover tooltip stays for mouse users. */}
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="shrink-0"><Dot tone={meta.tone} pulse={meta.tone === "active"} /></span>
              </TooltipTrigger>
              <TooltipContent>{meta.hint || meta.text}</TooltipContent>
            </Tooltip>
            <span className="sr-only">{meta.text}, </span>
            <span className="truncate">{title}</span>
            {busyChildren > 0 ? (
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="inline-flex shrink-0 items-center gap-1 text-muted-foreground">
                    <Dot tone="primary" pulse child />
                    <span aria-hidden>{busyChildren}</span>
                    <span className="sr-only">, {plural(busyChildren, "subagent", "subagents")} running</span>
                  </span>
                </TooltipTrigger>
                <TooltipContent>{plural(busyChildren, "subagent", "subagents")} running</TooltipContent>
              </Tooltip>
            ) : null}
            <span className={cn("ml-auto shrink-0", isCompactViewport && "hidden")}>{relativeTime(sidebarSessionTime(session))}</span>
          </button>
          {rowActions(thread)}
        </div>
        {children.length > 0 ? <div className="ml-3 space-y-0.5 border-l border-border pl-1.5">{children.map(childRow)}</div> : null}
      </div>
    );
  };

  const groupHeader = (entry: (typeof groupEntries)[number]) => {
    const defaultCollapsed = !entry.hasActive && entry.needsHumanCount === 0;
    const collapsed = collapseOverrides.get(entry.taskId) ?? defaultCollapsed;
    return (
      <div
        className={cn(
          "flex items-center gap-0.5 rounded-md transition-colors",
          draggingThreadId && "outline-dashed outline-1 -outline-offset-1 outline-border",
          dragOverTaskId === entry.taskId && "bg-primary/15 outline-primary",
        )}
        {...dropTargetProps(entry.taskId)}
      >
        <button
          type="button"
          aria-expanded={!collapsed}
          onClick={() => collapseOverrides.set(entry.taskId, !collapsed)}
          className="flex min-w-0 flex-1 items-center gap-1.5 rounded-md px-1.5 py-1 text-left text-xs font-medium text-foreground hover:bg-card/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Icon name={collapsed ? "ChevronRight" : "ChevronDown"} className="size-3.5 shrink-0" />
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="truncate">{entry.taskName}</span>
            {showProjectNames ? <span className="truncate text-[11px] font-normal text-muted-foreground">{projectLabel(entry.projectId)}</span> : null}
          </span>
          {entry.needsHumanCount > 0 ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <span className={cn("inline-flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[11px] font-semibold", TONE_PILL_CLASS.attention)}>
                  <span aria-hidden>{entry.needsHumanCount}</span>
                  <span className="sr-only">, {plural(entry.needsHumanCount, "session needs", "sessions need")} you</span>
                </span>
              </TooltipTrigger>
              <TooltipContent>{plural(entry.needsHumanCount, "session needs", "sessions need")} you</TooltipContent>
            </Tooltip>
          ) : null}
        </button>
        {entry.latestThreadId ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                aria-label={`New chat on ${entry.taskName}`}
                disabled={launchingFromTask === entry.taskId}
                onClick={() => void startNewChat(entry.taskId, entry.latestThreadId!)}
                className="flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-card/70 hover:text-foreground disabled:opacity-50"
              >
                <Icon name={launchingFromTask === entry.taskId ? "Spinner" : "Plus"} className="size-3.5" />
              </button>
            </TooltipTrigger>
            <TooltipContent>New chat on this task</TooltipContent>
          </Tooltip>
        ) : null}
      </div>
    );
  };

  const taskGroupNode = (entry: (typeof groupEntries)[number]) => {
    const defaultCollapsed = !entry.hasActive && entry.needsHumanCount === 0;
    const collapsed = collapseOverrides.get(entry.taskId) ?? defaultCollapsed;
    const doneCollapsed = !doneGroups.has(entry.taskId);
    return (
      <div key={entry.taskId} className="space-y-0.5">
        {groupHeader(entry)}
        {collapsed ? null : (
          <div className="ml-3 space-y-0.5 border-l border-border pl-1.5">
            {entry.live.map((row) => sessionRow(row.thread, row.session, row.effective, entry.taskId))}
            {entry.done.length > 0 ? (
              <>
                <button
                  type="button"
                  aria-expanded={!doneCollapsed}
                  onClick={() => doneGroups.toggle(entry.taskId)}
                  className="flex w-full items-center gap-1.5 rounded-md px-1.5 py-1 text-left text-xs text-muted-foreground hover:text-foreground"
                >
                  <Icon name={doneCollapsed ? "ChevronRight" : "ChevronDown"} className="size-3.5 shrink-0" />
                  <span>{plural(entry.done.length, "done session", "done sessions")}</span>
                </button>
                {doneCollapsed ? null : entry.done.map((row) => sessionRow(row.thread, row.session, row.effective, entry.taskId))}
              </>
            ) : null}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="flex h-full min-h-0 flex-col overflow-y-auto p-2">
      <div className="space-y-2">
        {groupEntries.map(taskGroupNode)}
        {sortedOther.length > 0 ? (
          <div className="space-y-0.5">
            <button
              type="button"
              aria-expanded={!otherCollapsed}
              onClick={() => collapseOverrides.set(OTHER_GROUP_KEY, !otherCollapsed)}
              className="flex w-full items-center gap-1.5 rounded-md px-1.5 py-1 text-left text-xs font-medium text-foreground hover:bg-card/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <Icon name={otherCollapsed ? "ChevronRight" : "ChevronDown"} className="size-3.5 shrink-0" />
              <span className="flex-1 truncate">Other threads</span>
              <span className="text-xs text-muted-foreground">{sortedOther.length}</span>
            </button>
            {otherCollapsed ? null : sortedOther.map((thread) => {
              return (
                <div
                  key={thread.id}
                  className={cn("group flex cursor-grab items-center gap-0.5 active:cursor-grabbing", draggingThreadId === thread.id && "opacity-40")}
                  {...dragSourceProps(thread.id, thread.title ?? thread.titleFallback ?? "Untitled")}
                >
                  <button
                    type="button"
                    onClick={() => go(thread.id)}
                    title={thread.indicatorLabel ?? "Drag onto a task to move it there"}
                    className={cn(
                      "flex min-w-0 flex-1 items-center gap-2 rounded-md px-1.5 py-1 text-left text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      thread.id === activeThreadId ? "bg-card text-foreground" : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {otherThreadDot(thread, threadIsBusy(thread))}
                    <span className="sr-only">{otherThreadStatusText(thread, threadIsBusy(thread))}, </span>
                    <span className="truncate">{thread.title ?? thread.titleFallback ?? "Untitled"}</span>
                    <span className="ml-auto shrink-0">{relativeTime(thread.updatedAt)}</span>
                  </button>
                  {rowActions(thread, true)}
                </div>
              );
            })}
          </div>
        ) : null}
      </div>
      <button type="button" onClick={() => setUseDefault(true)} className="mt-2 px-1.5 py-1 text-left text-xs text-muted-foreground hover:text-foreground">
        Show bb's default list
      </button>
      {archive.dialog}
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
        <h2 className="text-sm font-semibold text-foreground">Notifications</h2>
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
  const saveContextWarning = (patch: Partial<Prefs["contextWarning"]>) => {
    void rpc.call("setPrefs", { contextWarning: patch }).then(setPrefs);
  };
  const updateContextWarningRule = (index: number, patch: Partial<ContextWarningRule>) => {
    saveContextWarning({ rules: prefs.contextWarning.rules.map((rule, ruleIndex) => (ruleIndex === index ? { ...rule, ...patch } : rule)) });
  };
  const deleteContextWarningRule = (index: number) => {
    const rule = prefs.contextWarning.rules[index];
    if (!rule) return;
    saveContextWarning({
      rules: prefs.contextWarning.rules.filter((_, ruleIndex) => ruleIndex !== index),
      removedBuiltins: rule.builtin ? [...prefs.contextWarning.removedBuiltins, rule.id] : prefs.contextWarning.removedBuiltins,
    });
  };
  const addContextWarningRule = () => {
    saveContextWarning({
      rules: [...prefs.contextWarning.rules, { id: crypto.randomUUID(), pattern: "", threshold: prefs.contextWarning.defaultThreshold, builtin: false }],
    });
  };

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-sm font-semibold text-foreground">Defaults</h2>
        <p className="mt-1 text-sm text-muted-foreground">Provider, model, reasoning, and permission mode used for new tasks, per workflow type. Blank falls back to the row above.</p>
      </div>
      <div className="grid gap-3 lg:grid-cols-2">
        <div className="rounded-md border border-border bg-card p-3">
          <ModelSelect
            hostId={null}
            value={{ providerId: prefs.defaults.providerId ?? null, model: prefs.defaults.model ?? null, reasoningLevel: prefs.defaults.reasoningLevel ?? null }}
            onChange={(next) => saveDefaults({ providerId: next.providerId, model: next.model, reasoningLevel: next.reasoningLevel })}
            allowDefault
            defaultOptionLabel="bb default (the provider's choice)"
            label="Default model"
          />
        </div>
        <div className="rounded-md border border-border bg-card p-3">
          {/* researchModel is a bare model string with no providerId of its own (see server.ts's
              researchModelPreference); ModelSelect matches it by model id alone and this only ever
              writes back the model half of what it reports. */}
          <ModelSelect
            hostId={null}
            value={{ providerId: null, model: prefs.defaults.researchModel ?? null, reasoningLevel: null }}
            onChange={(next) => saveDefaults({ researchModel: next.model })}
            allowDefault
            label="Research subagent model"
          />
        </div>
      </div>
      <div className="space-y-2">
        <h3 className="text-sm font-semibold text-foreground">Per workflow type</h3>
        <div className="overflow-hidden rounded-xl border border-border bg-card">
          <table className="min-w-full border-collapse text-sm">
            <thead className="border-b border-border text-left text-[11px] uppercase tracking-[0.2em] text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-medium">Workflow</th>
                <th className="px-3 py-2 font-medium">Model</th>
                <th className="px-3 py-2 font-medium">Permission</th>
              </tr>
            </thead>
            <tbody>
              {WORKFLOW_TYPE_OPTIONS.map((option) => {
                const override = prefs.workflowDefaults[option.value] ?? EMPTY_WORKFLOW_OVERRIDE;
                return (
                  <tr key={option.value} className="border-b border-border last:border-b-0">
                    <td className="px-3 py-2 font-medium text-foreground">{option.label}</td>
                    <td className="min-w-[220px] px-3 py-2">
                      <ModelSelect
                        hostId={null}
                        value={{ providerId: override.providerId ?? null, model: override.model ?? null, reasoningLevel: override.reasoningLevel ?? null }}
                        onChange={(next) => saveWorkflow(option.value, { providerId: next.providerId, model: next.model, reasoningLevel: next.reasoningLevel })}
                        allowDefault
                        size="sm"
                        label={`${option.label} model`}
                      />
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
      <div className="space-y-2">
        <h3 className="text-sm font-semibold text-foreground">Context warning</h3>
        <p className="text-xs text-muted-foreground">Patterns match provider/model, for example */claude-sonnet-* or codex/gpt-5.5.</p>
        <label className="block space-y-2 rounded-md border border-border bg-card p-3 text-sm text-foreground">
          <span className="block font-medium">Default threshold {Math.round(prefs.contextWarning.defaultThreshold * 100)}%</span>
          <div className="flex items-center gap-3">
            <input
              type="range"
              min="30"
              max="95"
              step="5"
              value={Math.round(prefs.contextWarning.defaultThreshold * 100)}
              onChange={(event) => saveContextWarning({ defaultThreshold: Number(event.currentTarget.value) / 100 })}
              className="w-full accent-foreground"
            />
            <Input
              type="number"
              min={30}
              max={95}
              step={5}
              aria-label="Default threshold percent"
              className="h-8 w-20"
              value={Math.round(prefs.contextWarning.defaultThreshold * 100)}
              onChange={(event) => saveContextWarning({ defaultThreshold: Number(event.currentTarget.value) / 100 })}
            />
          </div>
        </label>
        <div className="overflow-hidden rounded-xl border border-border bg-card">
          <table className="min-w-full border-collapse text-sm">
            <thead className="border-b border-border text-left text-[11px] uppercase tracking-[0.2em] text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-medium">Pattern</th>
                <th className="px-3 py-2 font-medium">Threshold</th>
                <th className="px-3 py-2 font-medium" />
              </tr>
            </thead>
            <tbody>
              {prefs.contextWarning.rules.map((rule, index) => (
                <tr key={rule.id} className="border-b border-border last:border-b-0">
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-2">
                      <Input
                        className="h-8"
                        value={rule.pattern}
                        placeholder="*/claude-sonnet-*"
                        aria-label="Pattern"
                        onChange={(event) => updateContextWarningRule(index, { pattern: event.currentTarget.value })}
                      />
                      {rule.builtin ? <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">default</span> : null}
                    </div>
                  </td>
                  <td className="px-3 py-2">
                    <Input
                      type="number"
                      min={30}
                      max={95}
                      step={5}
                      aria-label="Threshold"
                      className="h-8 w-20"
                      value={Math.round(rule.threshold * 100)}
                      onChange={(event) => updateContextWarningRule(index, { threshold: Number(event.currentTarget.value) / 100 })}
                    />
                  </td>
                  <td className="px-3 py-2">
                    <button type="button" aria-label="Delete rule" className="text-muted-foreground hover:text-destructive" onClick={() => deleteContextWarningRule(index)}>
                      <Icon name="Trash2" className="size-4" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Button type="button" variant="outline" onClick={addContextWarningRule}>
          Add rule
        </Button>
      </div>
    </div>
  );
}

// Thread-header contract (frontend-registration.md "A control in the thread header"): the row is
// 48px chrome with 28px controls, and it wants ONE inline control with taller content in a
// portalled popover. This renders exactly that: phase pill + status + context gauge + a single
// `h-7` "⋯" button opening a portalled Popover (components/ui/popover.tsx) for Iterate/Fork/
// Interrupt. Proceed, Suggested next, and the context-high notice moved to RpiComposerBanner
// (registered via app.composer.customize in app.tsx) since those need more room than a 28px
// control has, per the same contract's "put taller content in a portalled popover" (a composer
// banner, not the header, is where a wide button belongs).
export function RpiThreadHeaderAction({ threadId }: { threadId: string; projectId: string; isCompactViewport: boolean }) {
  const rpc = useRpc<RpcContract>();
  const navigate = useBbNavigate();
  const { values: settings } = useSettings();
  // Which confirmation dialog (if any) is pending; a single discriminant covers both
  // destructive confirmations this component owns (item 8's `showIterateConfirmation` opt-out
  // still short-circuits straight to the RPC call, unchanged from the window.confirm version).
  const [pendingConfirm, setPendingConfirm] = useState<"iterate" | "archive" | null>(null);
  const runIterate = async () => {
    try {
      const result = await rpc.call("iterateInFreshSession", { threadId });
      navigate.toThread(result.threadId);
    } catch (error) {
      reportLaunchError(error);
    }
  };
  const iterate = () => {
    if (settings?.showIterateConfirmation !== false) {
      setPendingConfirm("iterate");
      return;
    }
    void runIterate();
  };
  const { session } = useRpiSessionState(threadId);
  const runArchive = () => {
    if (!session) return;
    void rpc.call("archiveTask", { taskId: session.taskId }).then(() => navigate.toPluginPanel("rpi", { subPath: "" }));
  };

  useEffect(() => {
    viewing.add(threadId);
    void rpc.call("setViewingSession", { threadId, viewing: true });
    return () => {
      viewing.delete(threadId);
      void rpc.call("setViewingSession", { threadId, viewing: false });
    };
  }, [threadId]);

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
    setPendingConfirm("archive");
  }, [session, jumpHotkeyForArchive]);

  if (!session) return null;

  return (
    <TooltipProvider delayDuration={300}>
    <div ref={actionRootRef} className="flex h-7 items-center gap-2">
      <RpiNotificationBridge />
      {settings?.showTaskPhaseLabels === false ? null : (
        <LabelPill label={session.label ?? "freeform"} emphasis={Boolean(session.label)} />
      )}
      <SessionStatus status={session.rpiStatus} />
      <ContextGauge usage={session.contextUsage} threshold={session.contextWarnThreshold} />
      <Popover>
        <PopoverTrigger asChild>
          <button
            type="button"
            aria-label="RPI session actions"
            className="flex size-7 shrink-0 items-center justify-center rounded-md border border-border text-muted-foreground hover:text-foreground"
          >
            <Icon name="MoreHorizontal" className="size-4" />
          </button>
        </PopoverTrigger>
        <PopoverContent>
          <button type="button" className="block w-full rounded px-2 py-1.5 text-left text-sm text-foreground hover:bg-muted" onClick={iterate}>
            Iterate
          </button>
          <button
            type="button"
            className="block w-full rounded px-2 py-1.5 text-left text-sm text-foreground hover:bg-muted"
            onClick={async () => {
              const result = await rpc.call("forkSession", { threadId });
              navigate.toThread(result.threadId);
            }}
          >
            Fork
          </button>
          <button
            type="button"
            className="block w-full rounded px-2 py-1.5 text-left text-sm text-foreground hover:bg-muted"
            onClick={() => void rpc.call("interruptSession", { threadId })}
          >
            Interrupt
          </button>
        </PopoverContent>
      </Popover>
      <ConfirmDialog
        open={pendingConfirm === "iterate"}
        onOpenChange={(open) => setPendingConfirm(open ? "iterate" : null)}
        title="Start a fresh session?"
        description="The current session keeps running."
        confirmLabel="Iterate"
        onConfirm={runIterate}
      />
      <ConfirmDialog
        open={pendingConfirm === "archive"}
        onOpenChange={(open) => setPendingConfirm(open ? "archive" : null)}
        title="Archive this task?"
        description="Sessions stay but the task leaves the active list."
        confirmLabel="Archive"
        onConfirm={runArchive}
      />
    </div>
    </TooltipProvider>
  );
}

// Registered as the "next-step" banner in app.composer.customize's `rpi-session` customization
// (app.tsx), scope "thread" only. Carries the affordances that moved out of the 28px header
// control: the context-high notice, Proceed, and Suggested next, none of which fit a 28px control
// per the thread-header contract. Renders null for every other composer scope kind and for a
// non-RPI thread (`getSession` returns null), and hides entirely for a quiet session (no
// extraction, no suggestion, no context warning) via the pure `shouldShowComposerBanner`
// (transitions.ts) so a session with nothing to say shows no banner at all.
export function RpiComposerBanner() {
  const rpc = useRpc<RpcContract>();
  const navigate = useBbNavigate();
  const { values: settings } = useSettings();
  const view = useComposerView();
  const threadId = view.scope.kind === "thread" ? view.scope.threadId : null;
  const { session, uiState, setUiState, hasPendingLaunchAttempt } = useRpiSessionState(threadId);
  const [pendingIterateConfirm, setPendingIterateConfirm] = useState(false);
  // The session view (getSession) does not carry the task's providerId/model/reasoningLevel, so
  // the compact model control below fetches the task itself; "tasks" is the same realtime channel
  // updateTask publishes on, so a change from the task Settings tab shows up here too.
  const [bannerTask, setBannerTask] = useState<TaskRecord | null>(null);
  const [bannerModelCatalog, setBannerModelCatalog] = useState<ListModelsOutput | null>(null);
  const bannerTaskId = session?.taskId ?? null;

  useEffect(() => {
    if (!bannerTaskId) {
      setBannerTask(null);
      return;
    }
    rpc.call("getTask", { taskId: bannerTaskId }).then(({ task }) => setBannerTask(task));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bannerTaskId]);
  useRealtime("tasks", () => {
    if (bannerTaskId) rpc.call("getTask", { taskId: bannerTaskId }).then(({ task }) => setBannerTask(task));
  });

  useEffect(() => {
    let cancelled = false;
    fetchModelCatalog(rpc, bannerTask?.hostId ?? null).then((result) => {
      if (!cancelled) setBannerModelCatalog(result);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bannerTask?.hostId]);

  const saveBannerModel = async (next: ModelSelectValue) => {
    if (!bannerTask) return;
    const { task: updated } = await rpc.call("updateTask", {
      taskId: bannerTask.id,
      patch: { providerId: next.providerId, model: next.model, reasoningLevel: next.reasoningLevel },
    });
    setBannerTask(updated);
  };

  if (!threadId || !session) return null;

  const extracted = nextStep(session);
  const suggested = suggestedNextFor(session);
  const gauge = contextGaugeText(session.contextUsage, session.contextWarnThreshold);
  const contextWarningDismissed = Boolean(uiState.contextWarningDismissed?.[threadId]);
  const contextWarn = Boolean(gauge?.warn);
  if (!shouldShowComposerBanner({ extracted, suggested, contextWarn, dismissed: contextWarningDismissed })) return null;

  const runIterate = async () => {
    try {
      const result = await rpc.call("iterateInFreshSession", { threadId });
      navigate.toThread(result.threadId);
    } catch (error) {
      reportLaunchError(error);
    }
  };
  const iterate = () => {
    if (settings?.showIterateConfirmation !== false) {
      setPendingIterateConfirm(true);
      return;
    }
    void runIterate();
  };

  return (
    <TooltipProvider delayDuration={300}>
    <div className="flex w-full flex-wrap items-center justify-end gap-2">
      {contextWarn && !contextWarningDismissed ? (
        <span className="inline-flex h-7 items-center gap-2 rounded-md border border-warning/40 bg-warning/10 px-2 text-xs text-warning">
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
      {bannerTask ? (
        <Popover>
          <Tooltip>
            <TooltipTrigger asChild>
              <PopoverTrigger asChild>
                <Button type="button" variant="outline" className="h-7 gap-1 px-2 text-xs">
                  <Icon name="ChevronDown" className="size-3.5" />
                  {truncateForBanner(bannerModelCatalog ? modelDisplay(bannerModelCatalog, bannerTask.providerId, bannerTask.model) : "Model")}
                </Button>
              </PopoverTrigger>
            </TooltipTrigger>
            <TooltipContent>Model for the next session</TooltipContent>
          </Tooltip>
          <PopoverContent className="w-72">
            <ModelSelect
              hostId={bannerTask.hostId}
              value={{ providerId: bannerTask.providerId, model: bannerTask.model, reasoningLevel: bannerTask.reasoningLevel }}
              onChange={(next) => void saveBannerModel(next)}
              allowDefault
              size="sm"
              label="Model"
            />
          </PopoverContent>
        </Popover>
      ) : null}
      <ConfirmDialog
        open={pendingIterateConfirm}
        onOpenChange={setPendingIterateConfirm}
        title="Start a fresh session?"
        description="The current session keeps running."
        confirmLabel="Iterate"
        onConfirm={runIterate}
      />
    </div>
    </TooltipProvider>
  );
}

function splitAttentionPrefix(text: string): [string | null, string] {
  const separatorIndex = text.indexOf(": ");
  if (separatorIndex === -1) return [null, text];
  return [text.slice(0, separatorIndex), text.slice(separatorIndex + 2)];
}

function needsYouEmptyMessage(runningCount: number, hasTasks: boolean): string {
  if (runningCount > 0) return `Nothing needs you. ${plural(runningCount, "session")} running.`;
  if (!hasTasks) return "Nothing needs you. Create a task to start.";
  return "Nothing needs you.";
}

// One band row, same contract as the task and session rows: the row takes pointer clicks, the
// task name is the keyboard control (RowLink), the status pill is a focusable hint, and a failed or
// lost session carries its recovery actions right here (Start fresh, Dismiss) so the copy "or
// start fresh" always has the control it names. The visual "Open" is a styled span, not a second
// button (PRODUCT.md #3: one control per decision).
function NeedsYouRow({
  session,
  task,
  compact,
  onOpen,
  onDismiss,
}: {
  session: SessionView;
  task: TaskRow;
  compact: boolean;
  onOpen: () => void;
  onDismiss: (threadId: string) => void;
}) {
  const meta = statusMeta(session.rpiStatus);
  const [prefix, rest] = splitAttentionPrefix(attentionText(session));
  const tint = session.rpiStatus === "ready_for_input" ? "bg-attention/5" : undefined;
  const danger = session.rpiStatus === "failed" || session.rpiStatus === "lost";
  const openAffordance = (className: string, children: ReactNode) => (
    <Button asChild variant="outline" className={cn("pointer-events-none shrink-0", className)} aria-hidden>
      <span>{children}</span>
    </Button>
  );
  const textCell = (
    <>
      {prefix ? <span className="text-muted-foreground">{prefix}: </span> : null}
      {rest}
    </>
  );
  const metaLine = (
    <>
      {labelStep(session.label) ?? session.label ?? "session"} · {relativeTime(session.threadUpdatedAt ?? session.updatedAt)}
    </>
  );
  if (compact) {
    return (
      <div onClick={onOpen} className={cn("flex flex-col gap-1.5 px-3.5 py-2.5", CLICKABLE_ROW_CLASS, tint)}>
        <div className="flex items-center gap-2">
          <StatusPill tone={meta.tone} label={meta.text} icon={meta.icon} hint={meta.hint || undefined} />
          <RowLink onOpen={onOpen} className="min-w-0 flex-1 truncate text-sm">{task.name}</RowLink>
          {danger ? null : openAffordance("h-9 w-9 p-0", <Icon name="ArrowUpRight" className="size-4" />)}
        </div>
        <div className="text-xs text-muted-foreground">{metaLine}</div>
        <div className="text-sm text-foreground">{textCell}</div>
        {danger ? <SessionRecoveryActions threadId={session.threadId} onDismiss={onDismiss} className="pt-1" /> : null}
      </div>
    );
  }
  return (
    <div onClick={onOpen} className={cn("flex items-center gap-3.5 px-3.5 py-2.5", CLICKABLE_ROW_CLASS, tint)}>
      <span className="flex w-[118px] shrink-0">
        <StatusPill tone={meta.tone} label={meta.text} icon={meta.icon} hint={meta.hint || undefined} />
      </span>
      <span className="flex w-[260px] shrink-0 flex-col items-start gap-0.5">
        <RowLink onOpen={onOpen} className="truncate text-sm">{task.name}</RowLink>
        <span className="text-xs text-muted-foreground">{metaLine}</span>
      </span>
      <span className="min-w-0 flex-1 truncate text-sm">{textCell}</span>
      {danger ? (
        <SessionRecoveryActions threadId={session.threadId} onDismiss={onDismiss} />
      ) : (
        openAffordance("h-8", <>Open<Icon name="ArrowUpRight" className="size-3.5" /></>)
      )}
    </div>
  );
}

// The panel's inbox: sessions that need the human, ranked by urgency (attentionQueue, status.ts),
// above the task table (PRODUCT.md #1: the panel is an inbox before it is a tracker). Capped to 8
// rows by default (a "Show N more"/"Show fewer" toggle reveals the rest) so a task with dozens of
// waiting sessions does not push the task table off screen.
const NEEDS_YOU_BAND_CAP = 8;

function NeedsYouBand({
  queue,
  runningCount,
  hasTasks,
  compact,
  onOpen,
}: {
  queue: Array<{ session: SessionView; task: TaskRow }>;
  runningCount: number;
  hasTasks: boolean;
  compact: boolean;
  onOpen: (threadId: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const archive = useArchiveThread(DISMISS_SESSION_COPY);
  const visible = expanded ? queue : queue.slice(0, NEEDS_YOU_BAND_CAP);
  const hiddenCount = queue.length - visible.length;
  return (
    <div className="space-y-2">
      {archive.dialog}
      <div className="flex items-baseline justify-between gap-3 px-1">
        <div className="flex items-baseline gap-2 whitespace-nowrap">
          <h2 className="whitespace-nowrap text-sm font-semibold text-foreground">Needs you</h2>
          <span className={cn("whitespace-nowrap text-sm font-semibold", queue.length > 0 ? "text-attention" : "text-muted-foreground")}>{queue.length}</span>
        </div>
        <span className="truncate text-xs text-muted-foreground">
          {compact ? `${runningCount} running` : `${plural(runningCount, "session")} running.${queue.length > 0 ? " Press N to open the first item." : ""}`}
        </span>
      </div>
      {queue.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border px-4 py-3 text-sm text-muted-foreground">
          {needsYouEmptyMessage(runningCount, hasTasks)}
        </div>
      ) : (
        <div className="divide-y divide-border overflow-hidden rounded-xl border border-border">
          {visible.map((entry) => (
            <NeedsYouRow
              key={entry.session.threadId}
              session={entry.session}
              task={entry.task}
              compact={compact}
              onOpen={() => onOpen(entry.session.threadId)}
              onDismiss={archive.request}
            />
          ))}
          {hiddenCount > 0 || expanded && queue.length > NEEDS_YOU_BAND_CAP ? (
            <button
              type="button"
              onClick={() => setExpanded((value) => !value)}
              className="block w-full px-3.5 py-2 text-center text-xs font-medium text-muted-foreground hover:bg-state-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {expanded ? "Show fewer" : `Show ${hiddenCount} more`}
            </button>
          ) : null}
        </div>
      )}
    </div>
  );
}

// Tasks/Drafts heading with the sole List/Board toggle (the aside toggle and the header "LIST
// LIST" toggle are both gone; this is the only control left for it).
function TasksSectionHeader({
  title,
  count,
  boardMode,
  setBoardMode,
}: {
  title: string;
  count: number;
  boardMode: boolean;
  setBoardMode: (value: boolean) => void;
}) {
  return (
    <div className="flex items-baseline justify-between px-1">
      <div className="flex items-baseline gap-2">
        <h2 className="text-sm font-semibold text-foreground">{title}</h2>
        <span className="text-sm font-semibold text-muted-foreground">{count}</span>
      </div>
      <Segmented
        label="Task view"
        value={boardMode ? "board" : "list"}
        onChange={(next) => setBoardMode(next === "board")}
        options={[{ value: "list", label: "List" }, { value: "board", label: "Board" }]}
      />
    </div>
  );
}

export function RpiPanel({ subPath }: { subPath: string }) {
  const rpc = useRpc<RpcContract>();
  const navigate = useBbNavigate();
  const [tasks, setTasks] = useState<TaskRow[]>([]);
  const [sessions, setSessions] = useState<SessionView[]>([]);
  const [showBoard, setShowBoard] = useState(false);
  const [view, setView] = useState<"tasks" | "drafts" | "settings">("tasks");
  const [detailTaskId, setDetailTaskId] = useState<string | null>(null);
  const { projectId } = useBbContext();

  const refetch = () => {
    rpc.call("listTasks", { projectId: projectId ?? null, archived: false }).then(({ tasks: nextTasks }) => {
      setTasks(nextTasks);
    });
  };
  // Mirrors RpiThreadList's fetch: the same listSessions({taskId:null}) call, refetched on the
  // same two realtime channels tasks refetches on, so the Needs-you band and the task table never
  // drift apart.
  const refetchSessions = () => {
    rpc.call("listSessions", { taskId: null }).then(({ sessions: nextSessions }) => {
      setSessions(nextSessions);
    });
  };

  useEffect(() => {
    refetch();
    refetchSessions();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);
  useRealtime("tasks", refetch);
  useRealtime("tasks", refetchSessions);

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
    if (subPath === "drafts") {
      setView("drafts");
      return;
    }
    if (subPath === "settings") {
      setView("settings");
      return;
    }
    setView("tasks");
  }, [subPath]);
  useRealtime("rpi:sessions", refetch);
  useRealtime("rpi:sessions", refetchSessions);

  const showNewTaskPage = subPath === "new" && !detailTaskId;

  const visibleTasks = useMemo(() => {
    if (view === "drafts") return tasks.filter((task) => task.isDraft);
    return tasks;
  }, [tasks, view]);
  const draftCount = useMemo(() => tasks.filter((task) => task.isDraft).length, [tasks]);
  const queue = useMemo(() => attentionQueue(sessions, tasks), [sessions, tasks]);
  const runningCount = useMemo(
    () => sessions.filter((session) => session.rpiStatus === "running" || session.rpiStatus === "launching" || session.rpiStatus === "resuming").length,
    [sessions],
  );

  const onSwitch = (next: "tasks" | "drafts" | "settings") => {
    navigate.toPluginPanel("rpi", { subPath: next === "tasks" ? "" : next });
  };
  const onCreateTask = () => navigate.toPluginPanel("rpi", { subPath: "new" });

  // T (new task) and the g-then-t chord (go to tasks) while this panel has focus. Scoped to this
  // panel's own root element (`panelRootRef`), never `document`, so the key is only ever seen, and
  // only ever preventDefault-ed, while focus is inside this panel; `shouldHandleHotkey`'s
  // not-in-editable guard still applies so typing in the composer textarea never triggers either
  // one. Skips a combo that collides with the user's configured jump hotkey so it always wins.
  const jumpHotkey = useConfiguredJumpHotkey();
  const panelRootRef = useRef<HTMLDivElement | null>(null);
  const [panelWidth, setPanelWidthRoot] = useElementWidth();
  const awaitingTRef = useRef(false);
  const chordTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clearChordRef = useRef(() => {
    awaitingTRef.current = false;
    if (chordTimerRef.current) clearTimeout(chordTimerRef.current);
    chordTimerRef.current = null;
  });
  const compact = panelWidth > 0 && panelWidth < 560;
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
      onCreateTask();
      return;
    }
    if (shouldHandleHotkey(event, "n") && queue.length > 0) {
      event.preventDefault();
      navigate.toThread(queue[0]!.session.threadId);
    }
  }, [jumpHotkey, navigate, queue]);
  // Dispose the pending chord timer on unmount (task switch, panel close), same reasoning as the
  // scratch pad's debounce cleanup: an in-flight "g" wait must not leak a timer past the panel's
  // own lifetime.
  useEffect(() => clearChordRef.current, []);

  return (
    <TooltipProvider delayDuration={300}>
    <div
      ref={(node) => {
        panelRootRef.current = node;
        setPanelWidthRoot(node);
      }}
      className="flex h-full min-h-0 flex-col gap-4 overflow-hidden p-4"
    >
      <RpiNotificationBridge />
      <div className="flex items-center justify-between gap-3">
        <div role="tablist" onKeyDown={rovingKeyDown} className="flex gap-1 rounded-md border border-border p-1">
          {([
            { id: "tasks", label: <>Tasks</> },
            { id: "drafts", label: <>Drafts <span className="text-muted-foreground">{draftCount}</span></> },
            { id: "settings", label: <>Settings</> },
          ] as const).map((entry) => (
            <button
              key={entry.id}
              type="button"
              role="tab"
              aria-selected={view === entry.id}
              aria-controls="rpi-panel-content"
              tabIndex={view === entry.id ? 0 : -1}
              onClick={() => onSwitch(entry.id)}
              className={tabClass(view === entry.id)}
            >
              {entry.label}
            </button>
          ))}
        </div>
        {compact ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button type="button" onClick={onCreateTask} size="icon" className="size-9" aria-label="Create task">
                <Icon name="Plus" className="size-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Create task (T)</TooltipContent>
          </Tooltip>
        ) : (
          <Button type="button" onClick={onCreateTask} className="h-9 text-sm font-medium">
            <Icon name="Plus" className="size-4" />
            Create task
            <span className="ml-1 rounded bg-background/10 px-1.5 py-0.5 text-xs font-semibold">T</span>
          </Button>
        )}
      </div>

      <main id="rpi-panel-content" className="flex min-h-0 flex-1 flex-col overflow-auto rounded-2xl border border-border bg-background/80 p-4">
        {detailTaskId ? (
          <TaskDetailPage taskId={detailTaskId} artifactFileName={/^tasks\/[^/]+\/artifacts\/(.+)$/.exec(subPath)?.[1] ? decodeURIComponent(/^tasks\/[^/]+\/artifacts\/(.+)$/.exec(subPath)![1]!) : null} />
        ) : showNewTaskPage ? (
          <NewTaskPage tasks={tasks} />
        ) : view === "settings" ? (
          <RpiDefaultsSettings />
        ) : (
          <div className="space-y-5">
            {view === "tasks" ? (
              <NeedsYouBand
                queue={queue}
                runningCount={runningCount}
                hasTasks={tasks.length > 0}
                compact={compact}
                onOpen={(threadId) => navigate.toThread(threadId)}
              />
            ) : null}
            <div className="space-y-3">
              <TasksSectionHeader
                title={view === "drafts" ? "Drafts" : "Tasks"}
                count={visibleTasks.length}
                boardMode={showBoard}
                setBoardMode={setShowBoard}
              />
              <TaskListView tasks={visibleTasks} boardMode={showBoard} compact={compact} boardWidth={panelWidth} />
            </div>
          </div>
        )}
      </main>
    </div>
    </TooltipProvider>
  );
}
