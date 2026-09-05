// Prints the mechanically counted FEATURES.md status totals (see scripts/features-count.ts).
// tests/features.test.ts asserts FEATURES.md's summary sentence matches this same count, so the
// two cannot drift apart.
import fs from "node:fs";
import path from "node:path";
import { countFeatureStatuses } from "./features-count";

const root = path.resolve(import.meta.dirname, "..");
const markdown = fs.readFileSync(path.join(root, "FEATURES.md"), "utf8");
const counts = countFeatureStatuses(markdown);

console.log(
  `${counts.rows} status-bearing rows, ${counts.mixedRows} mixed: ` +
    `${counts.full} full, ${counts.partial} partial, ${counts.omitted} omitted, ${counts["N/A"]} N/A`,
);
