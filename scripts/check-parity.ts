// Prints the mechanically counted PARITY.md status totals (see scripts/parity-count.ts).
// tests/parity.test.ts asserts PARITY.md's summary sentence matches this same count, so the
// two cannot drift apart.
import fs from "node:fs";
import path from "node:path";
import { countParityStatuses } from "./parity-count";

const root = path.resolve(import.meta.dirname, "..");
const markdown = fs.readFileSync(path.join(root, "PARITY.md"), "utf8");
const counts = countParityStatuses(markdown);

console.log(
  `${counts.rows} status-bearing rows, ${counts.mixedRows} mixed: ` +
    `${counts.full} full, ${counts.partial} partial, ${counts.omitted} omitted, ${counts["N/A"]} N/A`,
);
