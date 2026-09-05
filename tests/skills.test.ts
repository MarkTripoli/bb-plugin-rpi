import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { extractNextStep } from "../extraction";

const root = path.resolve(import.meta.dirname, "..");

const finalTemplateExpectations = [
  ["skills/rpi-create-research-questions/references/research_questions_final_answer.md", "create-research"],
  ["skills/rpi-iterate-research-questions/references/research_questions_final_answer.md", "create-research"],
  ["skills/rpi-create-research/references/research_final_answer.md", "create-design-discussion"],
  ["skills/rpi-iterate-research/references/research_final_answer.md", "create-design-discussion"],
  ["skills/rpi-create-design-discussion/references/design_discussion_final_answer.md", "create-structure-outline"],
  ["skills/rpi-iterate-design-discussion/references/design_discussion_final_answer.md", "create-structure-outline"],
  ["skills/rpi-create-prd/references/prd_final_answer.md", "create-tdd"],
  ["skills/rpi-iterate-prd/references/prd_final_answer.md", "create-tdd"],
  ["skills/rpi-create-tdd/references/tdd_final_answer.md", "create-structure-outline"],
  ["skills/rpi-iterate-tdd/references/tdd_final_answer.md", "create-structure-outline"],
  ["skills/rpi-create-structure-outline/references/structure_outline_final_answer.md", "implement-outline"],
  ["skills/rpi-iterate-structure-outline/references/structure_outline_final_answer.md", "implement-outline"],
  ["skills/rpi-create-plan/references/plan_final_answer.md", "setup-worktree"],
  ["skills/rpi-iterate-plan/references/plan_final_answer.md", "setup-worktree"],
  ["skills/rpi-configure-workspaces/references/workspace_final_answer.md", "setup-worktree"],
  ["skills/rpi-setup-worktree/references/worktree_final_answer.md", "implement-plan"],
  ["skills/rpi-implement-plan/references/implementation_final_answer.md", "ci-commit"],
  ["skills/rpi-implement-outline/references/implementation_final_answer.md", "ci-commit"],
  ["skills/rpi-iterate-implementation/references/implementation_final_answer.md", "ci-commit"],
  ["skills/rpi-describe-pr/references/pr_description_final_answer.md", "show-me"],
  ["skills/rpi-ci-commit/references/commit_final_answer.md", "describe-pr"],
  ["skills/rpi-review-artifact-comments/references/comments_final_answer.md", "iterate-implementation"],
  ["skills/rpi-show-me/references/show_me_final_answer.md", "show-me"],
] as const;

test("every final-answer template parses to the expected next skill", () => {
  for (const [relativePath, expectedSkill] of finalTemplateExpectations) {
    const content = fillTemplate(fs.readFileSync(path.join(root, relativePath), "utf8"));
    const result = extractNextStep(content, {
      liveArtifactNames: ["01-artifact.md"],
      taskSlug: "task-slug",
      parsedAt: 1,
    });
    assert.equal(result.extraction.type, "next_step_found", relativePath);
    if (result.extraction.type === "next_step_found") {
      assert.equal(result.extraction.nextStepType, expectedSkill, relativePath);
    }
    assertNoFenceAfterCommand(content, relativePath);
  }
});

test("all shipped final-answer templates are covered", () => {
  const found = listFiles(path.join(root, "skills"))
    .map((file) => path.relative(root, file))
    .filter((file) => file.includes(`${path.sep}references${path.sep}`) && /final/i.test(path.basename(file)))
    .sort();
  assert.deepEqual(found, finalTemplateExpectations.map(([file]) => file).sort());
});

test("rewritten skills do not contain long HumanLayer reference shingles", () => {
  const referenceShingles = new Set<string>();
  for (const file of listFiles(path.join(root, "docs", "hl-reference"))) {
    for (const shingle of shingles(fs.readFileSync(file, "utf8"), 12)) referenceShingles.add(shingle);
  }

  for (const file of listFiles(path.join(root, "skills")).filter((item) => path.basename(item) === "SKILL.md")) {
    for (const shingle of shingles(fs.readFileSync(file, "utf8"), 12)) {
      assert.equal(referenceShingles.has(shingle), false, `${path.relative(root, file)} copies: ${shingle}`);
    }
  }
});

function fillTemplate(input: string) {
  return input
    .replaceAll("{artifact_directive}", "::hl-artifact{task=\"task-id\" file=\"01-artifact.md\"}")
    .replaceAll("{summary}", "Saved the requested artifact.")
    .replaceAll("{artifact_file}", "01-artifact.md");
}

function assertNoFenceAfterCommand(content: string, label: string) {
  const fences = [...content.matchAll(/```([^\r\n]*)\r?\n([\s\S]*?)```/g)];
  const commandFence = fences.find((match) => /^\/rpi[-:][a-z][a-z0-9-]*(\s+.*)?$/m.test(match[2] ?? ""));
  assert.ok(commandFence, `missing command fence in ${label}`);
  const after = content.slice((commandFence.index ?? 0) + commandFence[0].length);
  assert.equal(after.includes("```"), false, `fenced block after command in ${label}`);
}

function listFiles(dir: string): string[] {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  return entries.flatMap((entry) => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? listFiles(full) : [full];
  });
}

function shingles(input: string, size: number) {
  const words = input.toLowerCase().match(/[a-z0-9_/-]+/g) ?? [];
  const out: string[] = [];
  for (let index = 0; index + size <= words.length; index += 1) {
    out.push(words.slice(index, index + size).join(" "));
  }
  return out;
}
