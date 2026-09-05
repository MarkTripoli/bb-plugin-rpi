import { definePluginApp } from "@get-bb/plugin-sdk/app";
import {
  HumanLayerArtifactDirective,
  HumanLayerArtifactThreadPanel,
  HumanLayerDefaultsSettings,
  HumanLayerMinimapThreadPanel,
  HumanLayerPanel,
  HumanLayerNotificationSettings,
  HumanLayerScratchThreadPanel,
  HumanLayerThreadList,
  HumanLayerTipsThreadPanel,
  HumanLayerThreadHeaderAction,
  HumanLayerWorkspaceThreadPanel,
} from "./ui/humanlayer";

// Palette actions run outside React (no useRpc/useBbNavigate available to them), so they call the
// plugin's own RPC HTTP route directly, exactly as PluginRpcClient.call documents it doing.
async function callPluginRpc(method: string, input: unknown) {
  const response = await fetch(`/api/v1/plugins/humanlayer/rpc/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input ?? {}),
  });
  if (!response.ok) throw new Error(`${method} failed (${response.status})`);
  return response.json() as Promise<unknown>;
}

export default definePluginApp((app) => {
  app.slots.navPanel({
    id: "humanlayer",
    title: "HumanLayer",
    icon: "Layers",
    path: "humanlayer",
    component: HumanLayerPanel,
  });
  app.slots.experimental_threadHeaderAction({
    id: "humanlayer-session",
    title: "HumanLayer session",
    component: HumanLayerThreadHeaderAction,
  });
  app.slots.threadPanelAction({
    id: "artifacts",
    title: "Artifacts",
    icon: "Code",
    layout: "flush",
    component: HumanLayerArtifactThreadPanel,
  });
  app.slots.threadPanelAction({
    id: "workspace",
    title: "Workspace",
    icon: "Folder",
    layout: "flush",
    component: HumanLayerWorkspaceThreadPanel,
  });
  app.slots.threadPanelAction({
    id: "scratch",
    title: "Scratch",
    icon: "EditFile",
    layout: "flush",
    component: HumanLayerScratchThreadPanel,
  });
  app.slots.threadPanelAction({
    id: "minimap",
    title: "Minimap",
    icon: "GridView",
    layout: "flush",
    component: HumanLayerMinimapThreadPanel,
  });
  app.slots.threadPanelAction({
    id: "tips",
    title: "Tips",
    icon: "Lightbulb",
    layout: "flush",
    component: HumanLayerTipsThreadPanel,
  });
  app.slots.messageDirective({
    id: "hl-artifact",
    component: HumanLayerArtifactDirective,
  });
  app.slots.settingsSection({
    id: "notifications",
    title: "Notifications",
    component: HumanLayerNotificationSettings,
  });
  app.slots.settingsSection({
    id: "defaults",
    title: "Defaults",
    component: HumanLayerDefaultsSettings,
  });
  // Exclusive slot; ships last/optional per plan §2.7. The user can still pin bb's own list or
  // another provider under Settings → Appearance → Sidebar, and the component itself has a
  // "Use default list" toggle that renders `Original`.
  app.slots.experimental_threadList({
    id: "tasks",
    title: "HumanLayer tasks",
    description: "Groups task sessions under their task with a phase pill; other threads list below.",
    component: HumanLayerThreadList,
  });
  app.slots.commandPaletteAction({
    id: "open-artifacts",
    title: "HumanLayer: Open Artifacts",
    isAvailable: (context) => context.threadId !== null,
    run: (context) => {
      context.openPanel({ actionId: "artifacts", title: "Artifacts" });
    },
  });
  app.slots.commandPaletteAction({
    id: "open-scratch",
    title: "HumanLayer: Open Scratch pad",
    isAvailable: (context) => context.threadId !== null,
    run: (context) => {
      context.openPanel({ actionId: "scratch", title: "Scratch" });
    },
  });
  app.slots.commandPaletteAction({
    id: "archive-task",
    title: "HumanLayer: Archive current task",
    isAvailable: (context) => context.threadId !== null,
    run: async (context) => {
      if (!context.threadId) return;
      if (!window.confirm("Archive this task? Sessions stay but the task leaves the active list.")) return;
      const { session } = (await callPluginRpc("getSession", { threadId: context.threadId })) as { session: { taskId: string } | null };
      if (!session) return;
      await callPluginRpc("archiveTask", { taskId: session.taskId });
    },
  });
});
