// Asserts the published npm tarball actually ships dist/** (the built plugin) and never leaks
// docs/ or tests/ (source-only / reference-only material, docs/hl-reference/ in particular is
// HumanLayer's own All-Rights-Reserved reference material and must never be published or
// committed; see LICENSE, README.md "Licensing", and AGENTS.md item 6).
import { execFileSync } from "node:child_process";

type PackEntry = { path: string };
type PackResult = { files: PackEntry[] }[];

const output = execFileSync("npm", ["pack", "--dry-run", "--json"], { encoding: "utf8" });
const [result] = JSON.parse(output) as PackResult;
const paths = result.files.map((file) => file.path);

function assertPresent(prefix: string) {
  const found = paths.some((path) => path === prefix || path.startsWith(`${prefix}/`));
  if (!found) throw new Error(`npm pack must include ${prefix}, but no such entry was found.\nEntries:\n${paths.join("\n")}`);
}

function assertAbsent(prefix: string) {
  const offenders = paths.filter((path) => path === prefix || path.startsWith(`${prefix}/`));
  if (offenders.length > 0) throw new Error(`npm pack must not include ${prefix}, but found:\n${offenders.join("\n")}`);
}

assertPresent("dist");
assertPresent("PARITY.md");
assertPresent("LICENSE");
assertPresent("README.md");
assertAbsent("docs");
assertAbsent("tests");
assertAbsent("docs/hl-reference");

console.log(`npm pack contains ${paths.length} entries; dist/PARITY.md/LICENSE/README.md present, docs/ and tests/ absent.`);
