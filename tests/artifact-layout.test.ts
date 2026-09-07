import test from "node:test";
import assert from "node:assert/strict";
import { artifactLayoutMode, clampWidth, panelLayoutMode } from "../artifact-layout";

test("panel width below the stack breakpoint always stacks, regardless of viewer width", () => {
  assert.equal(artifactLayoutMode(759, 0), "stacked");
  assert.equal(artifactLayoutMode(759, 620), "stacked");
  assert.equal(artifactLayoutMode(759, 10000), "stacked");
});

test("panel width at or above the stack breakpoint goes side by side", () => {
  assert.equal(artifactLayoutMode(760, 0), "split-below");
  assert.equal(artifactLayoutMode(760, 619), "split-below");
  assert.equal(artifactLayoutMode(760, 620), "split-rail");
  assert.equal(artifactLayoutMode(1200, 620), "split-rail");
});

test("clampWidth clamps to the given range", () => {
  assert.equal(clampWidth(100, { min: 200, max: 480 }), 200);
  assert.equal(clampWidth(300, { min: 200, max: 480 }), 300);
  assert.equal(clampWidth(9000, { min: 200, max: 480 }), 480);
});

test("panel layout stacks below 560px and shows the aside at or above it", () => {
  assert.equal(panelLayoutMode(0), "aside"); // unmeasured (SSR/first paint) defaults to aside
  assert.equal(panelLayoutMode(559), "stacked");
  assert.equal(panelLayoutMode(560), "aside");
});
