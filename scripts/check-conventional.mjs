import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

export const CONVENTIONAL_HEADER = /^(?:build|chore|ci|docs|feat|fix|perf|refactor|revert|style|test)(?:\([a-z0-9][a-z0-9._/-]*\))?!?: [^\s].*$/;

export function isConventionalHeader(value) {
  return CONVENTIONAL_HEADER.test(value);
}

export function invalidHeaders(values) {
  return values.filter(({ subject }) => !isConventionalHeader(subject));
}

function resolveCommit(ref) {
  return execFileSync("git", ["rev-parse", "--verify", `${ref}^{commit}`], { encoding: "utf8" }).trim();
}

function commitsBetween(base, head) {
  const output = execFileSync("git", ["log", "--format=%H%x00%s", `${base}..${head}`], { encoding: "utf8" }).trimEnd();
  if (!output) return [];
  return output.split("\n").map((line) => {
    const separator = line.indexOf("\0");
    return { sha: line.slice(0, separator), subject: line.slice(separator + 1) };
  });
}

function main() {
  const base = resolveCommit(process.env.BASE_REF || "origin/main");
  const head = resolveCommit(process.env.HEAD_REF || "HEAD");
  const commits = commitsBetween(base, head);
  const failures = invalidHeaders(commits).map(({ sha, subject }) => `commit ${sha.slice(0, 12)}: ${subject}`);
  const shouldCheckTitle = process.env.GITHUB_EVENT_NAME === "pull_request"
    || (!process.env.GITHUB_EVENT_NAME && process.env.PR_TITLE !== undefined);

  if (shouldCheckTitle && !isConventionalHeader(process.env.PR_TITLE || "")) {
    failures.unshift(`pull request title: ${process.env.PR_TITLE || "<empty>"}`);
  }
  if (failures.length) {
    console.error("Expected Conventional Commits headers in the form type(scope)!: description.");
    console.error("Allowed types: build, chore, ci, docs, feat, fix, perf, refactor, revert, style, test.");
    for (const failure of failures) console.error(`- ${failure}`);
    process.exitCode = 1;
    return;
  }
  console.log(`Validated ${shouldCheckTitle ? "the pull request title and " : ""}${commits.length} commit subject${commits.length === 1 ? "" : "s"}.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
