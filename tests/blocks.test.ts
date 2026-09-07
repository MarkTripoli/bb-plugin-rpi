import test from "node:test";
import assert from "node:assert/strict";
import { markdownBlocks } from "../blocks";

test("markdownBlocks returns one block per non-blank line", () => {
  const blocks = markdownBlocks("first line\nsecond line\n\nthird line");
  assert.deepEqual(blocks.map((block) => block.text), ["first line", "second line", "third line"]);
  assert.deepEqual(blocks.map((block) => block.index), [0, 1, 2]);
});

test("markdownBlocks offsets cover each line including its newline", () => {
  const text = "ab\n\ncd\n";
  const blocks = markdownBlocks(text);
  assert.deepEqual(blocks.map((block) => [block.start, block.end]), [[0, 3], [4, 7]]);
  assert.equal(text.slice(blocks[1]!.start, blocks[1]!.end), "cd\n");
});

test("markdownBlocks anchors individual lines inside a fenced code block and flags them as code", () => {
  const blocks = markdownBlocks("intro\n```ts\nconst a = 1;\n\nconst b = 2;\n```\noutro");
  assert.deepEqual(blocks.map((block) => block.text), ["intro", "```ts", "const a = 1;", "const b = 2;", "```", "outro"]);
  assert.deepEqual(blocks.map((block) => block.code), [false, true, true, true, true, false]);
});

test("markdownBlocks keeps a trailing line without a final newline", () => {
  const blocks = markdownBlocks("only line");
  assert.deepEqual(blocks.map((block) => block.text), ["only line"]);
  assert.deepEqual([blocks[0]!.start, blocks[0]!.end], [0, 9]);
});

import { markdownGroups } from "../blocks";

const groupsOf = (text: string) => markdownGroups(text, markdownBlocks(text)).map((group) => [group.kind, text.slice(group.start, group.end)]);

test("markdownGroups keeps a soft-wrapped list item, a table and a blockquote together and splits at blank lines", () => {
  const text = "# Title\n\n- first item\n  continues here\n- second item\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n> quoted\n> more\n";
  assert.deepEqual(groupsOf(text), [
    ["prose", "# Title\n"],
    ["prose", "- first item\n  continues here\n"],
    ["prose", "- second item\n"],
    ["prose", "| a | b |\n|---|---|\n| 1 | 2 |\n"],
    ["prose", "> quoted\n> more\n"],
  ]);
});

test("markdownGroups keeps nested list items with their parent item", () => {
  assert.deepEqual(groupsOf("- a\n  - b\n- c"), [["prose", "- a\n  - b\n"], ["prose", "- c"]]);
});

test("markdownGroups makes one fence group including its inner blank lines and closes at the delimiter", () => {
  const text = "intro\n```ts\nconst a = 1;\n\nconst b = 2;\n```\n```sh\nls\n```\noutro";
  assert.deepEqual(groupsOf(text), [
    ["prose", "intro\n"],
    ["fence", "```ts\nconst a = 1;\n\nconst b = 2;\n```\n"],
    ["fence", "```sh\nls\n```\n"],
    ["prose", "outro"],
  ]);
});

test("markdownGroups flags leading frontmatter and treats a lone --- as prose", () => {
  assert.deepEqual(groupsOf("---\ntype: plan\nstatus: draft\n---\n\ntext"), [["frontmatter", "---\ntype: plan\nstatus: draft\n---\n"], ["prose", "text"]]);
  assert.deepEqual(groupsOf("---\ntext"), [["prose", "---\ntext"]]);
});

test("markdownGroups anchors each group to its first line block", () => {
  const text = "a\n\nb\nc\n";
  const groups = markdownGroups(text, markdownBlocks(text));
  assert.deepEqual(groups.map((group) => group.blocks[0]!.index), [0, 1]);
  assert.deepEqual(groups.map((group) => group.blocks.length), [1, 2]);
});
