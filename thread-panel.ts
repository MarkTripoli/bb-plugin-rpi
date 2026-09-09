export const RPI_THREAD_PANEL_VIEWS = ["actions", "artifacts", "workspace", "scratch", "minimap", "tips", "settings"] as const;

export type RpiThreadPanelView = (typeof RPI_THREAD_PANEL_VIEWS)[number];

export function parseRpiThreadPanelParams(input: unknown): { view: RpiThreadPanelView; fileName: string | null } {
  const record = typeof input === "object" && input !== null ? input as Record<string, unknown> : {};
  const view = typeof record.view === "string" && RPI_THREAD_PANEL_VIEWS.includes(record.view as RpiThreadPanelView)
    ? record.view as RpiThreadPanelView
    : "actions";
  const fileName = typeof record.fileName === "string"
    && record.fileName.length > 0
    && record.fileName.length <= 255
    && !record.fileName.includes("..")
    && !record.fileName.includes("/")
    && !record.fileName.includes("\\")
    ? record.fileName
    : null;
  return { view, fileName };
}
