import { useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import { useBbContext, useBbNavigate, useRealtime, useRpc, useSettings } from "@get-bb/plugin-sdk/app";
import type { RpcContract, TaskRow } from "../contract";
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
    kind === "draft" && "border-border bg-card text-muted-foreground",
    kind === "step" && "border-emerald-600/50 bg-emerald-600/10 text-emerald-300",
    kind === "ghost" && "border-dashed border-border text-muted-foreground",
  );
}

function TaskStepPill({ task }: { task: TaskRow }) {
  const label = task.stepLabel;
  return <span className={pillClassName(task.isDraft ? "draft" : "step")}>{label}</span>;
}

function TaskTable({ tasks }: { tasks: TaskRow[] }) {
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
            <tr key={task.id} className="border-b border-border last:border-b-0">
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
              <article key={task.id} className="rounded-lg border border-border bg-background/70 p-3">
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
  workflowType: "rpi" | "prd_tdd" | "freeform";
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
  const [projectOptions, setProjectOptions] = useState<Array<{ id: string; name?: string | null; path?: string | null }>>([]);
  const [hostOptions, setHostOptions] = useState<Array<{ id: string; name?: string | null; directory?: string | null }>>([]);
  const [projectId, setProjectId] = useState(currentProjectId ?? "");
  const [hostId, setHostId] = useState("");
  const [defaultDirectory, setDefaultDirectory] = useState("");
  const [permissionMode, setPermissionMode] = useState("default");
  const [workflowType, setWorkflowType] = useState<"rpi" | "prd_tdd" | "freeform">("rpi");
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
      setProjectOptions(projects as Array<{ id: string; name?: string | null; path?: string | null }>);
      setHostOptions(hosts as Array<{ id: string; name?: string | null; directory?: string | null }>);
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
    setPermissionMode(settings.defaultPermissionMode ?? "default");
    setWorkflowType((settings.defaultWorkflowType as "rpi" | "prd_tdd" | "freeform" | undefined) ?? "rpi");
    setWorktreeTiming((settings.defaultWorktreeTiming as "now" | "later" | "never" | undefined) ?? "later");
    setAutoAdvance(Boolean(settings.autoAdvanceDefault ?? false));
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
          permissionMode: permissionMode as "default" | "accept_edits" | "auto" | "bypass",
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

  const projectLabel = (projectId && projectOptions.find((project) => project.id === projectId)?.name) ||
    (projectId && projectOptions.find((project) => project.id === projectId)?.path) ||
    (projectId || "Select project");
  const hostLabel = (hostId && hostOptions.find((host) => host.id === hostId)?.name) ||
    (hostId && hostOptions.find((host) => host.id === hostId)?.directory) ||
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
              onChange={setPermissionMode}
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
                autoAdvance ? "border-emerald-500/60 bg-emerald-500/10 text-emerald-200" : "border-border bg-card text-muted-foreground",
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
                label: host.name ?? host.directory ?? host.id,
              }))}
            />
            <ComposerToolbarSelect
              value={projectId}
              onChange={setProjectId}
              options={projectOptions.map((project) => ({
                value: project.id,
                label: project.name ?? project.path ?? project.id,
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
              onChange={(value) => setWorkflowType(value as "rpi" | "prd_tdd" | "freeform")}
              options={[
                { value: "rpi", label: "RPI" },
                { value: "prd_tdd", label: "PRD / TDD" },
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
                disabled
                title={workflowType === "rpi" ? "Sessions launch in a later release" : "Sessions launch in a later release"}
                className="inline-flex h-10 items-center gap-2 rounded-md border border-border bg-card px-4 text-sm font-semibold text-muted-foreground opacity-60"
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
          {view === "new" ? (
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
