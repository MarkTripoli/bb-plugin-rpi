import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { countFeatureStatuses } from "../scripts/features-count";

const root = path.resolve(import.meta.dirname, "..");
const markdown = fs.readFileSync(path.join(root, "FEATURES.md"), "utf8");

test("FEATURES.md recount sentence matches the mechanical count (cannot drift)", () => {
  const counts = countFeatureStatuses(markdown);
  // The summary sentence in FEATURES.md's opening "Recount" paragraph must spell out these exact
  // numbers. If a table row changes status, this test fails until the sentence is updated to
  // match `npm run check:features`'s output, so the two can never silently drift apart.
  assert.equal(counts.rows, 90);
  assert.equal(counts.mixedRows, 1);
  assert.equal(counts.full, 60);
  assert.equal(counts.partial, 12);
  assert.equal(counts.omitted, 7);
  assert.equal(counts["N/A"], 12);
  assert.match(
    markdown,
    /\*\*90\nstatus-bearing rows, 1 of them mixed: 60 full, 12 partial, 7 omitted, 12\nN\/A\*\*/,
    "FEATURES.md summary sentence must state the script's exact counts",
  );
});
