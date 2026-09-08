import { z } from "zod";
import { RULE_VERSION } from "../audit-workflow/rubric/model";

export const assembledCheckSchema = z.object({
  key: z.string(),
  name: z.string(),
  outcome: z.string(),
  assessed: z.boolean(),
  score: z.number(),
});

export const assembledPillarSchema = z.object({
  key: z.string(),
  name: z.string(),
  score: z.number().min(0).max(1).nullable(),
  measured: z.boolean(),
  display: z.enum(["score", "not_measured"]),
  criteriaCount: z.number().int().min(0),
  assessedCount: z.number().int().min(0),
  notAssessedCount: z.number().int().min(0),
  checks: z.array(assembledCheckSchema),
});

export const assembledRecommendationSchema = z.object({
  criterion_key: z.string(),
  priority: z.enum(["fix_first", "fix_next", "improve_later"]),
  title: z.string(),
  description: z.string(),
  pillar: z.string(),
  evidence_ids: z.array(z.string()),
});

export const assembledReportSchema = z.object({
  ruleVersion: z.literal(RULE_VERSION),
  websiteUrl: z.string(),
  overallScore: z.number().min(0).max(1).nullable(),
  executiveSummary: z.string(),
  noMajorIssues: z.boolean(),
  pillars: z.array(assembledPillarSchema),
  recommendations: z.array(assembledRecommendationSchema),
});

export type AssembledReport = z.infer<typeof assembledReportSchema>;
