export type MarkdownBlock = {
  index: number;
  text: string;
  start: number;
  end: number;
  /** True for fence delimiter lines and every line inside a fenced code block. */
  code: boolean;
};

// One block per non-blank line so comments anchor to a line. Fence state no longer suppresses
// splitting (a line inside a fence is exactly what should be anchorable); it only marks the block
// so the UI can render it as code instead of as a one-line Markdown document.
export function markdownBlocks(text: string) {
  const blocks: MarkdownBlock[] = [];
  let cursor = 0;
  let inFence = false;
  const lines = text.match(/[^\n]*(?:\n|$)/g) ?? [];
  for (const line of lines) {
    if (line === "") break;
    const start = cursor;
    cursor += line.length;
    if (line.trim() === "") continue;
    const isDelimiter = /^\s*```/.test(line);
    blocks.push({ index: blocks.length, text: line.trim(), start, end: cursor, code: inFence || isDelimiter });
    if (isDelimiter) inFence = !inFence;
  }
  return blocks;
}
