import { z } from "zod";
import { isAiNarrationEnabled } from "../flags";
import type { AssembledReport } from "./schema";

export const NARRATION_MODEL = "anthropic/claude-haiku-4.5";
export const NARRATION_TEMPERATURE = 0.2;

export const narrationOutputSchema = z.object({
  executiveSummary: z.string().min(1),
  recommendations: z.array(
    z.object({
      criterion_key: z.string(),
      title: z.string().min(1),
      description: z.string().min(1),
      evidence_ids: z.array(z.string()),
    }),
  ),
});

export type NarrationOutput = z.infer<typeof narrationOutputSchema>;

export type NarrationSource = "template" | "ai";

export interface NarrationEligibleInput {
  websiteUrl: string;
  overallScore: number | null;
  noMajorIssues: boolean;
  pillars: Array<{
    key: string;
    name: string;
    score: number | null;
    display: "score" | "not_measured";
    assessedCount: number;
  }>;
  checks: Array<{
    key: string;
    name: string;
    pillar: string;
    outcome: string;
    assessed: boolean;
    evidence_ids: string[];
  }>;
  recommendations: Array<{
    criterion_key: string;
    priority: string;
    pillar: string;
    evidence_ids: string[];
  }>;
}

export type GenerateNarration = (
  input: NarrationEligibleInput,
  validationHint?: string,
) => Promise<unknown>;

const HTML_LIKE = /<\/?[a-z][\s\S]*>/i;

export function buildNarrationInput(
  assembled: AssembledReport,
): NarrationEligibleInput {
  return {
    websiteUrl: assembled.websiteUrl,
    overallScore: assembled.overallScore,
    noMajorIssues: assembled.noMajorIssues,
    pillars: assembled.pillars.map((pillar) => ({
      key: pillar.key,
      name: pillar.name,
      score: pillar.score,
      display: pillar.display,
      assessedCount: pillar.assessedCount,
    })),
    checks: assembled.pillars.flatMap((pillar) =>
      pillar.checks.map((check) => ({
        key: check.key,
        name: check.name,
        pillar: pillar.key,
        outcome: check.outcome,
        assessed: check.assessed,
        evidence_ids:
          assembled.recommendations.find((row) => row.criterion_key === check.key)
            ?.evidence_ids ?? [],
      })),
    ),
    recommendations: assembled.recommendations.map((row) => ({
      criterion_key: row.criterion_key,
      priority: row.priority,
      pillar: row.pillar,
      evidence_ids: row.evidence_ids,
    })),
  };
}

export function assertNoRawHtml(input: NarrationEligibleInput): void {
  const blob = JSON.stringify(input);
  if (HTML_LIKE.test(blob) || blob.includes("internal_notes")) {
    throw new Error("Narration input must not include raw HTML or internal notes");
  }
}

function allowedEvidenceByKey(assembled: AssembledReport): Map<string, Set<string>> {
  return new Map(
    assembled.recommendations.map((row) => [row.criterion_key, new Set(row.evidence_ids)]),
  );
}

export function validateNarrationAgainstAssembled(
  assembled: AssembledReport,
  output: NarrationOutput,
): { ok: true } | { ok: false; hint: string } {
  const allowed = allowedEvidenceByKey(assembled);
  if (output.recommendations.length !== assembled.recommendations.length) {
    return {
      ok: false,
      hint: `Return exactly ${assembled.recommendations.length} recommendations, one per selected check.`,
    };
  }
  for (const rec of output.recommendations) {
    const allowedIds = allowed.get(rec.criterion_key);
    if (!allowedIds) {
      return {
        ok: false,
        hint: `Unknown criterion_key ${rec.criterion_key}. Use only the selected recommendation keys.`,
      };
    }
    if (!("evidence_ids" in rec)) {
      return { ok: false, hint: "Every recommendation must include evidence_ids." };
    }
    const invented = rec.evidence_ids.filter((id) => !allowedIds.has(id));
    if (invented.length > 0) {
      return {
        ok: false,
        hint: `evidence_ids must be drawn from the provided findings only.`,
      };
    }
    if (allowedIds.size > 0 && rec.evidence_ids.length === 0) {
      return {
        ok: false,
        hint: `Recommendation ${rec.criterion_key} must include its justifying evidence_ids.`,
      };
    }
  }
  return { ok: true };
}

export function applyNarration(
  assembled: AssembledReport,
  output: NarrationOutput,
): AssembledReport {
  const byKey = new Map(output.recommendations.map((row) => [row.criterion_key, row]));
  return {
    ...assembled,
    executiveSummary: output.executiveSummary,
    recommendations: assembled.recommendations.map((row) => {
      const narrated = byKey.get(row.criterion_key);
      if (!narrated) return row;
      return {
        ...row,
        title: narrated.title,
        description: narrated.description,
        evidence_ids: narrated.evidence_ids,
      };
    }),
  };
}

export async function generateNarrationViaGateway(
  input: NarrationEligibleInput,
  validationHint?: string,
): Promise<unknown> {
  const { generateText, Output } = await import("ai");
  const result = await generateText({
    model: process.env.AI_GATEWAY_MODEL ?? NARRATION_MODEL,
    temperature: NARRATION_TEMPERATURE,
    output: Output.object({
      name: "AuditNarration",
      description: "Customer-facing audit narration grounded in supplied findings.",
      schema: narrationOutputSchema,
    }),
    system:
      "Rewrite the supplied audit findings into brief customer-facing copy. Use only the structured findings. Do not invent checks, scores, or evidence IDs. Every recommendation must include the evidence_ids you were given.",
    prompt: JSON.stringify({
      findings: input,
      validationHint: validationHint ?? null,
    }),
  });
  return result.output;
}

export async function narrateAssembledReport(
  assembled: AssembledReport,
  deps: {
    enabled?: boolean;
    generate?: GenerateNarration;
  } = {},
): Promise<{ source: NarrationSource; report: AssembledReport }> {
  const enabled = deps.enabled ?? isAiNarrationEnabled();
  if (!enabled) {
    return { source: "template", report: assembled };
  }

  const input = buildNarrationInput(assembled);
  assertNoRawHtml(input);
  const generate = deps.generate ?? generateNarrationViaGateway;

  const attempt = async (hint?: string) => {
    const raw = await generate(input, hint);
    const parsed = narrationOutputSchema.safeParse(raw);
    if (!parsed.success) {
      return {
        ok: false as const,
        hint: parsed.error.issues.map((issue) => issue.message).join("; "),
      };
    }
    const grounded = validateNarrationAgainstAssembled(assembled, parsed.data);
    if (!grounded.ok) return grounded;
    return { ok: true as const, data: parsed.data };
  };

  try {
    const first = await attempt();
    if (first.ok) {
      return { source: "ai", report: applyNarration(assembled, first.data) };
    }
    const second = await attempt(first.hint);
    if (second.ok) {
      return { source: "ai", report: applyNarration(assembled, second.data) };
    }
  } catch {
    // Fall through to template. Never block report generation on the model.
  }

  return { source: "template", report: assembled };
}
