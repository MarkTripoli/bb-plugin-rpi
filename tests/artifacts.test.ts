import test from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { MIGRATIONS } from "../db";
import { createDraftTask } from "../tasks";
import {
  ARTIFACT_SIZE_LIMIT_BYTES,
  artifactSummary,
  artifactType,
  assertSafeArtifactFileName,
  deleteArtifact,
  extractPrimaryReviewArtifact,
  getArtifact,
  getArtifactVersion,
  groupByType,
  listArtifacts,
  listArtifactVersions,
  markdownHeadings,
  markdownSection,
  middleEllipsis,
  nextArtifactNumber,
  parseFrontmatter,
  restoreArtifact,
  selectContextArtifacts,
  upsertArtifact,
} from "../artifacts";

function makeDb() {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  for (const statement of MIGRATIONS) db.exec(statement);
  return db;
}

function seedTask(db: Database.Database) {
  return createDraftTask(db, {
    projectId: "proj_1",
    prompt: "Task prompt",
    name: "Task",
    workflowType: "freeform",
    worktreeTiming: "never",
    permissionMode: "default",
    autoAdvance: false,
    providerId: null,
    model: null,
    reasoningLevel: null,
    serviceTier: null,
  }).taskId;
}

test("parseFrontmatter accepts flat fenced scalars only", () => {
  assert.deepEqual(parseFrontmatter("---\ntype: research\nready: true\ncount: 2\n---\nBody"), {
    type: "research",
    ready: true,
    count: 2,
  });
  assert.deepEqual(parseFrontmatter("type: research\n---\nBody"), {});
  assert.deepEqual(parseFrontmatter("---\ntype: research\nBody"), {});
});

test("artifact type uses frontmatter before numbered file names", () => {
  assert.equal(artifactType("01-research-topic.md", {}), "research");
  assert.equal(artifactType("01-research-topic.md", { type: "notes" }), "notes");
  assert.equal(artifactType("handoff.md", {}), "other");
});

test("next artifact number ignores gaps, non-numbered files, and deleted files", () => {
  const db = makeDb();
  const taskId = seedTask(db);
  upsertArtifact(db, taskId, "01-research-a.md", "a", { createdBy: "t", operation: "test" });
  upsertArtifact(db, taskId, "03-plan-c.md", "c", { createdBy: "t", operation: "test" });
  upsertArtifact(db, taskId, "99-plan-deleted.md", "d", { createdBy: "t", operation: "test" });
  db.prepare("UPDATE artifacts SET is_deleted = 1 WHERE file_name = ?").run("99-plan-deleted.md");
  upsertArtifact(db, taskId, "handoff.md", "h", { createdBy: "t", operation: "test" });
  assert.equal(nextArtifactNumber(db, taskId), "04");
  db.close();
});

test("upsert deduplicates unchanged sha and creates a version only on change", () => {
  const db = makeDb();
  const taskId = seedTask(db);
  const first = upsertArtifact(db, taskId, "01-research-a.md", "a", { createdBy: "t", operation: "test" });
  const second = upsertArtifact(db, taskId, "01-research-a.md", "a", { createdBy: "t", operation: "test" });
  const third = upsertArtifact(db, taskId, "01-research-a.md", "b", { createdBy: "t", operation: "test" });
  assert.deepEqual([first.version, first.changed], [1, true]);
  assert.deepEqual([second.version, second.changed], [1, false]);
  assert.deepEqual([third.version, third.changed], [2, true]);
  assert.equal(listArtifactVersions(db, taskId, "01-research-a.md").length, 2);
  assert.equal(getArtifactVersion(db, taskId, "01-research-a.md", 2)?.version.content.toString("utf8"), "b");
  db.close();
});

test("groupByType follows RPI panel order with other last", () => {
  const grouped = groupByType([
    { type: "notes", fileName: "n.md" },
    { type: "research", fileName: "r.md" },
    { type: "prd", fileName: "p.md" },
  ]);
  assert.deepEqual(grouped.map((group) => group.type), ["research", "prd", "other"]);
});

test("artifact size cap and path confinement reject unsafe writes", () => {
  const db = makeDb();
  const taskId = seedTask(db);
  assert.throws(() => upsertArtifact(db, taskId, "big.bin", Buffer.alloc(ARTIFACT_SIZE_LIMIT_BYTES + 1), { createdBy: "t", operation: "test" }), /10 MB/);
  assert.throws(() => assertSafeArtifactFileName("../escape.md"), /invalid artifact file name/);
  assert.throws(() => assertSafeArtifactFileName("/tmp/escape.md"), /invalid artifact file name/);
  assert.throws(() => assertSafeArtifactFileName(".trash-note.md"), /invalid artifact file name/);
  assert.throws(() => assertSafeArtifactFileName("bad\0name.md"), /invalid artifact file name/);
  assert.throws(() => assertSafeArtifactFileName("bad\uD800name.md"), /invalid artifact file name/);
  assert.throws(() => assertSafeArtifactFileName(`${"x".repeat(256)}.md`), /invalid artifact file name/);
  db.close();
});

test("primary review extraction accepts only the first live standalone task directive outside code", () => {
  const live = new Set(["01-review.md", "02-review.md"]);
  const ignored = [
    "[::rpi-artifact{task=\"task-1\" file=\"01-review.md\"}](https://example.test)",
    "`::rpi-artifact{task=\"task-1\" file=\"01-review.md\"}`",
    "```text\n::rpi-artifact{task=\"task-1\" file=\"01-review.md\"}\n```",
    "    ::rpi-artifact{task=\"task-1\" file=\"01-review.md\"}",
    "::rpi-artifact{task=\"other-task\" file=\"01-review.md\"}",
    "::rpi-artifact{task=\"task-1\" file=\"../escape.md\"}",
    "::rpi-artifact{task=\"task-1\" file=\"deleted.md\"}",
    "::rpi-artifact{task=\"task-1\" file=\"unknown.md\"}",
  ];
  assert.equal(extractPrimaryReviewArtifact(ignored.join("\n"), "task-1", live), null);
  assert.deepEqual(
    extractPrimaryReviewArtifact(`${ignored.join("\n")}\n::rpi-artifact{task="task-1" file="02-review.md"}\n::rpi-artifact{task="task-1" file="01-review.md"}`, "task-1", live),
    { fileName: "02-review.md" },
  );
});

test("primary review extraction ignores directives after malformed fence text", () => {
  const live = new Set(["01-review.md", "02-review.md"]);
  for (const marker of ["```", "~~~"] as const) {
    const input = [
      `${marker}text`,
      `${marker}not-a-closing-fence`,
      `::rpi-artifact{task="task-1" file="01-review.md"}`,
      marker,
      `::rpi-artifact{task="task-1" file="02-review.md"}`,
    ].join("\n");
    assert.deepEqual(extractPrimaryReviewArtifact(input, "task-1", live), { fileName: "02-review.md" });
  }
});

test("file validation rejects case-insensitive live collisions", () => {
  const db = makeDb();
  const taskId = seedTask(db);
  upsertArtifact(db, taskId, "Notes.md", "a", { createdBy: "t", operation: "test" });
  assert.throws(() => upsertArtifact(db, taskId, "notes.md", "b", { createdBy: "t", operation: "test" }), /collides/);
  db.prepare("UPDATE artifacts SET is_deleted = 1 WHERE file_name = ?").run("Notes.md");
  assert.doesNotThrow(() => upsertArtifact(db, taskId, "notes.md", "b", { createdBy: "t", operation: "test" }));
  db.close();
});

test("restore rejects case-insensitive live collisions", () => {
  const db = makeDb();
  const taskId = seedTask(db);
  upsertArtifact(db, taskId, "Notes.md", "a", { createdBy: "t", operation: "test" });
  deleteArtifact(db, taskId, "Notes.md");
  upsertArtifact(db, taskId, "notes.md", "b", { createdBy: "t", operation: "test" });
  assert.equal(restoreArtifact(db, taskId, "Notes.md").outcome, "conflict");
  assert.equal(getArtifact(db, taskId, "Notes.md")?.isDeleted, true);
  db.close();
});

test("frontmatter and type inference handle eof fences, quoted scalars, and longest prefixes", () => {
  assert.deepEqual(parseFrontmatter("---\ntype: \"research\"\ncount: \"2\"\n---"), { type: "research", count: "2" });
  assert.equal(artifactType("01-research-questions-cache.md", {}), "research-questions");
  assert.equal(artifactType("02-pr-description-cache.md", {}), "pr-description");
  assert.equal(artifactType("03-unknown-cache.md", {}), "other");
});
test("middleEllipsis: returns short names unchanged, truncates long ones to exactly max", () => {
  assert.equal(middleEllipsis("01-research-questions.md", 34), "01-research-questions.md");
  const truncated = middleEllipsis("01-research-questions-dashboard-caching-strategy.md", 34);
  assert.equal(truncated.length, 34);
  assert.ok(truncated.includes("\u2026"));
  assert.equal(truncated.slice(0, 22), "01-research-questions-dashboard-caching-strategy.md".slice(0, 22));
  assert.equal(truncated.slice(-11), "01-research-questions-dashboard-caching-strategy.md".slice(-11));
});

test("artifactSummary bounds frontmatter summary and drops template placeholders", () => {
  assert.equal(artifactSummary({}), null);
  assert.equal(artifactSummary({ summary: 42 }), null);
  assert.equal(artifactSummary({ summary: "   " }), null);
  assert.equal(artifactSummary({ summary: "[Two to four sentences: what this establishes.]" }), null);
  assert.equal(artifactSummary({ summary: "Fixes the\n  archive  cascade." }), "Fixes the archive cascade.");
  const long = artifactSummary({ summary: "x".repeat(1000) });
  assert.equal(long?.length, 400);
  assert.ok(long?.endsWith("\u2026"));
});

test("context selection is phase-aware, bounded, and preserves explicit continuation inputs", () => {
  const db = makeDb();
  const taskId = seedTask(db);
  upsertArtifact(db, taskId, "task.md", "task", { createdBy: "t", operation: "test" });
  upsertArtifact(db, taskId, "handoff.md", "handoff", { createdBy: "t", operation: "test" });
  for (let index = 1; index <= 20; index += 1) {
    upsertArtifact(db, taskId, `${String(index).padStart(2, "0")}-research-topic-${index}.md`, `---\ntype: research\n---\n${index}`, { createdBy: "t", operation: "test" });
  }
  upsertArtifact(db, taskId, "99-plan-primary.md", "---\ntype: plan\n---\nplan", { createdBy: "t", operation: "test" });
  const artifacts = listArtifacts(db, taskId);

  const research = selectContextArtifacts(artifacts, {
    phase: "research",
    previousCommandLine: "/rpi-iterate-research @task.md @handoff.md",
    previousArtifactNames: ["ticket.md", "handoff.md"],
  });
  assert.equal(research.some((artifact) => artifact.fileName === "task.md"), false, "research bootstrap must not leak task intent");
  assert.equal(research.some((artifact) => artifact.fileName === "handoff.md"), false, "research bootstrap must not leak continuation intent");

  const implementation = selectContextArtifacts(artifacts, {
    phase: "implementation",
    commandLine: "/rpi-iterate-implementation @99-plan-primary.md",
    previousArtifactNames: ["20-research-topic-20.md"],
  });
  assert.ok(implementation.length <= 12);
  assert.deepEqual(implementation.slice(0, 3).map(({ fileName, reason }) => ({ fileName, reason })), [
    { fileName: "99-plan-primary.md", reason: "command" },
    { fileName: "20-research-topic-20.md", reason: "previous-session" },
    { fileName: "handoff.md", reason: "checkpoint" },
  ]);
  const explicit = artifacts.filter((artifact) => artifact.fileName.includes("research-topic")).slice(0, 13);
  assert.throws(
    () => selectContextArtifacts(explicit, { phase: "implementation", commandLine: explicit.map((artifact) => `@${artifact.fileName}`).join(" ") }),
    /split it into smaller work/,
  );
  assert.throws(
    () => selectContextArtifacts(artifacts, { phase: "implementation", commandLine: "/rpi-implement-plan @missing.md" }),
    /assigned artifact not found: missing\.md/,
  );
  db.close();
});

test("markdown section reads one heading without loading later sibling phases", () => {
  const content = "# Plan\nintro\n```md\n## Phase 0: Example only\n```\n## Shared constraints\nkeep this\n## Phase 1: First\none\n### Checks\ncheck\n## Phase 2: Second\ntwo";
  assert.deepEqual(markdownHeadings(content).map(({ text, line }) => ({ text, line })), [
    { text: "Plan", line: 1 },
    { text: "Shared constraints", line: 6 },
    { text: "Phase 1: First", line: 8 },
    { text: "Checks", line: 10 },
    { text: "Phase 2: Second", line: 12 },
  ]);
  assert.deepEqual(markdownSection(content, "Phase 1"), {
    content: "## Phase 1: First\none\n### Checks\ncheck",
    startLine: 8,
    endLine: 11,
  });
  assert.equal(markdownSection(content, "missing"), null);
});
