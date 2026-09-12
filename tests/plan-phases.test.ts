import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  derivePhaseHandoff,
  latestPhaseArtifact,
  latestPlanArtifact,
  latestStructureOutlineArtifact,
  parsePlanPhases,
  parsePrimaryReviewArtifact,
  type PhaseArtifact,
} from "../plan-phases";

const root = path.resolve(import.meta.dirname, "..");
const PLAN = `## Phase 1: Scaffold

- [x] done

## Phase 2: Wire server

- [ ] todo

## Phase 3: Ship

- [ ] todo
`;
const OUTLINE = fs.readFileSync(path.join(root, "skills/rpi-create-structure-outline/references/structure_outline_template.md"), "utf8");

function artifact(fileName: string, completedPhase: unknown = 1, type: unknown = "implementation"): PhaseArtifact {
  return { fileName, frontmatter: { type, completed_phase: completedPhase } as PhaseArtifact["frontmatter"] };
}

test("parsePlanPhases preserves phase headings and checkbox state for plan display", () => {
  assert.deepEqual(parsePlanPhases(PLAN), [
    { phase: 1, title: "Scaffold", complete: true },
    { phase: 2, title: "Wire server", complete: false },
    { phase: 3, title: "Ship", complete: false },
  ]);
  assert.deepEqual(parsePlanPhases("# Phase 9: ignored\n## Phase 2: Later\n- [X] done"), [
    { phase: 2, title: "Later", complete: true },
  ]);
});

test("parsePlanPhases accepts the shipped outline Step headings", () => {
  assert.deepEqual(parsePlanPhases(OUTLINE), [
    { phase: 1, title: "[Work area]", complete: false },
    { phase: 2, title: "[Work area]", complete: false },
  ]);
});

test("parsePlanPhases ignores the human-gated line and plain deferred-evidence bullets", () => {
  assert.deepEqual(parsePlanPhases("## Phase 1: A\nhuman-gated: false\n- evidence pointer\n- [ ] npm test"), [
    { phase: 1, title: "A", complete: false },
  ]);
  assert.deepEqual(parsePlanPhases("## Phase 1: A\nhuman-gated: false\n- evidence pointer\n- [x] npm test"), [
    { phase: 1, title: "A", complete: true },
  ]);
});

test("latestPlanArtifact keeps plan selection deterministic", () => {
  const artifacts = [
    { fileName: "01-plan-a.md", groupType: "plan", updatedAt: 10 },
    { fileName: "03-plan-c.md", groupType: "plan", updatedAt: 30 },
    { fileName: "02-plan-b.md", groupType: "plan", updatedAt: 30 },
    { fileName: "04-research-x.md", groupType: "research", updatedAt: 40 },
  ];
  assert.equal(latestPlanArtifact(artifacts)?.fileName, "03-plan-c.md");
  assert.equal(latestPlanArtifact([{ fileName: "05-research-y.md", groupType: "research", updatedAt: 5 }]), null);
});

test("latestPhaseArtifact selects plans for plan workflows and outlines for outline workflows", () => {
  const artifacts = [
    { fileName: "01-structure-outline.md", groupType: "structure-outline", updatedAt: 10 },
    { fileName: "02-structure-outline.md", groupType: "structure-outline", updatedAt: 20 },
    { fileName: "03-plan.md", groupType: "plan", updatedAt: 30 },
  ];
  assert.equal(latestPhaseArtifact(artifacts, "outline_only")?.fileName, "02-structure-outline.md");
  assert.equal(latestPhaseArtifact(artifacts, "rpi")?.fileName, "03-plan.md");
  assert.equal(latestStructureOutlineArtifact(artifacts)?.fileName, "02-structure-outline.md");
});

test("primary review artifact parsing is bounded and fail closed", () => {
  assert.deepEqual(parsePrimaryReviewArtifact(JSON.stringify({ primaryReviewArtifact: { fileName: "05-implementation.md" } })), {
    fileName: "05-implementation.md",
  });
  for (const summary of [
    null,
    "not json",
    JSON.stringify({}),
    JSON.stringify({ primaryReviewArtifact: null }),
    JSON.stringify({ primaryReviewArtifact: { fileName: 5 } }),
    JSON.stringify({ primaryReviewArtifact: { fileName: "x".repeat(256) } }),
  ]) assert.equal(parsePrimaryReviewArtifact(summary), null);
});

test("derivePhaseHandoff uses only the session-bound implementation receipt", () => {
  const bound = artifact("05-implementation.md", 1);
  const newerUnrelated = artifact("06-implementation.md", 2);
  assert.deepEqual(derivePhaseHandoff(PLAN, { fileName: bound.fileName }, [bound, newerUnrelated]), {
    ok: true,
    reviewArtifact: bound,
    completedPhase: 1,
    nextPhase: { phase: 2, title: "Wire server" },
  });
  assert.equal(derivePhaseHandoff(PLAN, { fileName: newerUnrelated.fileName }, [bound, newerUnrelated]).ok, true);
});

test("derivePhaseHandoff treats the highest plan phase as terminal", () => {
  const receipt = artifact("07-implementation.md", 3);
  assert.deepEqual(derivePhaseHandoff(PLAN, { fileName: receipt.fileName }, [receipt]), {
    ok: true,
    reviewArtifact: receipt,
    completedPhase: 3,
    nextPhase: null,
  });
});

test("derivePhaseHandoff rejects missing, deleted, or malformed receipt authority", () => {
  const valid = artifact("05-implementation.md", 1);
  assert.deepEqual(derivePhaseHandoff(PLAN, null, [valid]), { ok: false, error: "missing_review_artifact" });
  assert.deepEqual(derivePhaseHandoff(PLAN, { fileName: valid.fileName }, []), { ok: false, error: "missing_review_artifact" });
  for (const receipt of [
    artifact("wrong-type.md", 1, "research"),
    artifact("string-phase.md", "1"),
    artifact("fractional-phase.md", 1.5),
    artifact("zero-phase.md", 0),
    artifact("negative-phase.md", -1),
    artifact("unsafe-phase.md", Number.MAX_SAFE_INTEGER + 1),
  ]) {
    assert.deepEqual(derivePhaseHandoff(PLAN, { fileName: receipt.fileName }, [receipt]), {
      ok: false,
      error: "missing_phase_completion",
    });
  }
});

test("derivePhaseHandoff rejects phases absent from or gapped in the plan", () => {
  const absent = artifact("absent.md", 4);
  assert.deepEqual(derivePhaseHandoff(PLAN, { fileName: absent.fileName }, [absent]), { ok: false, error: "phase_not_in_plan" });
  const first = artifact("first.md", 1);
  const gapped = "## Phase 1: First\n\n## Phase 3: Third\n";
  assert.deepEqual(derivePhaseHandoff(gapped, { fileName: first.fileName }, [first]), { ok: false, error: "phase_not_in_plan" });
});
