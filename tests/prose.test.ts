import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

const root = path.resolve(import.meta.dirname, "..");
const EM_DASH = "\u2014";

// AGENTS.md: "No em dashes in prose or UI copy." node_modules is excluded because it isn't this
// repo's prose. The research notes and third-party reference material this repo's design work is
// grounded in both live outside the tree entirely (see AGENTS.md item 6), so there is nothing
// left in-tree to exclude for them.
const EXCLUDED_DIR_PARTS = ["node_modules"];

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

test("repo prose (*.md) contains no em dashes", () => {
  const offenders: string[] = [];
  for (const file of listMarkdownFiles(root)) {
    const content = fs.readFileSync(file, "utf8");
    if (content.includes(EM_DASH)) offenders.push(path.relative(root, file));
  }
  assert.deepEqual(offenders, []);
});

test("UI copy (ui/rpi.tsx string/JSX text) contains no em dashes", () => {
  const content = fs.readFileSync(path.join(root, "ui", "rpi.tsx"), "utf8");
  assert.equal(content.includes(EM_DASH), false);
});
