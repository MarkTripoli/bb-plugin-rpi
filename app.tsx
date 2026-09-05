import { definePluginApp } from "@get-bb/plugin-sdk/app";
import { HumanLayerPanel, HumanLayerThreadHeaderAction } from "./ui/humanlayer";

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
});
