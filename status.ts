// Status vocabulary for sessions and tasks: one table (statusMeta) backing status pills, row
// shading, and icon-only glyphs everywhere the UI shows a session's rpiStatus, plus the queue and
// phase-progress derivations that decide what the panel puts in front of the human first.
//
// Product principle (PRODUCT.md #2): a session waiting for its human (ready_for_input) is the
// normal state, not a failure, so it gets its own "attention" tone distinct from "danger". Danger
// stays reserved for failed/lost.

export type StatusTone = "attention" | "warning" | "active" | "danger" | "muted" | "success";

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
function nextStepSummary(nextStepJson: string | null): string | null {
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

export function attentionQueue<
  S extends { rpiStatus: string; taskId: string; updatedAt: number; threadUpdatedAt: number | null },
  T extends { id: string; archived: boolean },
>(sessions: S[], tasks: T[]): Array<{ session: S; task: T }> {
  const taskById = new Map(tasks.map((task) => [task.id, task]));
  const entries: Array<{ session: S; task: T }> = [];
  for (const session of sessions) {
    if (!needsHuman(session.rpiStatus)) continue;
    const task = taskById.get(session.taskId);
    if (!task || task.archived) continue;
    entries.push({ session, task });
  }
  entries.sort((a, b) => {
    const rankDiff = attentionRank(a.session.rpiStatus) - attentionRank(b.session.rpiStatus);
    if (rankDiff !== 0) return rankDiff;
    const aTime = a.session.threadUpdatedAt ?? a.session.updatedAt;
    const bTime = b.session.threadUpdatedAt ?? b.session.updatedAt;
    return bTime - aTime;
  });
  return entries;
}

export type PhaseWorkflowType = "rpi" | "outline_only" | "prd_tdd" | "oneshot" | "freeform";
export type PhaseWorktreeTiming = "now" | "later" | "never";

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
};

export function phaseProgress(input: {
  workflowType: PhaseWorkflowType;
  worktreeTiming: PhaseWorktreeTiming;
  currentLabel: string | null;
  sessions: Array<{ label: string | null; rpiStatus: string }>;
}): PhaseProgressEntry[] {
  const steps = workflowSteps(input.workflowType, input.worktreeTiming);
  const currentStep = labelStep(input.currentLabel);
  const currentIndex = steps.findIndex((step) => step === currentStep);
  return steps.map((step, index) => {
    const inStep = input.sessions.filter((session) => labelStep(session.label) === step);
    const count = inStep.length;
    const needsHumanCount = inStep.filter((session) => needsHuman(session.rpiStatus)).length;
    let tone: StatusTone | null = null;
    if (count > 0) {
      for (const candidate of TONE_ORDER) {
        if (inStep.some((session) => statusMeta(session.rpiStatus).tone === candidate)) {
          tone = candidate;
          break;
        }
      }
    }
    const state: "done" | "current" | "future" =
      currentIndex === -1 ? "future" : index < currentIndex ? "done" : index === currentIndex ? "current" : "future";
    return { step, state, count, tone, needsHuman: needsHumanCount };
  });
}
