import { useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import {
  Markdown,
  experimental_SourceCode as SourceCode,
  useBbContext,
  useBbNavigate,
  useRealtime,
  useRpc,
  useSettings,
} from "@get-bb/plugin-sdk/app";
import type {
  ArtifactRecord,
  ArtifactVersionRecord,
  LaunchAttemptRecord,
  RpcContract,
  SessionView,
  TaskRecord,
  TaskRow,
  TaskWorkspaceState,
} from "../contract";
import { BOARD_COLUMNS, WORKFLOW_GRAPH_LABELS, WORKFLOW_GRAPHS } from "../transitions";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

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
      return { text: "idle", icon: "Circle" as const, className: "text-destructive" };
    case "needs_approval":
      return { text: "needs approval", icon: "AlertTriangle" as const, className: "text-foreground" };
    case "running":
      return { text: "running", icon: "Loading" as const, className: "text-foreground" };
    case "launching":
    case "resuming":
      return { text: status.replaceAll("_", " "), icon: "Spinner" as const, className: "text-foreground" };
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
              onClick={() => navigate.toPluginPanel("humanlayer", { subPath: `tasks/${task.id}` })}
            >
              <td className="px-4 py-3">
                <div className="flex flex-col gap-1">
                  <span className="font-medium text-foreground">{task.name}</span>
                  <span className="text-xs text-muted-foreground">{task.slug}</span>
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
                onClick={() => navigate.toPluginPanel("humanlayer", { subPath: `tasks/${task.id}` })}
                className="cursor-pointer rounded-lg border border-border bg-background/70 p-3 transition hover:border-foreground/40"
              >
                <div className="space-y-2">
                  <div className="flex items-start justify-between gap-3">
                    <h4 className="font-medium leading-tight text-foreground">{task.name}</h4>
                    <span className="text-xs text-muted-foreground">{relativeTime(task.updatedAt)}</span>
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
}: {
  workflowType: "rpi" | "prd_tdd" | "oneshot" | "freeform";
  worktreeTiming: "now" | "later" | "never";
}) {
  const steps =
    workflowType === "rpi"
      ? ["worktree", "questions", "research", "design", "outline", "implement", "PR"]
      : workflowType === "prd_tdd"
        ? ["research", "PRD", "TDD", "outline", "implement", "PR"]
        : ["single session"];
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
          const dashed = step === "worktree" && worktreeTiming !== "never";
          return (
            <span
              key={`${step}-${index}`}
              className={cn(
                "inline-flex min-w-[92px] items-center justify-center rounded-md border px-3 py-2 text-sm font-medium",
                dashed ? "border-dashed border-border text-muted-foreground" : "border-border text-foreground",
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
  const [workflowType, setWorkflowType] = useState<"rpi" | "prd_tdd" | "oneshot" | "freeform">("rpi");
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
  const canLaunch = (workflowType === "freeform" || workflowType === "oneshot") && worktreeTiming === "never";
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
    if (busy || projectId === "" || text.trim() === "" || !canLaunch) return;
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
          Save the draft now. Sessions launch in a later release.
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
              onChange={(value) => setWorkflowType(value as "rpi" | "prd_tdd" | "oneshot" | "freeform")}
              options={[
                { value: "rpi", label: "RPI" },
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
                disabled={busy || text.trim() === "" || projectId === "" || !canLaunch}
                title={canLaunch ? "Create and launch" : "This phase launches only freeform or oneshot tasks without a worktree"}
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
                onClick={() => navigate.toPluginPanel("humanlayer", { subPath: "tasks" })}
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

  const resolve = async (action: { type: "adopt"; threadId: string } | { type: "retry" } | { type: "dismiss" }) => {
    if (busy) return;
    setBusy(true);
    try {
      await rpc.call("resolveLaunchAttempt", { id: attempt.id, action });
      onResolved();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-lg border border-border bg-card/70 p-3">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="space-y-1">
          <div className="text-sm font-medium text-foreground">{isPending ? "Launching..." : "Recover launch"}</div>
          <div className="text-xs text-muted-foreground">{attempt.id}</div>
        </div>
        <span className={pillClassName("ghost")}>{isPending ? "launching..." : "uncertain"}</span>
      </div>
      {isPending ? null : (
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
              <td className="px-4 py-3"><SessionStatus status={session.hlStatus} /></td>
              <td className="px-4 py-3">
                <div className="flex flex-col gap-1">
                  <span className="font-medium text-foreground">{session.title ?? session.threadId}</span>
                  {session.blockedReason ? <span className="text-xs text-muted-foreground">blocked: {session.blockedReason}</span> : null}
                </div>
              </td>
              <td className="px-4 py-3">{session.label ? <span className={pillClassName("step")}>{session.label}</span> : <span className={pillClassName("ghost")}>none</span>}</td>
              <td className="max-w-[320px] truncate px-4 py-3 text-muted-foreground">{session.workingDirectory ?? "unknown"}</td>
              <td className="px-4 py-3 text-muted-foreground">{relativeTime(session.threadUpdatedAt ?? session.updatedAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
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
  const path = `/plugins/humanlayer/tasks/${encodeURIComponent(artifact.taskId)}/artifacts/${encodeURIComponent(artifact.fileName)}`;
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
  const [mode, setMode] = useState<"preview" | "raw">("preview");
  const [artifact, setArtifact] = useState<ArtifactRecord | null>(null);
  const [versions, setVersions] = useState<ArtifactVersionRecord[]>([]);
  const [version, setVersion] = useState<number | null>(null);
  const [pinnedVersion, setPinnedVersion] = useState<number | null>(null);
  const [content, setContent] = useState<string | null>(null);
  const [isBinary, setIsBinary] = useState(false);
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    setVersion(null);
    setPinnedVersion(null);
  }, [taskId, fileName]);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      rpc.call("listArtifactVersions", { taskId, fileName }),
      rpc.call("getArtifact", { taskId, fileName, version: pinnedVersion }),
    ]).then(([versionResult, artifactResult]) => {
      if (cancelled) return;
      setVersions(versionResult.versions);
      setArtifact(artifactResult.artifact);
      setContent(artifactResult.content);
      setIsBinary(artifactResult.isBinary);
      setUrl(artifactResult.url);
      setVersion(artifactResult.version?.version ?? null);
    });
    return () => {
      cancelled = true;
    };
  }, [fileName, taskId, pinnedVersion, rpc]);
  useRealtime("hl:artifacts", (payload) => {
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
    });
  });

  if (!artifact) return <div className="rounded-md border border-dashed border-border p-4 text-sm text-muted-foreground">Select an artifact.</div>;

  const versionMeta = versions.find((item) => item.version === version);
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
      <div className="min-h-[260px] flex-1 overflow-auto rounded-md border border-border bg-background p-3">
        {mode === "preview" && isRasterPreview(artifact.contentType) && url ? (
          <img src={url} alt={artifact.fileName} className="max-h-full max-w-full rounded-md" />
        ) : mode === "preview" && isSandboxedPreview(artifact.contentType) && content !== null ? (
          <iframe title={artifact.fileName} sandbox="" srcDoc={content} className="h-full min-h-[240px] w-full rounded-md border-0 bg-background" />
        ) : mode === "preview" && !isBinary && content !== null ? (
          <Markdown content={content} />
        ) : isBinary ? (
          <div className="text-sm text-muted-foreground">Binary preview is available through the HTTP route.</div>
        ) : (
          <SourceCode content={content ?? ""} path={artifact.fileName} overflow="wrap" />
        )}
      </div>
    </div>
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
  useRealtime("hl:artifacts", refetch);

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
  const [tab, setTab] = useState<"sessions" | "artifacts">(artifactFileName ? "artifacts" : "sessions");

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
  }, [taskId]);
  useEffect(() => {
    if (artifactFileName) setTab("artifacts");
  }, [artifactFileName]);
  useRealtime("tasks", refetch);
  useRealtime("hl:sessions", refetch);

  if (!task || !workspace) {
    return <div className="p-4 text-sm text-muted-foreground">Loading...</div>;
  }

  const visibleAttempts = workspace.launchAttempts.filter((attempt) => attempt.status === "pending" || attempt.status === "uncertain");

  return (
    <div className="space-y-4">
      <button
        type="button"
        onClick={() => navigate.toPluginPanel("humanlayer", { subPath: "" })}
        className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
      >
        <Icon name="ChevronLeft" className="size-4" />
        Tasks
      </button>
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
              const result = await rpc.call("launchDraft", { taskId });
              navigate.toThread(result.threadId);
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
      </div>
      {tab === "artifacts" ? (
        <div className="min-h-[520px]">
          <ArtifactsPanel taskId={taskId} initialFileName={artifactFileName} />
        </div>
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

export function HumanLayerArtifactThreadPanel({ threadId, params }: { threadId: string; params?: unknown }) {
  const rpc = useRpc<RpcContract>();
  const [session, setSession] = useState<SessionView | null | undefined>(undefined);
  const initialFileName = typeof params === "object" && params !== null && "fileName" in params ? String((params as { fileName?: unknown }).fileName ?? "") : null;

  useEffect(() => {
    rpc.call("getSession", { threadId }).then(({ session: next }) => setSession(next));
  }, [rpc, threadId]);

  if (session === undefined) return <div className="p-4 text-sm text-muted-foreground">Loading...</div>;
  if (!session) return <div className="p-4 text-sm text-muted-foreground">Not a HumanLayer task session</div>;
  return (
    <div className="h-full min-h-0 p-3">
      <ArtifactsPanel taskId={session.taskId} initialFileName={initialFileName} />
    </div>
  );
}

export function HumanLayerArtifactDirective({ attributes, source }: { attributes: Readonly<Record<string, string>>; source: string }) {
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
    if (!accepted) navigate.toPluginPanel("humanlayer", { subPath: `tasks/${taskId}/artifacts/${encodeURIComponent(fileName)}` });
  };
  return (
    <button type="button" onClick={open} className="inline-flex items-center gap-2 rounded-md border border-border bg-card px-2 py-1 text-sm font-medium text-foreground">
      <Icon name="Code" className="size-4" />
      {fileName}
    </button>
  );
}

export const viewing = new Set<string>();

export function HumanLayerThreadHeaderAction({ threadId }: { threadId: string; projectId: string; isCompactViewport: boolean }) {
  const rpc = useRpc<RpcContract>();
  const navigate = useBbNavigate();
  const [session, setSession] = useState<SessionView | null>(null);

  const refetch = () => {
    rpc.call("getSession", { threadId }).then(({ session: next }) => setSession(next));
  };

  useEffect(() => {
    viewing.add(threadId);
    refetch();
    return () => {
      viewing.delete(threadId);
    };
  }, [threadId]);
  useRealtime("hl:sessions", refetch);

  if (!session) return null;

  return (
    <div className="flex items-center gap-2">
      <span className={pillClassName(session.label ? "step" : "ghost")}>{session.label ?? "freeform"}</span>
      <SessionStatus status={session.hlStatus} />
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

export function HumanLayerPanel({ subPath }: { subPath: string }) {
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
  useRealtime("hl:sessions", refetch);

  const visibleTasks = useMemo(() => {
    if (view === "drafts") return tasks.filter((task) => task.isDraft);
    return tasks;
  }, [tasks, view]);

  const onSwitch = (next: "tasks" | "drafts" | "new") => {
    if (next === "new") {
      navigate.toPluginPanel("humanlayer", { subPath: "new" });
      return;
    }
    navigate.toPluginPanel("humanlayer", { subPath: next === "tasks" ? "" : "drafts" });
  };

  return (
    <div className="flex h-full min-h-0 flex-col gap-4 overflow-hidden p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold tracking-tight text-foreground">HumanLayer</h1>
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
