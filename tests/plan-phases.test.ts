import test from "node:test";
import assert from "node:assert/strict";
import { latestPlanArtifact, nextIncompletePlanPhase, parsePlanPhases } from "../plan-phases";

const PLAN = `---
task: eng-demo
type: plan
---

# Demo Implementation Plan

## Overview

Body text with no phases.

## Phase 1: Scaffold

### Success Criteria:

#### Automated Verification:

- [x] npm test
- [x] npm run build

---

## Phase 2: Wire server

### Success Criteria:

#### Automated Verification:

- [ ] npm test
- [x] lint

---

## Phase 3: Ship

[Phase title placeholder style, no checkboxes yet]
`;

test("parsePlanPhases extracts phase headings and checkbox completion", () => {
  assert.deepEqual(parsePlanPhases(PLAN), [
    { phase: 1, title: "Scaffold", complete: true },
    { phase: 2, title: "Wire server", complete: false },
    { phase: 3, title: "Ship", complete: false },
  ]);
});

test("parsePlanPhases ignores headings below level 2 and non-phase headings", () => {
  const text = ["# Plan", "### Phase 9: not a phase", "## Current State Analysis", "## Phase 2: Later", "- [x] only"].join("\n");
  assert.deepEqual(parsePlanPhases(text), [{ phase: 2, title: "Later", complete: true }]);
});

test("nextIncompletePlanPhase returns first incomplete phase above Phase 1", () => {
  assert.deepEqual(nextIncompletePlanPhase(PLAN), { phase: 2, title: "Wire server" });
});

test("nextIncompletePlanPhase returns null when plan is complete", () => {
  const text = ["## Phase 1: A", "- [x] done", "## Phase 2: B", "- [X] done too"].join("\n");
  assert.equal(nextIncompletePlanPhase(text), null);
});

test("nextIncompletePlanPhase returns null when Phase 1 is the first incomplete phase", () => {
  const text = ["## Phase 1: A", "- [ ] todo", "## Phase 2: B", "- [ ] todo"].join("\n");
  assert.equal(nextIncompletePlanPhase(text), null);
});

test("nextIncompletePlanPhase returns null with no phases or placeholder titles", () => {
  assert.equal(nextIncompletePlanPhase("no phases here"), null);
  const text = ["## Phase 1: A", "- [x] done", "## Phase 2: [Phase title]", "- [ ] todo"].join("\n");
  assert.deepEqual(nextIncompletePlanPhase(text), { phase: 2, title: "" });
});

test("latestPlanArtifact picks the most recently updated plan artifact", () => {
  const artifacts = [
    { fileName: "01-plan-a.md", groupType: "plan", updatedAt: 10 },
    { fileName: "03-plan-c.md", groupType: "plan", updatedAt: 30 },
    { fileName: "02-plan-b.md", groupType: "plan", updatedAt: 30 },
    { fileName: "04-research-x.md", groupType: "research", updatedAt: 40 },
  ];
  assert.equal(latestPlanArtifact(artifacts)?.fileName, "03-plan-c.md");
  assert.equal(latestPlanArtifact([{ fileName: "05-research-y.md", groupType: "research", updatedAt: 5 }]), null);
});
