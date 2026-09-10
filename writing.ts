// Filler lint for agent-written artifacts. Runs on rpi_artifact_save so the writing rules in
// skills/WRITING.md have one mechanical check behind them. Pure: no I/O, no bb imports.
//
// ponytail: regex phrase list, not a grammar model. Extend the list when a phrase keeps
// surviving review; do not turn this into a word-count ceiling (docs/phases/18).

export interface WritingIssue {
  line: number;
  match: string;
  text: string;
}

export const WRITING_ISSUE_LIMIT = 20;

const EM_DASH = /\u2014/;

// Case-insensitive, whole-word. Each entry names prose that carries no fact.
const FILLER: RegExp[] = [
  /\b(it is|it's) (important|worth) (to note|noting|to mention|mentioning)\b/i,
  /\b(it should be noted|please note|note that|keep in mind)\b/i,
  /\bas (mentioned|noted|discussed|described|shown) (above|earlier|previously|below)\b/i,
  /\bin this (section|document|chapter)\b/i,
  /\bthis (document|section) (describes|covers|outlines|provides|explains|presents|will)\b/i,
  /\b(in summary|in conclusion|to summarize|to conclude|all in all)\b/i,
  /^\s*(overall|additionally|furthermore|moreover|in addition|lastly|finally),/i,
  /\b(basically|essentially|obviously|clearly|of course)\b/i,
  /\b(in order to|due to the fact that|the fact that|for the purpose of|in the event that|at this point in time|going forward|a (wide )?(number|variety|range) of)\b/i,
  /\b(robust|seamless(ly)?|comprehensive(ly)?|holistic|streamlined?|leverag(e|es|ed|ing)|utiliz(e|es|ed|ing)|cutting[- ]edge|best[- ]in[- ]class|state[- ]of[- ]the[- ]art)\b/i,
  /\b(let's|let us) (take a look|look at|dive|explore|walk through)\b/i,
];

export function lintWriting(markdown: string): WritingIssue[] {
  const issues: WritingIssue[] = [];
  let inFence = false;
  const lines = markdown.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const text = lines[index]!;
    if (/^\s*(```|~~~)/.test(text)) {
      inFence = !inFence;
      continue;
    }
    if (inFence || /^\s*>/.test(text)) continue;
    const hit = EM_DASH.exec(text) ? "em dash" : FILLER.map((pattern) => pattern.exec(text)?.[0]).find(Boolean);
    if (!hit) continue;
    issues.push({ line: index + 1, match: hit, text: text.trim().slice(0, 160) });
    if (issues.length >= WRITING_ISSUE_LIMIT) break;
  }
  return issues;
}
