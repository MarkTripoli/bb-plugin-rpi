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
