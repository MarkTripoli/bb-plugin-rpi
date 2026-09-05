// Mechanical status-column counter for PARITY.md. A table's status column may mix two
// statuses in one cell (e.g. "N/A (bb owns X) / full (Y)"); each named status is counted
// once. Used by scripts/check-parity.ts (prints the counts) and tests/parity.test.ts
// (asserts the summary sentence in PARITY.md cannot drift from this count).
const STATUS_TOKENS = ["full", "partial", "omitted", "N/A"] as const;
export type StatusToken = (typeof STATUS_TOKENS)[number];

export interface ParityCounts {
  full: number;
  partial: number;
  omitted: number;
  "N/A": number;
  rows: number;
  mixedRows: number;
}

function splitTableRow(line: string): string[] | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith("|")) return null;
  const cells = trimmed.slice(1, trimmed.endsWith("|") ? -1 : undefined).split("|");
  return cells.map((cell) => cell.trim());
}

function isSeparatorRow(cells: string[]): boolean {
  return cells.every((cell) => /^:?-+:?$/.test(cell));
}

export function countParityStatuses(markdown: string): ParityCounts {
  const counts: ParityCounts = { full: 0, partial: 0, omitted: 0, "N/A": 0, rows: 0, mixedRows: 0 };
  const lines = markdown.split("\n");
  let statusIndex = -1;
  for (const line of lines) {
    const cells = splitTableRow(line);
    if (!cells) {
      statusIndex = -1;
      continue;
    }
    if (isSeparatorRow(cells)) continue;
    const headerIndex = cells.findIndex((cell) => /^(bb )?status$/i.test(cell));
    if (headerIndex >= 0) {
      statusIndex = headerIndex;
      continue;
    }
    if (statusIndex < 0 || statusIndex >= cells.length) continue;
    const cell = cells[statusIndex];
    const segments = cell.split(" / ");
    const found: StatusToken[] = [];
    for (const segment of segments) {
      const match = segment.match(/\b(full|partial|omitted|N\/A)\b/i);
      if (!match) continue;
      const token = (match[1].toUpperCase() === "N/A" ? "N/A" : match[1].toLowerCase()) as StatusToken;
      found.push(token);
    }
    if (found.length === 0) continue;
    counts.rows += 1;
    if (found.length > 1) counts.mixedRows += 1;
    for (const token of found) counts[token] += 1;
  }
  return counts;
}
