import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

const root = path.resolve(import.meta.dirname, "..");
const EM_DASH = "\u2014";

// AGENTS.md: "No em dashes in prose or UI copy." "Repo prose" is what git considers part of the
// repo: tracked files plus untracked files git does not ignore. Ignored trees (node_modules, the
// agent-written `.rpi/` task artifacts excluded in .git/info/exclude) are not this repo's prose.
function listMarkdownFiles(): string[] {
  return execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard"], { cwd: root, encoding: "utf8" })
    .split("\n")
    .filter((file) => file.endsWith(".md"))
    .map((file) => path.join(root, file))
    .filter((file) => fs.existsSync(file));
}

test("repo prose (*.md) contains no em dashes", () => {
  const offenders: string[] = [];
  for (const file of listMarkdownFiles()) {
    const content = fs.readFileSync(file, "utf8");
    if (content.includes(EM_DASH)) offenders.push(path.relative(root, file));
  }
  assert.deepEqual(offenders, []);
});

test("UI copy (ui/rpi.tsx string/JSX text) contains no em dashes", () => {
  const content = fs.readFileSync(path.join(root, "ui", "rpi.tsx"), "utf8");
  assert.equal(content.includes(EM_DASH), false);
});
