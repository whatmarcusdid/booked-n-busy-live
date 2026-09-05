import { z } from "zod";

/**
 * Customer-safe audit status response schema
 * Does not expose any PII or internal details
 */

export const auditStatusResponseSchema = z.object({
  auditId: z.string().uuid(),
  status: z.enum([
    "submitted",
    "validating",
    "discovering",
    "rendering",
    "collecting_signals",
    "scoring",
    "generating_report",
    "validating_report",
    "complete",
  ]),
  progress: z.object({
    percentage: z.number().min(0).max(100),
    currentStep: z.string(),
    estimatedTimeRemaining: z.string().optional(),
  }),
  websiteUrl: z.string(),
  businessName: z.string(),
  submittedAt: z.string(),
  completedAt: z.string().optional(),
  report: z
    .object({
      overallScore: z.number().min(0).max(1),
      publicationStatus: z.enum([
        "draft",
        "review_required",
        "approved",
        "published",
      ]),
      pillars: z
        .array(
          z.object({
            key: z.string(),
            name: z.string(),
            score: z.number().min(0).max(1),
          }),
        )
        .optional(),
      topRecommendations: z
        .array(
          z.object({
            priority: z.string(),
            title: z.string(),
            description: z.string(),
          }),
        )
        .optional(),
    })
    .optional(),
});

export type AuditStatusResponse = z.infer<typeof auditStatusResponseSchema>;

/**
 * Map internal state to customer-facing progress
 */
export function getProgressInfo(status: string): {
  percentage: number;
  currentStep: string;
  estimatedTimeRemaining?: string;
} {
  const statusMap: Record<
    string,
    { percentage: number; step: string; eta?: string }
  > = {
    submitted: {
      percentage: 5,
      step: "Received your request",
      eta: "5-7 minutes",
    },
    validating: {
      percentage: 15,
      step: "Validating website access",
      eta: "4-6 minutes",
    },
    discovering: {
      percentage: 30,
      step: "Discovering pages and content",
      eta: "3-5 minutes",
    },
    rendering: {
      percentage: 45,
      step: "Capturing screenshots and metrics",
      eta: "2-4 minutes",
    },
    collecting_signals: {
      percentage: 60,
      step: "Analyzing user experience signals",
      eta: "2-3 minutes",
    },
    scoring: {
      percentage: 75,
      step: "Scoring website performance",
      eta: "1-2 minutes",
    },
    generating_report: {
      percentage: 85,
      step: "Generating your diagnostic report",
      eta: "1 minute",
    },
    validating_report: {
      percentage: 95,
      step: "Finalizing report",
      eta: "Less than a minute",
    },
    complete: { percentage: 100, step: "Report ready!" },
  };

  const info = statusMap[status] || statusMap.submitted;

  return {
    percentage: info.percentage,
    currentStep: info.step,
    estimatedTimeRemaining: info.eta,
  };
}

/**
 * Check if a status is terminal (no further processing)
 */
export function isTerminalState(status: string): boolean {
  return status === "complete" || status === "failed" || status === "expired";
}
