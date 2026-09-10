import type { ManualLaunchIntent } from "./contract";
import { SKILL_BY_ID } from "./transitions";

const MAX_SEGMENT_LENGTH = 256;
const MAX_ROUTE_LENGTH = 1_024;
const SAFE_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;

function decodeSegment(segment: string): string | null {
  if (segment.length === 0 || segment.length > MAX_ROUTE_LENGTH) return null;
  try {
    const decoded = decodeURIComponent(segment);
    return decoded.length <= MAX_SEGMENT_LENGTH && SAFE_SEGMENT.test(decoded) ? decoded : null;
  } catch {
    return null;
  }
}

function encodeSegment(segment: string): string {
  if (segment.length > MAX_SEGMENT_LENGTH || !SAFE_SEGMENT.test(segment)) {
    throw new Error("Manual launch route contains an invalid identifier.");
  }
  return encodeURIComponent(segment);
}

export function buildManualLaunchRoute(intent: ManualLaunchIntent): string {
  if (intent.kind === "draft") return `compose/draft/${encodeSegment(intent.taskId)}`;
  if (intent.kind === "skill") {
    if (!Object.hasOwn(SKILL_BY_ID, intent.skillId)) throw new Error("Manual launch route contains an unknown skill.");
    return `compose/skill/${encodeSegment(intent.taskId)}/${encodeSegment(intent.skillId)}`;
  }
  if (intent.kind === "completion") {
    if (!Object.hasOwn(SKILL_BY_ID, intent.skillId)) throw new Error("Manual launch route contains an unknown skill.");
    return `compose/completion/${encodeSegment(intent.threadId)}/${encodeSegment(intent.skillId)}`;
  }
  return `compose/${intent.kind}/${encodeSegment(intent.threadId)}`;
}

export function parseManualLaunchRoute(subPath: string): ManualLaunchIntent | null {
  if (subPath.length > MAX_ROUTE_LENGTH) return null;
  const segments = subPath.split("/");
  if (segments[0] !== "compose") return null;

  if (segments.length === 3 && segments[1] === "draft") {
    const taskId = decodeSegment(segments[2]!);
    return taskId ? { kind: "draft", taskId } : null;
  }
  if (segments.length === 4 && segments[1] === "skill") {
    const taskId = decodeSegment(segments[2]!);
    const skillId = decodeSegment(segments[3]!);
    return taskId && skillId && Object.hasOwn(SKILL_BY_ID, skillId) ? { kind: "skill", taskId, skillId } : null;
  }
  if (segments.length === 4 && segments[1] === "completion") {
    const threadId = decodeSegment(segments[2]!);
    const skillId = decodeSegment(segments[3]!);
    return threadId && skillId && Object.hasOwn(SKILL_BY_ID, skillId) ? { kind: "completion", threadId, skillId } : null;
  }
  if (segments.length === 3 && (segments[1] === "proceed" || segments[1] === "iterate")) {
    const threadId = decodeSegment(segments[2]!);
    return threadId ? { kind: segments[1], threadId } : null;
  }
  return null;
}
