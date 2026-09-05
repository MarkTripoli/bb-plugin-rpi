export type MarkdownBlock = {
  index: number;
  text: string;
  start: number;
  end: number;
};

export function markdownBlocks(text: string) {
  const blocks: MarkdownBlock[] = [];
  let start = 0;
  let cursor = 0;
  let inFence = false;
  const lines = text.match(/[^\n]*(?:\n|$)/g) ?? [];
  for (const line of lines) {
    if (line === "") break;
    const lineStart = cursor;
    cursor += line.length;
    if (/^\s*```/.test(line)) inFence = !inFence;
    if (!inFence && line.trim() === "") {
      const blockText = text.slice(start, lineStart).trim();
      if (blockText) blocks.push({ index: blocks.length, text: blockText, start, end: lineStart });
      start = cursor;
    }
  }
  const tail = text.slice(start).trim();
  if (tail) blocks.push({ index: blocks.length, text: tail, start, end: text.length });
  return blocks;
}
