import { definePluginApp } from "@get-bb/plugin-sdk/app";
import {
  ARCHIVE_TASK_CONFIRM,
  RpiArtifactDirective,
  RpiComposerBanner,
  RpiDefaultsSettings,
  RpiPanel,
  RpiNotificationSettings,
  RpiThreadPanel,
  RpiThreadList,
  RpiThreadHeaderAction,
} from "./ui/rpi";

// Palette actions run outside React (no useRpc/useBbNavigate available to them), so they call the
// plugin's own RPC HTTP route directly, exactly as PluginRpcClient.call documents it doing.
async function callPluginRpc(method: string, input: unknown) {
  const response = await fetch(`/api/v1/plugins/rpi/rpc/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input ?? {}),
  });
  if (!response.ok) throw new Error(`${method} failed (${response.status})`);
  return response.json() as Promise<unknown>;
}

export default definePluginApp((app) => {
  app.slots.navPanel({
    id: "rpi",
    title: "RPI",
    icon: "Layers",
    path: "rpi",
    component: RpiPanel,
  });
  app.slots.experimental_threadHeaderAction({
    id: "rpi-session",
    title: "RPI session",
    component: RpiThreadHeaderAction,
  });
  // Proceed / Suggested next / context-high notice live here, not in the 28px header control (see
  // ui/rpi.tsx RpiThreadHeaderAction's doc comment and docs/phases/10-header-composer.md).
  app.composer.customize({
    id: "rpi-session",
    scopes: ["thread"],
    banners: [{ id: "next-step", chrome: "bare", component: RpiComposerBanner }],
  });
  app.slots.threadPanelAction({
    id: "rpi",
    title: "RPI",
    icon: "Layers",
    layout: "flush",
    component: RpiThreadPanel,
  });
  app.slots.messageDirective({
    id: "rpi-artifact",
    component: RpiArtifactDirective,
  });
  app.slots.settingsSection({
    id: "notifications",
    title: "Notifications",
    component: RpiNotificationSettings,
  });
  app.slots.settingsSection({
    id: "defaults",
    title: "Defaults",
    component: RpiDefaultsSettings,
  });
  // Exclusive slot; ships last/optional per plan §2.7. The user can still pin bb's own list or
  // another provider under Settings → Appearance → Sidebar, and the component itself has a
  // "Use default list" toggle that renders `Original`.
  app.slots.experimental_threadList({
    id: "tasks",
    title: "RPI tasks",
    description: "Groups task sessions under their task with a phase pill; other threads list below.",
    component: RpiThreadList,
  });
  app.slots.commandPaletteAction({
    id: "open-artifacts",
    title: "RPI: Open Artifacts",
    isAvailable: (context) => context.threadId !== null,
    run: (context) => {
      context.openPanel({ actionId: "rpi", title: "RPI", params: { view: "artifacts" } });
    },
  });
  app.slots.commandPaletteAction({
    id: "open-scratch",
    title: "RPI: Open Scratch pad",
    isAvailable: (context) => context.threadId !== null,
    run: (context) => {
      context.openPanel({ actionId: "rpi", title: "RPI", params: { view: "scratch" } });
    },
  });
  app.slots.commandPaletteAction({
    id: "archive-task",
    title: "RPI: Archive current task",
    isAvailable: (context) => context.threadId !== null,
    run: async (context) => {
      if (!context.threadId) return;
      if (!window.confirm(ARCHIVE_TASK_CONFIRM)) return;
      const { session } = (await callPluginRpc("getSession", { threadId: context.threadId })) as { session: { taskId: string } | null };
      if (!session) return;
      await callPluginRpc("archiveTask", { taskId: session.taskId });
    },
  });
});
