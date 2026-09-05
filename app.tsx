import { definePluginApp } from "@get-bb/plugin-sdk/app";
import { HumanLayerPanel } from "./ui/humanlayer";

export default definePluginApp((app) => {
  app.slots.navPanel({
    id: "humanlayer",
    title: "HumanLayer",
    icon: "Layers",
    path: "humanlayer",
    component: HumanLayerPanel,
  });
});
