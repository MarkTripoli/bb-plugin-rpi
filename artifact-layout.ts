// Pure width-to-layout decision for the Artifacts panel (phase 10 header/composer split, part B).
// Panel width drives the top-level list/viewer split; viewer width (only meaningful once the
// panel is wide enough to go side-by-side) drives whether comments render as a right rail or
// stack under the preview. Below the panel threshold the whole thing stacks regardless of viewer
// width, so a narrow panel never produces three squeezed columns. Shared by ArtifactsPanel and
// ArtifactViewer (ui/rpi.tsx); covered by tests/artifact-layout.test.ts.

export const ARTIFACT_PANEL_STACK_BREAKPOINT = 760;
export const ARTIFACT_VIEWER_RAIL_BREAKPOINT = 620;

export const ARTIFACT_LIST_WIDTH_RANGE = { min: 200, max: 480 } as const;
export const ARTIFACT_COMMENTS_WIDTH_RANGE = { min: 260, max: 520 } as const;

export type ArtifactLayoutMode = "stacked" | "split-rail" | "split-below";

export function artifactLayoutMode(panelWidth: number, viewerWidth: number): ArtifactLayoutMode {
  if (panelWidth < ARTIFACT_PANEL_STACK_BREAKPOINT) return "stacked";
  return viewerWidth >= ARTIFACT_VIEWER_RAIL_BREAKPOINT ? "split-rail" : "split-below";
}

export function clampWidth(value: number, range: { min: number; max: number }): number {
  return Math.min(range.max, Math.max(range.min, value));
}
