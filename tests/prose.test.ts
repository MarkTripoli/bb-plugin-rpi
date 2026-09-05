import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

const root = path.resolve(import.meta.dirname, "..");
const EM_DASH = "\u2014";

// AGENTS.md: "No em dashes in prose or UI copy." docs/research/ and the moved-out
// docs/hl-reference/ are excluded: research notes quote external sources verbatim, and
// hl-reference is HumanLayer's own material (not this repo's prose) kept outside the tree.
const EXCLUDED_DIR_PARTS = ["docs/research", "docs/hl-reference", "node_modules"];

function listMarkdownFiles(dir: string): string[] {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    const relative = path.relative(root, full).split(path.sep).join("/");
    if (EXCLUDED_DIR_PARTS.some((excluded) => relative === excluded || relative.startsWith(`${excluded}/`))) continue;
    if (entry.isDirectory()) {
      files.push(...listMarkdownFiles(full));
    } else if (entry.name.endsWith(".md")) {
      files.push(full);
    }
  }
  return files;
}

test("repo prose (*.md outside docs/research and docs/hl-reference) contains no em dashes", () => {
  const offenders: string[] = [];
  for (const file of listMarkdownFiles(root)) {
    const content = fs.readFileSync(file, "utf8");
    if (content.includes(EM_DASH)) offenders.push(path.relative(root, file));
  }
  assert.deepEqual(offenders, []);
});

test("UI copy (ui/humanlayer.tsx string/JSX text) contains no em dashes", () => {
  const content = fs.readFileSync(path.join(root, "ui", "humanlayer.tsx"), "utf8");
  assert.equal(content.includes(EM_DASH), false);
});
