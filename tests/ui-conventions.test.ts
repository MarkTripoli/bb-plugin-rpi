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
    "Full auto",
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

test("phase completion and localized review actions use the right boundaries", () => {
  assert.match(content, /completionActionsForSession\(session/);
  assert.match(content, /buildManualLaunchRoute\(intent\)/);
  assert.match(content, /pendingIntent\.kind === "completion"|pending\.intent\.kind === "completion"/);
  assert.match(content, /modelOverride/);

  const headerStart = content.indexOf("export function RpiThreadHeaderAction");
  const bannerStart = content.indexOf("export function RpiComposerBanner", headerStart);
  assert.ok(headerStart >= 0 && bannerStart > headerStart, "could not locate thread-header section");
  const header = content.slice(headerStart, bannerStart);
  assert.match(header, /session\.workflowType === "freeform"/);
  assert.match(header, /session\.workflowType === "oneshot"/);
  for (const label of ["Review code", "Create pull request", "Resolve pull request reviews"]) {
    assert.equal(header.includes(label), true, `header is missing ${label}`);
  }
  assert.match(header, /buildManualLaunchRoute\(\{ kind: "skill", taskId: session\.taskId, skillId \}\)/);

  const panelStart = content.indexOf("export function RpiThreadPanel");
  const artifactDirectiveStart = content.indexOf("export function RpiArtifactDirective", panelStart);
  assert.ok(panelStart >= 0 && artifactDirectiveStart > panelStart, "could not locate thread-panel section");
  const panel = content.slice(panelStart, artifactDirectiveStart);
  assert.equal(panel.includes("Workflow actions"), false);
  assert.match(panel, /RPI_REVIEW_ACTIONS/);
  assert.match(panel, /launchReviewAction\(action\.skillId\)/);
});

test("phase completion presents the session-bound review handoff before actions", () => {
  assert.match(content, /latestPhaseArtifact\(artifacts, session\.workflowType\)/);
  assert.match(content, /derivePhaseHandoff\(content, primary, artifacts\)/);
  assert.match(content, /phaseImplementationSkill\(session\?\.workflowType/);
  assert.match(content, /isNumericImplementationSkill\(session\?\.skillId \?\? null\)/);
  assert.match(content, /if \(!phaseLabel\) \{\s*setReviewLoaded\(true\);\s*return;\s*\}/);
  assert.match(content, /reviewArtifact && \(!needsPhaseReview \|\| phaseHandoff\?\.ok\)/);
  assert.match(content, /Phase \$\{phaseHandoff\.completedPhase\} ready for review/);
  assert.match(content, /ready for review`/);
  assert.match(content, /Open review artifact/);
  assert.match(content, /plural\(reviewArtifact\.commentCount, "unresolved comment"\)/);
  assert.match(content, /Open the artifact for exact checks and known limits\./);
  assert.match(content, /Phase review metadata unavailable/);
  assert.match(content, /Open task artifacts/);
  assert.match(content, /action\.id === "iterate" \|\| action\.id === "review" \|\| action\.id === "fix-review" \|\| action\.id === "resolve-pr"/);
  assert.match(content, /useRealtime\("rpi:artifacts", \(payload\) =>/);
  assert.match(content, /setPhaseArtifactRevision\(\(revision\) => revision \+ 1\)/);
  assert.match(content, /completionBase !== null && completionBase\.state !== "replaced"/);
  assert.ok(content.indexOf("Open review artifact") < content.indexOf("completion ? ("));
});

// The 48px thread header is shared chrome: bb's own model picker, Commit, and panel buttons sit in
// the same row, and the SDK contract asks a plugin for ONE inline control with taller content in a
// portalled popover. Four items (phase pill, status pill, context gauge, the "..." button) crowded
// the host's buttons and collapsed on a narrow window, so the read-only facts moved into the
// popover's first line and only the trigger stays in the row.
test("thread header renders one inline control", () => {
  const headerStart = content.indexOf("export function RpiThreadHeaderAction");
  const bannerStart = content.indexOf("// Registered as the \"next-step\" banner", headerStart);
  assert.ok(headerStart >= 0 && bannerStart > headerStart, "could not locate thread-header section");
  const header = content.slice(headerStart, bannerStart);

  for (const [banned, why] of [
    ["<LabelPill", "the phase pill renders on the session's own sidebar row, not in shared header chrome"],
    ["<SessionStatus", "the status pill renders on the session's own sidebar row, not in shared header chrome"],
    ["<ContextGauge", "the context reading is the popover's facts line"],
    ["size-7", "the trigger uses COARSE_POINTER_HEADER_ICON_BUTTON_CLASS, which is 28px and 36px under a coarse pointer"],
  ] as const) {
    assert.equal(header.includes(banned), false, `${why} (found ${banned})`);
  }
  assert.equal((header.match(/<PopoverTrigger/g) ?? []).length, 1, "the header row holds exactly one control");
  assert.match(header, /COARSE_POINTER_HEADER_ICON_BUTTON_CLASS/);
  assert.match(header, /\{sessionFacts\.join\(" \u00b7 "\)\}/);
  assert.match(header, /statusMeta\(session\.rpiStatus\)\.text/);
  assert.match(header, /gauge \? `\$\{gauge\.percent\}% context` : null/);
  // SessionStatus existed only for the header row it no longer occupies.
  assert.equal(content.includes("function SessionStatus"), false);
});

test("launch dialog labels the confirmation as the approval event", () => {
  assert.match(content, /Approve Phase \$\{pendingAction\.intent\.phase - 1\} and start Phase \$\{pendingAction\.intent\.phase\}/);
  assert.match(content, /`Approve and \$\{pendingAction\.label\}`/);
  assert.match(content, /pendingAction === "iterate"\s*\?\s*"Iterate"/);
});

test("launch dialog dispatches banner Iterate actions", () => {
  assert.match(content, /pending === "iterate" \|\| pending\.intent\.kind === "iterate"/);
});

// The banner shares the composer's width with the review handoff, the completion actions, the
// context notice, and the next-model label. `flex-1` gave each group a zero hypothetical size, so
// all of them landed on one line and were then squeezed below their content, and their `shrink-0`
// children overflowed into the neighbor as overlapping text and truncated labels. Content-sized
// groups inside one wrapping row use the full width when there is room and wrap into a stack when
// there is not, and every control carries BB's coarse-pointer sizing so the row works on a phone.
test("composer banner is one wrapping row of content-sized groups", () => {
  const bannerStart = content.indexOf("export function RpiComposerBanner");
  const bannerEnd = content.indexOf("function LaunchActionDialog", bannerStart);
  assert.ok(bannerStart >= 0 && bannerEnd > bannerStart, "could not locate the composer banner");
  const banner = content.slice(bannerStart, bannerEnd);

  assert.match(content, /const BANNER_ROW_CLASS = "flex w-full min-w-0 flex-wrap items-center gap-x-3 gap-y-2"/);
  assert.match(content, /const BANNER_GROUP_CLASS = "flex min-w-0 flex-wrap items-center gap-2"/);
  assert.match(content, /const BANNER_CONTROL_CLASS = cn\(COARSE_POINTER_COMPACT_ROW_HEIGHT_CLASS, COARSE_POINTER_TEXT_SM_CLASS\)/);
  for (const [banned, why] of [
    ["flex-1", "groups must stay content sized so they wrap instead of collapsing"],
    ["flex-col", "the banner is one wrapping row, not a fixed stack"],
    ["h-7", "banner controls use COARSE_POINTER_COMPACT_ROW_HEIGHT_CLASS"],
    ["text-xs", "banner text uses COARSE_POINTER_TEXT_SM_CLASS"],
  ] as const) {
    assert.equal(banner.includes(banned), false, `${why} (found ${banned})`);
  }
  // One row wraps the three groups: review handoff, its unavailable fallback, and the actions.
  assert.equal((banner.match(/BANNER_ROW_CLASS/g) ?? []).length, 1);
  assert.equal((banner.match(/BANNER_GROUP_CLASS/g) ?? []).length, 3);
  // The next-model label is secondary: right aligned while the line has room, in the stack once it
  // does not.
  assert.match(banner, /className="min-w-0 truncate text-muted-foreground md:ms-auto"/);
  // One leading label per group, so "Phase complete" stays the group's accessible name only.
  assert.equal(banner.includes('<span className="font-semibold text-foreground">Phase complete</span>'), false);
  assert.match(banner, /aria-label="Phase complete"/);
  // The review instruction is a hint on the heading, and HintTrigger is the pattern that opens on
  // a tap; a plain tooltip would hide it on a phone.
  assert.match(banner, /<HintTrigger hint="Open the artifact for exact checks and known limits\."/);
});

// Phase 5 of the epic plan: every epic surface exists, and children launch server-side (the
// scheduler), so the one launchDraft call site stays the New task Create and start path.
test("epic surfaces exist and reuse the one launch boundary", () => {
  for (const label of ["Pause epic", "Resume epic", "Mark done", "Max parallel tasks", "Part of", "Queued: waiting on"]) {
    assert.equal(content.includes(label), true, `missing epic surface copy ${label}`);
  }
  assert.equal((content.match(/rpc\.call\("launchDraft"/g) ?? []).length, 1, "the scheduler launches children server-side");
  assert.ok((content.match(/<details/g) ?? []).length >= 1, "epic waves render as native <details>");
});
