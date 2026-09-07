// Status vocabulary for sessions and tasks: one table (statusMeta) backing status pills, row
// shading, and icon-only glyphs everywhere the UI shows a session's rpiStatus, plus the queue and
// phase-progress derivations that decide what the panel puts in front of the human first.
//
// Product principle (PRODUCT.md #2): a session waiting for its human (ready_for_input) is the
// normal state, not a failure, so it gets its own "attention" tone distinct from "danger". Danger
// stays reserved for failed/lost.

export type StatusTone = "attention" | "warning" | "active" | "danger" | "muted" | "success";

// A rpiStatus value that only ever exists in the display layer (statusMeta/effectiveStatus),
// never persisted and never something deriveStatus produces: a session that finished its turn
// (ready_for_input/failed/lost/interrupted) whose task has since moved on. See effectiveStatus.
export const SUPERSEDED = "superseded" as const;

// Most urgent first; used by phaseProgress to pick the worst tone among a step's sessions.
export const TONE_ORDER: StatusTone[] = ["danger", "warning", "attention", "active", "success", "muted"];

export type StatusIcon =
  | "MessageSquare"
  | "AlertTriangle"
  | "Loading"
  | "Spinner"
  | "AlertCircle"
  | "CircleX"
  | "CircleCheck"
  | "Circle";

export type StatusMeta = { text: string; tone: StatusTone; icon: StatusIcon; hint: string };

function capitalize(text: string): string {
  return text.length === 0 ? text : text[0]!.toUpperCase() + text.slice(1);
}

export function statusMeta(status: string): StatusMeta {
  switch (status) {
    case "ready_for_input":
      return {
        text: "Needs you",
        tone: "attention",
        icon: "MessageSquare",
        hint: "The agent finished its turn and is waiting for you. Open the session to reply, approve the next step, or iterate.",
      };
    case "needs_approval":
      return {
        text: "Approve",
        tone: "warning",
        icon: "AlertTriangle",
        hint: "The agent asked for permission to run something. Open the session to allow or deny.",
      };
    case "running":
      return { text: "Running", tone: "active", icon: "Loading", hint: "The agent is working. Nothing to do yet." };
    case "launching":
      return { text: "Starting", tone: "active", icon: "Spinner", hint: "bb is starting the session." };
    case "resuming":
      return { text: "Resuming", tone: "active", icon: "Spinner", hint: "bb is resuming the session." };
    case "failed":
      return {
        text: "Failed",
        tone: "danger",
        icon: "AlertCircle",
        hint: "The session hit an error. Open it to read the error, or retry it from Launch attempts.",
      };
    case "lost":
      return {
        text: "Lost",
        tone: "danger",
        icon: "AlertCircle",
        hint: "bb no longer reports this thread. Open it to check, or start a fresh session.",
      };
    case "interrupted":
      return { text: "Stopped", tone: "muted", icon: "CircleX", hint: "You stopped this session. Fork or iterate to continue." };
    case "interrupt_requested":
      return { text: "Stopping", tone: "muted", icon: "CircleX", hint: "Stop requested; waiting for the agent to yield." };
    case SUPERSEDED:
      return {
        text: "Done",
        tone: "muted",
        icon: "CircleCheck",
        hint: "This session finished and a later session took over the task.",
      };
    default: {
      const text = capitalize(status.replaceAll("_", " "));
      const icon: StatusIcon = /complet|settled|done/.test(status) ? "CircleCheck" : "Circle";
      return { text, tone: "muted", icon, hint: "" };
    }
  }
}

export function needsHuman(status: string): boolean {
  return status === "ready_for_input" || status === "needs_approval" || status === "failed" || status === "lost";
}

// Parses the same nextStepJson shape transitions.ts's parseNextStepExtraction reads
// (extraction.ts's NextStepSuggestions, persisted as text), but keeps nextStepSummary: the
// canonical parser (transitions.ts) only surfaces type/nextStepType for the suggested-next
// comparison, so attentionText parses the JSON itself rather than losing the summary through it.
export function nextStepSummary(nextStepJson: string | null): string | null {
  if (!nextStepJson) return null;
  try {
    const parsed = JSON.parse(nextStepJson) as { extraction?: { type?: string; nextStepSummary?: string } };
    if (parsed.extraction?.type === "next_step_found" && parsed.extraction.nextStepSummary?.trim()) {
      return parsed.extraction.nextStepSummary;
    }
    return null;
  } catch {
    return null;
  }
}

export function attentionText(session: {
  rpiStatus: string;
  blockedReason: "question" | "plugin" | null;
  nextStepJson: string | null;
  ingestError: string | null;
}): string {
  if (session.rpiStatus === "needs_approval") {
    return session.blockedReason === "question" ? "Asked you a question" : "Waiting for permission to continue";
  }
  if (session.rpiStatus === "ready_for_input") {
    const summary = nextStepSummary(session.nextStepJson);
    return summary ? `Next: ${summary}` : "Finished its turn. Open to continue.";
  }
  if (session.rpiStatus === "failed" || session.rpiStatus === "lost") {
    const trimmed = session.ingestError?.trim();
    return trimmed ? trimmed : "The session failed. Open it to see why, or retry.";
  }
  return "";
}

function attentionRank(status: string): number {
  if (status === "needs_approval") return 0;
  if (status === "failed" || status === "lost") return 1;
  return 2; // ready_for_input
}

export type PhaseWorkflowType = "rpi" | "outline_only" | "prd_tdd" | "oneshot" | "freeform";
export type PhaseWorktreeTiming = "now" | "later" | "never";

// Minimal session/task shapes effectiveStatus needs; every caller (attentionQueue, phaseProgress,
// attentionCountForTask, the UI's session table and thread list) extends these.
type EffectiveStatusSession = {
  threadId: string;
  label: string | null;
  rpiStatus: string;
  createdAt: number;
  advancedAt: number | null;
};
type EffectiveStatusTask = { workflowType: PhaseWorkflowType; worktreeTiming: PhaseWorktreeTiming };

// Statuses that describe a session actively in play (still working, or still the thing blocking
// the human); these are never superseded no matter what launched after them.
const NEVER_SUPERSEDED = new Set(["needs_approval", "running", "launching", "resuming", "interrupt_requested"]);

// Live finding (phase B.1): deriveStatus/rpiStatus never expire a settled turn, so a
// ready_for_input/failed/lost/interrupted session from a phase whose successor already ran stays
// "waiting" forever and over-counts the needs-you band. This is a pure display-level correction:
// it never changes rpiStatus or deriveStatus, only what the UI (and the server's attention count)
// treats as still needing the human. A session is superseded when either the task's transitions.ts
// advance path already moved past it (advancedAt set), or a newer session in the same step or a
// later step in the workflow graph exists (the task moved on without a formal advance, e.g. a
// manual iterate/fork into the next phase).
export function effectiveStatus<S extends EffectiveStatusSession>(
  session: S,
  taskSessions: S[],
  task: EffectiveStatusTask,
): string {
  if (NEVER_SUPERSEDED.has(session.rpiStatus)) return session.rpiStatus;
  if (session.advancedAt !== null) return SUPERSEDED;
  const sessionStep = labelStep(session.label);
  const sessionIndex = stepIndex(session.label, task.workflowType, task.worktreeTiming);
  const supersededBy = taskSessions.some((other) => {
    if (other.threadId === session.threadId) return false;
    if (other.createdAt <= session.createdAt) return false;
    if (other.label === null) return false; // a side fork/freeform helper never supersedes
    if (labelStep(other.label) === sessionStep) return true;
    const otherIndex = stepIndex(other.label, task.workflowType, task.worktreeTiming);
    return sessionIndex >= 0 && otherIndex >= 0 && otherIndex > sessionIndex;
  });
  return supersededBy ? SUPERSEDED : session.rpiStatus;
}

export function attentionCountForTask<S extends EffectiveStatusSession, T extends EffectiveStatusTask>(
  sessions: S[],
  task: T,
): number {
  return sessions.filter((session) => needsHuman(effectiveStatus(session, sessions, task))).length;
}

export function attentionQueue<
  S extends EffectiveStatusSession & { taskId: string; updatedAt: number; threadUpdatedAt: number | null },
  T extends EffectiveStatusTask & { id: string; archived: boolean },
>(sessions: S[], tasks: T[]): Array<{ session: S; task: T; status: string }> {
  const taskById = new Map(tasks.map((task) => [task.id, task]));
  const sessionsByTask = new Map<string, S[]>();
  for (const session of sessions) {
    const list = sessionsByTask.get(session.taskId);
    if (list) list.push(session);
    else sessionsByTask.set(session.taskId, [session]);
  }
  const entries: Array<{ session: S; task: T; status: string }> = [];
  for (const session of sessions) {
    const task = taskById.get(session.taskId);
    if (!task || task.archived) continue;
    const status = effectiveStatus(session, sessionsByTask.get(session.taskId) ?? [session], task);
    if (!needsHuman(status)) continue;
    entries.push({ session, task, status });
  }
  entries.sort((a, b) => {
    const rankDiff = attentionRank(a.status) - attentionRank(b.status);
    if (rankDiff !== 0) return rankDiff;
    const aTime = a.session.threadUpdatedAt ?? a.session.updatedAt;
    const bTime = b.session.threadUpdatedAt ?? b.session.updatedAt;
    return bTime - aTime;
  });
  return entries;
}

// Ordered step list for a workflow/worktree-timing combination (moved out of WorkflowStrip so the
// panel's phase strips and the task detail workflow strip share one derivation).
export function workflowSteps(workflowType: PhaseWorkflowType, worktreeTiming: PhaseWorktreeTiming): string[] {
  const baseSteps =
    workflowType === "rpi"
      ? ["questions", "research", "design", "plan", "implementation", "PR"]
      : workflowType === "outline_only"
        ? ["questions", "research", "structure", "implementation", "PR"]
        : workflowType === "prd_tdd"
          ? ["research", "PRD", "TDD", "plan", "implementation", "PR"]
          : ["single session"];
  return worktreeTiming === "never" || baseSteps[0] === "single session"
    ? baseSteps
    : worktreeTiming === "now"
      ? ["worktree", ...baseSteps]
      : [...baseSteps.slice(0, Math.max(0, baseSteps.indexOf("implementation"))), "worktree", ...baseSteps.slice(Math.max(0, baseSteps.indexOf("implementation")))];
}

// Index of a session's step in its workflow's step order, or -1 for a null/unrecognized label;
// effectiveStatus uses this to tell "a newer session in a later phase" from "a newer session in an
// earlier or unrelated phase".
export function stepIndex(label: string | null | undefined, workflowType: PhaseWorkflowType, worktreeTiming: PhaseWorktreeTiming): number {
  const step = labelStep(label);
  if (step === null) return -1;
  return workflowSteps(workflowType, worktreeTiming).indexOf(step);
}

export function labelStep(label: string | null | undefined): string | null {
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

export type PhaseProgressEntry = {
  step: string;
  state: "done" | "current" | "future";
  count: number;
  tone: StatusTone | null;
  needsHuman: number;
  live: number;
};

export function phaseProgress(input: {
  workflowType: PhaseWorkflowType;
  worktreeTiming: PhaseWorktreeTiming;
  currentLabel: string | null;
  sessions: EffectiveStatusSession[];
}): PhaseProgressEntry[] {
  const steps = workflowSteps(input.workflowType, input.worktreeTiming);
  const currentStep = labelStep(input.currentLabel);
  const currentIndex = steps.findIndex((step) => step === currentStep);
  const task: EffectiveStatusTask = { workflowType: input.workflowType, worktreeTiming: input.worktreeTiming };
  return steps.map((step, index) => {
    const inStep = input.sessions.filter((session) => labelStep(session.label) === step);
    const count = inStep.length;
    const effectiveStatuses = inStep.map((session) => effectiveStatus(session, input.sessions, task));
    const needsHumanCount = effectiveStatuses.filter((status) => needsHuman(status)).length;
    const live = effectiveStatuses.filter((status) => status !== SUPERSEDED).length;
    let tone: StatusTone | null = null;
    if (count > 0) {
      for (const candidate of TONE_ORDER) {
        if (effectiveStatuses.some((status) => statusMeta(status).tone === candidate)) {
          tone = candidate;
          break;
        }
      }
    }
    const state: "done" | "current" | "future" =
      currentIndex === -1 ? "future" : index < currentIndex ? "done" : index === currentIndex ? "current" : "future";
    return { step, state, count, tone, needsHuman: needsHumanCount, live };
  });
}

// One-sentence description per phase-strip step, keyed by the same normalized step name
// workflowSteps/labelStep produce; covers every step that appears in any WORKFLOW_GRAPHS entry
// (transitions.ts), asserted by tests/status.test.ts.
export const PHASE_DESCRIPTIONS: Record<string, string> = {
  questions: "Turns the task description into the questions research must answer.",
  research: "Answers the research questions from the codebase and documentation.",
  design: "Weighs options and records decisions before planning.",
  plan: "Writes the step-by-step implementation plan with verification.",
  worktree: "Creates the branch and directory implementation will use.",
  implementation: "Executes the plan in the task's worktree, committing as it goes.",
  PR: "Writes the pull request description for review.",
  structure: "Outlines the code structure before implementation.",
  PRD: "Writes the product requirements document.",
  TDD: "Writes the technical design document.",
  "single session": "One session does the whole task.",
};
