import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { parseRpiThreadPanelParams } from "../thread-panel";

const root = path.resolve(import.meta.dirname, "..");

test("thread panel params accept known views and safe artifact names only", () => {
  assert.deepEqual(parseRpiThreadPanelParams({ view: "artifacts", fileName: "02-review.md" }), { view: "artifacts", fileName: "02-review.md" });
  assert.deepEqual(parseRpiThreadPanelParams({ view: "unknown", fileName: "../secret" }), { view: "actions", fileName: null });
  assert.deepEqual(parseRpiThreadPanelParams({ view: "artifacts", fileName: "" }), { view: "artifacts", fileName: null });
  assert.deepEqual(parseRpiThreadPanelParams(null), { view: "actions", fileName: null });
});

test("app exposes one consolidated RPI thread panel action", () => {
  const source = fs.readFileSync(path.join(root, "app.tsx"), "utf8");
  const uiSource = fs.readFileSync(path.join(root, "ui/rpi.tsx"), "utf8");
  const ids = [...source.matchAll(/app\.slots\.threadPanelAction\(\{\s*id: "([^"]+)"/g)].map((match) => match[1]);
  assert.deepEqual(ids, ["rpi"]);
  assert.match(source, /component: RpiThreadPanel/);
  assert.equal(source.includes('actionId: "artifacts"'), false);
  assert.equal(source.includes('actionId: "scratch"'), false);
  for (const skillId of ["review-code", "describe-pr", "resolve-pr-reviews"]) {
    assert.match(uiSource, new RegExp(`skillId: "${skillId}"`));
  }
  assert.match(uiSource, /buildManualLaunchRoute\(\{ kind: "skill", taskId: session\.taskId, skillId \}\)/);
  assert.doesNotMatch(uiSource, /rpc\.call\("launchSkill"/);
});
