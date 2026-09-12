import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { extractNextStep } from "../extraction";
import { autoAdvanceTransition } from "../transitions";
import { ARTIFACT_TOOL_NAMES } from "../tools";

const root = path.resolve(import.meta.dirname, "..");

const researchFinalAnswerByWorkflow = {
  rpi: "create-design-discussion",
  outline_only: "create-structure-outline",
  prd_tdd: "create-prd",
} as const;

const finalTemplateExpectations = [
  ["skills/rpi-create-research-questions/references/research_questions_final_answer.md", "create-research"],
  ["skills/rpi-iterate-research-questions/references/research_questions_final_answer.md", "create-research"],
  ["skills/rpi-create-research/references/research_final_answer.md", researchFinalAnswerByWorkflow],
  ["skills/rpi-iterate-research/references/research_final_answer.md", researchFinalAnswerByWorkflow],
  ["skills/rpi-create-design-discussion/references/design_discussion_final_answer.md", "create-plan"],
  ["skills/rpi-create-design-discussion/references/design_discussion_review_answer.md", "iterate-design-discussion"],
  ["skills/rpi-iterate-design-discussion/references/design_discussion_final_answer.md", "create-plan"],
  ["skills/rpi-iterate-design-discussion/references/design_discussion_review_answer.md", "iterate-design-discussion"],
  ["skills/rpi-create-prd/references/prd_final_answer.md", "create-tdd"],
  ["skills/rpi-create-prd/references/prd_review_answer.md", "iterate-prd"],
  ["skills/rpi-iterate-prd/references/prd_final_answer.md", "create-tdd"],
  ["skills/rpi-iterate-prd/references/prd_review_answer.md", "iterate-prd"],
  ["skills/rpi-create-tdd/references/tdd_final_answer.md", "create-plan"],
  ["skills/rpi-create-tdd/references/tdd_program_review_answer.md", "iterate-tdd"],
  ["skills/rpi-create-tdd/references/tdd_system_review_answer.md", "iterate-tdd"],
  ["skills/rpi-iterate-tdd/references/tdd_final_answer.md", "create-plan"],
  ["skills/rpi-iterate-tdd/references/tdd_review_answer.md", "iterate-tdd"],
  ["skills/rpi-create-structure-outline/references/structure_outline_final_answer.md", "implement-outline"],
  ["skills/rpi-create-structure-outline/references/structure_outline_setup_answer.md", "setup-worktree"],
  ["skills/rpi-iterate-structure-outline/references/structure_outline_final_answer.md", "implement-outline"],
  ["skills/rpi-iterate-structure-outline/references/structure_outline_setup_answer.md", "setup-worktree"],
  ["skills/rpi-create-plan/references/plan_final_answer.md", "setup-worktree"],
  ["skills/rpi-create-plan/references/plan_in_worktree_answer.md", "implement-plan"],
  ["skills/rpi-create-plan/references/plan_disabled_answer.md", "implement-plan"],
  ["skills/rpi-iterate-plan/references/plan_final_answer.md", "setup-worktree"],
  ["skills/rpi-iterate-plan/references/plan_in_worktree_answer.md", "implement-plan"],
  ["skills/rpi-iterate-plan/references/plan_disabled_answer.md", "implement-plan"],
  ["skills/rpi-create-epic-plan/references/epic_plan_final_answer.md", "start-epic-delivery"],
  ["skills/rpi-configure-workspaces/references/workspace_final_answer.md", "setup-worktree"],
  ["skills/rpi-setup-worktree/references/worktree_final_answer.md", "implement-plan"],
  ["skills/rpi-implement-plan/references/implementation_final_answer.md", "describe-pr"],
  ["skills/rpi-implement-plan/references/implementation_phase_final_answer.md", "implement-plan"],
  ["skills/rpi-implement-outline/references/implementation_final_answer.md", "describe-pr"],
  ["skills/rpi-implement-outline/references/implementation_phase_final_answer.md", "implement-outline"],
  ["skills/rpi-iterate-implementation/references/implementation_final_answer.md", "describe-pr"],
  ["skills/rpi-iterate-implementation/references/implementation_phase_final_answer.md", "implement-plan"],
  ["skills/rpi-review-code/references/code_review_findings_answer.md", "fix-code-review"],
  ["skills/rpi-review-code/references/code_review_clean_answer.md", "describe-pr"],
  ["skills/rpi-review-code/references/code_review_blocked_answer.md", null],
  ["skills/rpi-fix-code-review/references/code_review_fixes_answer.md", "review-code"],
  ["skills/rpi-describe-pr/references/pr_description_final_answer.md", "resolve-pr-reviews"],
  ["skills/rpi-resolve-pr-reviews/references/pr_review_pending_answer.md", "resolve-pr-reviews"],
  ["skills/rpi-resolve-pr-reviews/references/pr_review_approved_answer.md", null],
  ["skills/rpi-ci-commit/references/commit_final_answer.md", "describe-pr"],
  ["skills/rpi-review-artifact-comments/references/comments_final_answer.md", "iterate-implementation"],
  ["skills/rpi-show-me/references/show_me_final_answer.md", null],
] as const;

const humanReviewArtifactTemplates = [
  "skills/rpi-create-design-discussion/references/design_discussion_template.md",
  "skills/rpi-iterate-design-discussion/references/design_discussion_template.md",
  "skills/rpi-create-prd/references/prd_template.md",
  "skills/rpi-iterate-prd/references/prd_template.md",
  "skills/rpi-create-tdd/references/tdd_template.md",
  "skills/rpi-iterate-tdd/references/tdd_template.md",
  "skills/rpi-create-structure-outline/references/structure_outline_template.md",
  "skills/rpi-iterate-structure-outline/references/structure_outline_template.md",
  "skills/rpi-create-plan/references/plan_template.md",
  "skills/rpi-iterate-plan/references/plan_template.md",
  "skills/rpi-create-epic-plan/references/epic_plan_template.md",
  "skills/rpi-implement-plan/references/implementation_template.md",
  "skills/rpi-implement-outline/references/implementation_template.md",
  "skills/rpi-iterate-implementation/references/implementation_template.md",
  "skills/rpi-describe-pr/references/pr_description_template.md",
  "skills/rpi-resolve-pr-reviews/references/pr_review_template.md",
] as const;

const humanGateAnswerTemplates = finalTemplateExpectations
  .map(([file]) => file)
  .filter((file) => /rpi-(?:create|iterate)-(?:design-discussion|prd|tdd|structure-outline|plan|epic-plan)|rpi-(?:implement-plan|implement-outline|iterate-implementation)|rpi-(?:describe-pr|resolve-pr-reviews)\/(?:references)\/(?:pr_description_final_answer|pr_review_pending_answer)/.test(file))
  .filter((file) => !file.endsWith("implementation_phase_final_answer.md"));

const phaseAnswerTemplates = [
  "skills/rpi-implement-plan/references/implementation_phase_final_answer.md",
  "skills/rpi-implement-outline/references/implementation_phase_final_answer.md",
  "skills/rpi-iterate-implementation/references/implementation_phase_final_answer.md",
] as const;

test("every final-answer template parses to the expected next skill", () => {
  for (const [relativePath, expectedSkill] of finalTemplateExpectations) {
    const raw = fs.readFileSync(path.join(root, relativePath), "utf8");
    if (expectedSkill && typeof expectedSkill === "object") {
      for (const [workflowType, workflowSkill] of Object.entries(expectedSkill)) {
        const content = renderWorkflowVariant(fillTemplate(raw), workflowType);
        assertExtractsSkill(content, workflowSkill, `${relativePath} ${workflowType}`);
        assertFinalTextFenceOnly(content, `${relativePath} ${workflowType}`);
      }
    } else {
      const content = fillTemplate(raw);
      assertExtractsSkill(content, expectedSkill, relativePath);
      assertFinalTextFenceOnly(content, relativePath);
    }
  }
});

test("workflow-aware auto-advance rows match research ground truth", () => {
  assert.deepEqual(autoAdvanceTransition("research", "rpi"), { flag: "aa_research_to_design", next: "create-design-discussion", to: "design" });
  assert.deepEqual(autoAdvanceTransition("research", "outline_only"), { flag: "aa_research_to_design", next: "create-structure-outline", to: "structure" });
  assert.deepEqual(autoAdvanceTransition("research", "prd_tdd"), { flag: "aa_research_to_design", next: "create-prd", to: "design-prd" });
});

test("all shipped final-answer templates are covered", () => {
  const found = listFiles(path.join(root, "skills"))
    .map((file) => path.relative(root, file))
    .filter((file) => file.endsWith("answer.md"))
    .sort();
  assert.deepEqual(found, finalTemplateExpectations.map(([file]) => file).sort());
});

test("human-gate artifact templates carry one complete review checklist", () => {
  for (const relativePath of humanReviewArtifactTemplates) {
    const content = fs.readFileSync(path.join(root, relativePath), "utf8");
    for (const heading of ["## Human Review", "### Review targets", "### Verify", "### Known limits"]) {
      assert.equal(content.split(heading).length - 1, 1, `${relativePath} must contain one ${heading}`);
    }
  }
});

test("numeric implementation templates and phase answers bind explicit completed phases", () => {
  for (const skill of ["rpi-implement-plan", "rpi-implement-outline", "rpi-iterate-implementation"]) {
    const template = fs.readFileSync(path.join(root, `skills/${skill}/references/implementation_template.md`), "utf8");
    assert.match(template, /^---\r?\n[\s\S]*^type: implementation\r?$[\s\S]*^completed_phase: \[positive integer\]\r?$[\s\S]*^---\r?$/m, skill);
    const phaseAnswer = fillTemplate(fs.readFileSync(path.join(root, `skills/${skill}/references/implementation_phase_final_answer.md`), "utf8"));
    assertExtractsSkill(phaseAnswer, skill === "rpi-implement-outline" ? "implement-outline" : "implement-plan", skill);
    assertFinalTextFenceOnly(phaseAnswer, skill);
  }
  const iterateOutline = fillTemplate(fs.readFileSync(path.join(root, "skills/rpi-iterate-implementation/references/implementation_phase_final_answer.md"), "utf8"))
    .replace("/rpi-implement-plan", "/rpi-implement-outline");
  assertExtractsSkill(iterateOutline, "implement-outline", "iterate implementation outline handoff");
});

test("iteration handoff keeps nonterminal phases out of the terminal PR path", () => {
  const content = fs.readFileSync(path.join(root, "skills/rpi-iterate-implementation/SKILL.md"), "utf8");
  const closing = content.slice(content.indexOf("## When Iteration Is Complete"));
  assert.match(closing, /If another numbered phase remains[\s\S]*implementation_phase_final_answer\.md/);
  assert.match(closing, /Only when the completed phase is the highest numbered phase[\s\S]*implementation_final_answer\.md/);
});

test("human-gate answers expose one review artifact, concrete checks, feedback, approval semantics, and one final command", () => {
  for (const relativePath of humanGateAnswerTemplates) {
    const content = fillTemplate(fs.readFileSync(path.join(root, relativePath), "utf8"));
    const directives = content.split(/\r?\n/).filter((line) => /^::rpi-artifact\{task="task-id" file="01-artifact\.md"\}$/.test(line));
    assert.equal(directives.length, 1, `${relativePath} must contain one standalone primary directive`);
    assert.match(content, /\nCheck:\r?\n- Review the named behavior and evidence\./, `${relativePath} must copy a concrete review check`);
    assert.match(content, /[Cc]omment on the artifact/, `${relativePath} must explain the feedback path`);
    assert.match(content, /approval/, `${relativePath} must state approval semantics`);
    assertFinalTextFenceOnly(content, relativePath);
  }
});

test("phase answers are progress reports with recorded deferred evidence and no approval wording", () => {
  for (const relativePath of phaseAnswerTemplates) {
    const content = fillTemplate(fs.readFileSync(path.join(root, relativePath), "utf8"));
    const directives = content.split(/\r?\n/).filter((line) => /^::rpi-artifact\{task="task-id" file="01-artifact\.md"\}$/.test(line));
    assert.equal(directives.length, 1, `${relativePath} must contain one standalone primary directive`);
    assert.match(content, /\nCheck:\r?\n- Review the named behavior and evidence\./, `${relativePath} must copy a concrete review check`);
    assert.match(content, /Deferred human evidence \(recorded, not executed\):/, `${relativePath} must record deferred evidence`);
    assert.doesNotMatch(content, /[Aa]pproved/, `${relativePath} must not carry approval wording`);
    assertFinalTextFenceOnly(content, relativePath);
  }
});

test("every skill references the shared writing guide relative to its installed directory", () => {
  const guide = path.join(root, "skills/WRITING.md");
  assert.ok(fs.readFileSync(guide, "utf8").trim());
  for (const file of listFiles(path.join(root, "skills")).filter((file) => path.basename(file) === "SKILL.md")) {
    const content = fs.readFileSync(file, "utf8");
    const references = [...content.matchAll(/\[RPI writing guide\]\(([^)]+)\)/g)];
    assert.equal(references.length, 1, `${path.relative(root, file)} must load the writing guide once`);
    assert.equal(path.resolve(path.dirname(file), references[0]![1]!), guide);
  }
});

test("every rpi tool referenced by skills is registered", () => {
  const registered = new Set<string>(ARTIFACT_TOOL_NAMES);
  for (const file of listFiles(path.join(root, "skills"))) {
    const content = fs.readFileSync(file, "utf8");
    for (const match of content.matchAll(/\brpi_[a-z_]+\b/g)) {
      assert.equal(registered.has(match[0]), true, `${path.relative(root, file)} references unknown tool ${match[0]}`);
    }
  }
});

test("code review artifact records the five axes and separates required findings from advisories", () => {
  const template = fs.readFileSync(path.join(root, "skills/rpi-review-code/references/code_review_template.md"), "utf8");
  const headings = [...template.matchAll(/^(#{2,3}) (.+)$/gm)].map((match) => match[2]);
  for (const heading of [
    "Tests Reviewed First",
    "Correctness",
    "Readability and Simplicity",
    "Architecture",
    "Security",
    "Performance",
    "Critical and Required Findings",
    "Advisories",
    "Verdict",
  ]) {
    assert.equal(headings.includes(heading), true, `missing code review artifact section: ${heading}`);
  }
});

// Third-party reference material (All Rights Reserved) lives outside this repo (see AGENTS.md
// item 6 / package.json `files`) at RPI_REFERENCE_DIR, defaulting to a sibling checkout so a
// plain clone never ships or copies it. When that directory is absent this test skips loudly
// (not a silent pass) so CI without the sibling checkout still shows the gap.
const RPI_REFERENCE_DIR = process.env.RPI_REFERENCE_DIR
  ? path.resolve(process.env.RPI_REFERENCE_DIR)
  : path.join(os.homedir(), "PersonalDevelopment", "bb-plugin-rpi-reference", "third-party");

test("rewritten skills and references do not contain third-party reference shingles", (t) => {
  if (!fs.existsSync(RPI_REFERENCE_DIR)) {
    t.skip(`RPI_REFERENCE_DIR not found at ${RPI_REFERENCE_DIR}: shingle check against the third-party reference material did NOT run. Set RPI_REFERENCE_DIR or checkout the sibling dir to enforce this.`);
    return;
  }
  const referenceShingles = new Set<string>();
  for (const file of listFiles(RPI_REFERENCE_DIR)) {
    for (const shingle of shingles(fs.readFileSync(file, "utf8"), 10)) referenceShingles.add(shingle);
  }

  for (const file of listFiles(path.join(root, "skills"))) {
    for (const shingle of shingles(fs.readFileSync(file, "utf8"), 10)) {
      if (allowedReferenceShingle(shingle)) continue;
      assert.equal(referenceShingles.has(shingle), false, `${path.relative(root, file)} copies: ${shingle}`);
    }
  }
});

function fillTemplate(input: string) {
  return input
    .replaceAll("{artifact_directive}", "::rpi-artifact{task=\"task-id\" file=\"01-artifact.md\"}")
    .replaceAll("{summary}", "Saved the requested artifact.")
    .replaceAll("{artifact_file}", "01-artifact.md")
    .replaceAll("{artifact_arg}", " @01-artifact.md")
    .replaceAll("{implementation_command}", "/rpi-implement-plan")
    .replaceAll("{review_check}", "Review the named behavior and evidence.")
    .replaceAll("{known_limits}", "None.")
    .replaceAll("{completed_phase}", "1")
    .replaceAll("{next_phase}", "2");
}

function renderWorkflowVariant(input: string, workflowType: string) {
  const command = new RegExp(`For \`${escapeRegExp(workflowType)}\`:\\s*\\\`\\\`\\\`text\\r?\\n([\\s\\S]*?)\\\`\\\`\\\``).exec(input)?.[1]?.trim();
  assert.ok(command, `missing workflow variant ${workflowType}`);
  const [head] = input.split("<!-- workflow-variants -->");
  return `${head!.trimEnd()}\n\n\`\`\`text\n${command}\n\`\`\`\n`;
}

function assertExtractsSkill(content: string, expectedSkill: string | null, label: string) {
  const result = extractNextStep(content, {
    liveArtifactNames: ["01-artifact.md"],
    taskSlug: "task-slug",
    parsedAt: 1,
  });
  assert.equal(result.extraction.type, expectedSkill === null ? "no_next_step" : "next_step_found", label);
  if (result.extraction.type === "next_step_found" && expectedSkill !== null) {
    assert.equal(result.extraction.nextStepType, expectedSkill, label);
  }
}

function assertFinalTextFenceOnly(content: string, label: string) {
  const fences = [...content.matchAll(/```([^\r\n]*)\r?\n([\s\S]*?)```/g)];
  assert.equal(fences.length, 1, `expected exactly one fenced block in ${label}`);
  const [commandFence] = fences;
  assert.equal((commandFence?.[1] ?? "").trim().toLowerCase(), "text", `expected text fence in ${label}`);
  assert.match((commandFence?.[2] ?? "").trim(), /^\/rpi[-:][a-z][a-z0-9-]*(\s+.*)?$/, `missing command in ${label}`);
  assert.equal(content.slice((commandFence?.index ?? 0) + (commandFence?.[0].length ?? 0)).trim(), "", `trailing prose after command in ${label}`);
}

function listFiles(dir: string): string[] {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  return entries.flatMap((entry) => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? listFiles(full) : [full];
  });
}

function shingles(input: string, size: number) {
  const words = input.normalize("NFKC").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().split(/\s+/).filter(Boolean);
  const out: string[] = [];
  for (let index = 0; index + size <= words.length; index += 1) {
    out.push(words.slice(index, index + size).join(" "));
  }
  return out;
}

function allowedReferenceShingle(shingle: string) {
  const tokens = shingle.split(" ");
  return tokens.every((token) => SYNTAX_TOKENS.has(token));
}

function escapeRegExp(input: string) {
  return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const SYNTAX_TOKENS = new Set([
  "name",
  "description",
  "date",
  "git",
  "commit",
  "branch",
  "repository",
  "repo",
  "topic",
  "tags",
  "status",
  "task",
  "id",
  "type",
  "sha",
  "artifact",
  "file",
  "filename",
  "path",
  "disabled",
  "pathtemplate",
  "branchtemplate",
  "sourceref",
  "setupcommand",
  "copyglobs",
  "repos",
  "localpath",
  "primary",
  "false",
  "true",
  "doctype",
  "html",
  "lang",
  "en",
  "head",
  "meta",
  "charset",
  "utf",
  "8",
  "viewport",
  "content",
  "width",
  "device",
  "initial",
  "scale",
  "1",
  "rpi",
  "create",
  "iterate",
  "research",
  "questions",
  "design",
  "discussion",
  "prd",
  "tdd",
  "structure",
  "outline",
  "plan",
  "configure",
  "workspaces",
  "setup",
  "worktree",
  "implement",
  "implementation",
  "describe",
  "pr",
  "ci",
  "review",
  "comments",
  "show",
  "me",
  "agent",
  "codebase",
  "locator",
  "analyzer",
  "pattern",
  "finder",
  "web",
  "search",
  "researcher",
  "hl",
  "context",
  "save",
  "get",
  "update",
  "reply",
]);
