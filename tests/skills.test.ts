import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { extractNextStep } from "../extraction";
import { ARTIFACT_TOOL_NAMES } from "../tools";

const root = path.resolve(import.meta.dirname, "..");

const finalTemplateExpectations = [
  ["skills/rpi-create-research-questions/references/research_questions_final_answer.md", "create-research"],
  ["skills/rpi-iterate-research-questions/references/research_questions_final_answer.md", "create-research"],
  ["skills/rpi-create-research/references/research_final_answer.md", "create-structure-outline"],
  ["skills/rpi-iterate-research/references/research_final_answer.md", "create-structure-outline"],
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
  ["skills/rpi-configure-workspaces/references/workspace_final_answer.md", "setup-worktree"],
  ["skills/rpi-setup-worktree/references/worktree_final_answer.md", "implement-plan"],
  ["skills/rpi-implement-plan/references/implementation_final_answer.md", "describe-pr"],
  ["skills/rpi-implement-outline/references/implementation_final_answer.md", "describe-pr"],
  ["skills/rpi-iterate-implementation/references/implementation_final_answer.md", "describe-pr"],
  ["skills/rpi-describe-pr/references/pr_description_final_answer.md", null],
  ["skills/rpi-ci-commit/references/commit_final_answer.md", "describe-pr"],
  ["skills/rpi-review-artifact-comments/references/comments_final_answer.md", "iterate-implementation"],
  ["skills/rpi-show-me/references/show_me_final_answer.md", null],
] as const;

test("every final-answer template parses to the expected next skill", () => {
  for (const [relativePath, expectedSkill] of finalTemplateExpectations) {
    const content = fillTemplate(fs.readFileSync(path.join(root, relativePath), "utf8"));
    const result = extractNextStep(content, {
      liveArtifactNames: ["01-artifact.md"],
      taskSlug: "task-slug",
      parsedAt: 1,
    });
    assert.equal(result.extraction.type, expectedSkill === null ? "no_next_step" : "next_step_found", relativePath);
    if (result.extraction.type === "next_step_found" && expectedSkill !== null) {
      assert.equal(result.extraction.nextStepType, expectedSkill, relativePath);
    }
    assertFinalTextFenceOnly(content, relativePath);
  }
});

test("all shipped final-answer templates are covered", () => {
  const found = listFiles(path.join(root, "skills"))
    .map((file) => path.relative(root, file))
    .filter((file) => file.endsWith("answer.md"))
    .sort();
  assert.deepEqual(found, finalTemplateExpectations.map(([file]) => file).sort());
});

test("every hl tool referenced by skills is registered", () => {
  const registered = new Set<string>(ARTIFACT_TOOL_NAMES);
  for (const file of listFiles(path.join(root, "skills"))) {
    const content = fs.readFileSync(file, "utf8");
    for (const match of content.matchAll(/\bhl_[a-z_]+\b/g)) {
      assert.equal(registered.has(match[0]), true, `${path.relative(root, file)} references unknown tool ${match[0]}`);
    }
  }
});

test("rewritten skills and references do not contain HumanLayer reference shingles", () => {
  const referenceShingles = new Set<string>();
  for (const file of listFiles(path.join(root, "docs", "hl-reference"))) {
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
    .replaceAll("{artifact_directive}", "::hl-artifact{task=\"task-id\" file=\"01-artifact.md\"}")
    .replaceAll("{summary}", "Saved the requested artifact.")
    .replaceAll("{artifact_file}", "01-artifact.md")
    .replaceAll("{artifact_arg}", " @01-artifact.md")
    .replaceAll("{implementation_command}", "/rpi-implement-plan");
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
  return [
    { match: /^name description$/, reason: "frontmatter keys" },
    { match: /^date current date and time with timezone in iso format$/, reason: "template frontmatter placeholders" },
    { match: /^current date and time with timezone in iso format git$/, reason: "template frontmatter placeholders" },
    { match: /^date and time with timezone in iso format git commit$/, reason: "template frontmatter placeholders" },
    { match: /^task eng xxxx description type [a-z]+/, reason: "template frontmatter placeholders" },
    { match: /^eng xxxx description type [a-z]+/, reason: "template frontmatter placeholders" },
    { match: /^xxxx description type [a-z]+/, reason: "template frontmatter placeholders" },
    { match: /^description type [a-z]+ [a-z]+ repo current repository branch/, reason: "template frontmatter placeholders" },
    { match: /^type [a-z]+ [a-z]+ repo current repository branch current branch name$/, reason: "template frontmatter placeholders" },
    { match: /repo current repository branch current branch name sha/, reason: "template frontmatter placeholders" },
    { match: /current repository branch current branch name sha result of git/, reason: "template frontmatter placeholders" },
    { match: /^disabled false pathtemplate humanlayer workspaces taskslug repobasename branchtemplate taskslug sourceref$/, reason: "workspace json schema example" },
    { match: /^false pathtemplate humanlayer workspaces taskslug repobasename branchtemplate taskslug sourceref origin$/, reason: "workspace json schema example" },
    { match: /^pathtemplate humanlayer workspaces taskslug repobasename branchtemplate taskslug sourceref origin main$/, reason: "workspace json schema example" },
    { match: /^doctype html html lang en head meta charset utf 8$/, reason: "html document boilerplate" },
    { match: /^html html lang en head meta charset utf 8 meta$/, reason: "html document boilerplate" },
    { match: /^html lang en head meta charset utf 8 meta name$/, reason: "html document boilerplate" },
    { match: /^lang en head meta charset utf 8 meta name viewport$/, reason: "html document boilerplate" },
    { match: /^en head meta charset utf 8 meta name viewport content$/, reason: "html document boilerplate" },
    { match: /^meta name viewport content width device width initial scale 1$/, reason: "html document boilerplate" },
    { match: /\brpi\b/, reason: "command names" },
    { match: /\bhl task context\b|\bhl artifact save\b|\bhl get artifact comments\b|\bhl update artifact comments\b|\bhl reply to artifact comment\b/, reason: "tool names" },
  ].some((rule) => rule.match.test(shingle) && rule.reason);
}
