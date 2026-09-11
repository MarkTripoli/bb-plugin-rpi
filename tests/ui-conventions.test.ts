import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

// AGENTS.md frontend convention: the only permitted uppercase-tracked style is a table column
// header (`text-[11px] uppercase tracking-[0.2em]`, inside a <th> or a div-based header row).
// Every other heading or label is sentence case. Locates ui/rpi.tsx the same way
// tests/prose.test.ts does (relative to the repo root, one level up from tests/).
const root = path.resolve(import.meta.dirname, "..");
const content = fs.readFileSync(path.join(root, "ui", "rpi.tsx"), "utf8");
const EM_DASH = "\u2014";

test("ui/rpi.tsx has no retired letter-spacing tracks", () => {
  for (const banned of ["tracking-[0.16em]", "tracking-[0.22em]", "tracking-[0.24em]"]) {
    assert.equal(content.includes(banned), false, `found retired class ${banned}`);
  }
});

test("ui/rpi.tsx has no text-[10px]", () => {
  assert.equal(content.includes("text-[10px]"), false);
});

test("ui/rpi.tsx only pulses under motion-safe", () => {
  assert.equal(/(?<!motion-safe:)animate-pulse/.test(content), false);
});

test("ui/rpi.tsx (UI copy) contains no em dashes", () => {
  assert.equal(content.includes(EM_DASH), false);
});

test("every uppercase-tracked line is the one permitted table-header style", () => {
  const offenders: string[] = [];
  const lines = content.split("\n");
  for (const [index, line] of lines.entries()) {
    if (!line.includes("uppercase")) continue;
    if (!line.includes("tracking-[0.2em]") || !line.includes("text-[11px]")) {
      offenders.push(`line ${index + 1}: ${line.trim()}`);
    }
  }
  assert.deepEqual(offenders, []);
});

test("manual quick actions use the reviewable composer boundary", () => {
  for (const label of [
    "Start fresh",
    "New chat",
    "Draft Launch",
    "Phase complete",
    "Agent suggestion",
    "Iterate in fresh session",
  ]) {
    assert.equal(content.includes(label), true, `missing manual action ${label}`);
  }

  assert.equal((content.match(/rpc\.call\("launchDraft"/g) ?? []).length, 1, "only New task Create and start may call launchDraft");
  assert.equal((content.match(/rpc\.call\("prepareManualLaunch"/g) ?? []).length, 1, "only ManualLaunchComposerPage prepares a launch");
  assert.equal((content.match(/rpc\.call\("submitManualLaunch"/g) ?? []).length, 1, "only ManualLaunchComposerPage submits a launch");
  for (const method of ["proceed", "launchCompletion", "iterateInFreshSession"]) {
    assert.equal((content.match(new RegExp(`rpc\\.call\\("${method}"`, "g")) ?? []).length, 1, `${method} is called once, from the banner's launch paths (direct one-click iterate, dialog for the rest)`);
  }
  assert.match(content, /experimental_NewThreadComposer as NewThreadComposer/);
  assert.match(content, /<NewThreadComposer/);
  assert.match(content, /catch \(error\) \{\s*reportLaunchError\(error\);\s*throw error;/);
});

test("phase completion owns continuation actions", () => {
  assert.match(content, /completionActionsForSession\(session/);
  assert.match(content, /buildManualLaunchRoute\(intent\)/);
  assert.match(content, /pendingIntent\.kind === "completion"|pending\.intent\.kind === "completion"/);
  assert.match(content, /modelOverride/);

  const headerStart = content.indexOf("export function RpiThreadHeaderAction");
  const bannerStart = content.indexOf("export function RpiComposerBanner", headerStart);
  assert.ok(headerStart >= 0 && bannerStart > headerStart, "could not locate thread-header section");
  const header = content.slice(headerStart, bannerStart);
  for (const label of ["Review code", "Create pull request", "Resolve pull request reviews"]) {
    assert.equal(header.includes(label), false, `header still owns ${label}`);
  }

  const panelStart = content.indexOf("export function RpiThreadPanel");
  const artifactDirectiveStart = content.indexOf("export function RpiArtifactDirective", panelStart);
  assert.ok(panelStart >= 0 && artifactDirectiveStart > panelStart, "could not locate thread-panel section");
  const panel = content.slice(panelStart, artifactDirectiveStart);
  assert.equal(panel.includes("Workflow actions"), false);
  for (const label of ["Review code", "Create pull request", "Resolve pull request reviews"]) {
    assert.equal(panel.includes(label), false, `side panel still owns ${label}`);
  }
});
