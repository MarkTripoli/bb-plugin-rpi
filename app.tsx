import { definePluginApp } from "@get-bb/plugin-sdk/app";
import {
  HumanLayerArtifactDirective,
  HumanLayerArtifactThreadPanel,
  HumanLayerPanel,
  HumanLayerNotificationSettings,
  HumanLayerTipsThreadPanel,
  HumanLayerThreadHeaderAction,
  HumanLayerWorkspaceThreadPanel,
} from "./ui/humanlayer";

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
});
