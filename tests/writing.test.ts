import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { lintWriting, WRITING_ISSUE_LIMIT } from "../writing";

const root = path.resolve(import.meta.dirname, "..");

test("lintWriting flags filler, meta commentary, praise words, and em dashes with line numbers", () => {
  const issues = lintWriting([
    "# Uploads resume from the last saved chunk",
    "It is important to note that the worker retries.",
    "Additionally, the queue drains.",
    "This provides a robust experience.",
    "Retries stop after three attempts \u2014 then the job fails.",
    "The worker retries failed uploads three times.",
  ].join("\n"));
  assert.deepEqual(issues.map((issue) => [issue.line, issue.match.toLowerCase()]), [
    [2, "it is important to note"],
    [3, "additionally,"],
    [4, "robust"],
    [5, "em dash"],
  ]);
});

test("lintWriting skips fenced code and blockquotes", () => {
  const issues = lintWriting([
    "```ts",
    "// basically a robust utility",
    "```",
    "> In summary, quoted source text stays as written.",
    "~~~",
    "note that this is code",
    "~~~",
    "Retries stop after three attempts.",
  ].join("\n"));
  assert.deepEqual(issues, []);
});

test("lintWriting output is bounded", () => {
  const issues = lintWriting(Array.from({ length: 50 }, () => "Basically fine.").join("\n"));
  assert.equal(issues.length, WRITING_ISSUE_LIMIT);
});

test("shipped artifact templates pass the writing lint", () => {
  const offenders: string[] = [];
  for (const file of listFiles(path.join(root, "skills")).filter((file) => file.endsWith("_template.md"))) {
    for (const issue of lintWriting(fs.readFileSync(file, "utf8"))) {
      offenders.push(`${path.relative(root, file)}:${issue.line} ${issue.match}`);
    }
  }
  assert.deepEqual(offenders, []);
});

function listFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? listFiles(full) : [full];
  });
}

// Phase 22 compressed every SKILL.md to about half its words (32k to 16.5k total). These caps
// hold the gain; raise a number only with a phase doc that says why.
const SKILL_WORD_BUDGET = 850;
const SKILLS_TOTAL_WORD_BUDGET = 18000;

test("SKILL.md files stay within their word budgets and use plain prose", () => {
  const skillFiles = listFiles(path.join(root, "skills")).filter((file) => path.basename(file) === "SKILL.md");
  const over: string[] = [];
  const symbols: string[] = [];
  let total = 0;
  for (const file of skillFiles) {
    const content = fs.readFileSync(file, "utf8");
    const words = content.split(/\s+/).filter(Boolean).length;
    total += words;
    if (words > SKILL_WORD_BUDGET) over.push(`${path.relative(root, file)}: ${words}`);
    if (/[≠→]/.test(content)) symbols.push(path.relative(root, file));
  }
  assert.deepEqual(over, [], `over ${SKILL_WORD_BUDGET} words`);
  assert.deepEqual(symbols, [], "caveman symbols (≠, →) in skill prose");
  assert.ok(total <= SKILLS_TOTAL_WORD_BUDGET, `skills total ${total} words exceeds ${SKILLS_TOTAL_WORD_BUDGET}`);
});
