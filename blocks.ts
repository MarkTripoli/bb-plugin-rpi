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

export type MarkdownGroup = {
  kind: "prose" | "fence" | "frontmatter";
  blocks: MarkdownBlock[];
  start: number;
  end: number;
};

const TOP_LEVEL_LIST_ITEM = /^(?:[-*+]|\d+[.)])\s/;

// Rendering units over the line blocks. A line is what a comment anchors to; a group is what
// the viewer hands to one `<Markdown>` call so soft-wrapped list items, tables, blockquotes
// and fenced code survive intact. A group ends at a blank line, a fence closer, a top-level
// list marker or the frontmatter closer. The gutter for a group anchors to its first line.
export function markdownGroups(text: string, blocks: MarkdownBlock[]) {
  const groups: MarkdownGroup[] = [];
  const frontmatterEnd = blocks[0]?.start === 0 && blocks[0].text === "---" ? blocks.findIndex((block, i) => i > 0 && block.text === "---") : -1;
  let open: MarkdownGroup | null = null;
  for (const block of blocks) {
    const kind: MarkdownGroup["kind"] = block.index <= frontmatterEnd ? "frontmatter" : block.code ? "fence" : "prose";
    const joins =
      open !== null &&
      open.kind === kind &&
      (kind !== "prose" || (open.end === block.start && !TOP_LEVEL_LIST_ITEM.test(text.slice(block.start, block.end))));
    if (open !== null && joins) {
      open.blocks.push(block);
      open.end = block.end;
    } else {
      open = { kind, blocks: [block], start: block.start, end: block.end };
      groups.push(open);
    }
    if (kind === "fence" && open.blocks.length > 1 && /^\s*```/.test(block.text)) open = null;
  }
  return groups;
}
