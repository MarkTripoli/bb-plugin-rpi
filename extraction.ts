import { normalizeSkillId, skillInfo } from "./transitions";

export type NextStepExtraction =
  | {
      type: "next_step_found";
      nextStepPrompt: string;
      nextStepSummary: string;
      nextStepType: string;
      taskReference: string | null;
      suggestedDirectory: null;
    }
  | { type: "no_next_step"; reason: string };

export type NextStepSuggestions = {
  parsedAt: number;
  extraction: NextStepExtraction;
  extractionError?: string;
};

export function noNextStep(reason: string, parsedAt = Date.now()): NextStepSuggestions {
  return { parsedAt, extraction: { type: "no_next_step", reason } };
}

export function extractNextStep(
  lastAssistantText: string,
  options: { liveArtifactNames: Iterable<string>; taskSlug?: string | null; parsedAt?: number },
): NextStepSuggestions {
  const liveArtifacts = new Set([...options.liveArtifactNames]);
  let commandLine: string | null = null;
  const fence = /```([^\r\n]*)\r?\n([\s\S]*?)```/g;
  for (const match of lastAssistantText.matchAll(fence)) {
    const language = (match[1] ?? "").trim().toLowerCase();
    if (language !== "" && language !== "text") continue;
    const firstLine = (match[2] ?? "").split(/\r?\n/).find((line) => line.trim() !== "")?.trim();
    if (firstLine && /^\/rpi[-:][a-z][a-z0-9-]*(\s+.*)?$/.test(firstLine)) {
      commandLine = firstLine;
    }
  }
  const parsedAt = options.parsedAt ?? Date.now();
  if (!commandLine) return noNextStep("no command block", parsedAt);

  const command = /^\/rpi[-:]([a-z][a-z0-9-]*)(\s+.*)?$/.exec(commandLine);
  if (!command) return noNextStep("no command block", parsedAt);
  const skillId = normalizeSkillId(command[1]!);
  const info = skillInfo(skillId);
  if (!info) return noNextStep(`unknown skill ${command[1]}`, parsedAt);

  const args = command[2] ?? "";
  for (const artifact of artifactMentions(args)) {
    if (!liveArtifacts.has(artifact)) return noNextStep(`unknown artifact ${artifact}`, parsedAt);
  }

  return {
    parsedAt,
    extraction: {
      type: "next_step_found",
      nextStepPrompt: `/rpi-${skillId}${args}`,
      nextStepSummary: info.buttonText,
      nextStepType: skillId,
      taskReference: options.taskSlug ?? null,
      suggestedDirectory: null,
    },
  };
}

function artifactMentions(args: string) {
  return [...args.matchAll(/@([^\s]+)/g)].map((match) => match[1]!.replace(/[),.;:]+$/, ""));
}
