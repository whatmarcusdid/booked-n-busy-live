import { z } from "zod";
import {
  ACCESS_DENIED_CUSTOMER_MESSAGE,
  isTargetAccessDenied,
} from "../browserless/reasons";

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
    "partial",
    "needs_review",
    "failed",
    "unsupported",
  ]),
  progress: z.object({
    percentage: z.number().min(0).max(100),
    currentStep: z.string(),
  }),
  websiteUrl: z.string(),
  businessName: z.string(),
  submittedAt: z.string(),
  /**
   * Durable execution start. The live session measures the slow-audit
   * threshold from here rather than from page load, so a reload does not
   * restart the countdown.
   */
  startedAt: z.string().optional(),
  elapsedMs: z.number().min(0).optional(),
  completedAt: z.string().optional(),
  report: z
    .object({
      overallScore: z.number().min(0).max(1).nullable(),
      publicationStatus: z.enum([
        "draft",
        "review_required",
        "approved",
        "published",
        "revoked",
        "expired",
      ]),
      pillars: z
        .array(
          z.object({
            key: z.string(),
            name: z.string(),
            score: z.number().min(0).max(1).nullable(),
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

export interface ProgressDiagnosticHint {
  failureType?: string | null;
  httpStatus?: number | null;
}

/**
 * Map internal state to customer-facing progress.
 *
 * Deliberately carries no per-stage time estimate. The stages used to
 * advertise "5-7 minutes" down to "less than a minute", which contradicted
 * the locked timing promise; the live session now shows that single promise
 * and, past the threshold, the slow-audit message instead.
 */
export function getProgressInfo(
  status: string,
  diagnostic?: ProgressDiagnosticHint,
): {
  percentage: number;
  currentStep: string;
} {
  const unsupportedStep = isTargetAccessDenied(
    diagnostic?.failureType,
    diagnostic?.httpStatus,
  )
    ? ACCESS_DENIED_CUSTOMER_MESSAGE
    : "This website type is not supported";

  const statusMap: Record<string, { percentage: number; step: string }> = {
    submitted: {
      percentage: 5,
      step: "Received your request",
    },
    validating: {
      percentage: 15,
      step: "Validating website access",
    },
    discovering: {
      percentage: 30,
      step: "Discovering pages and content",
    },
    rendering: {
      percentage: 45,
      step: "Capturing screenshots and metrics",
    },
    collecting_signals: {
      percentage: 60,
      step: "Analyzing user experience signals",
    },
    scoring: {
      percentage: 75,
      step: "Scoring website performance",
    },
    generating_report: {
      percentage: 85,
      step: "Generating your diagnostic report",
    },
    validating_report: {
      percentage: 95,
      step: "Finalizing report",
    },
    complete: { percentage: 100, step: "Report ready!" },
    partial: {
      percentage: 100,
      step: "Partial report ready",
    },
    needs_review: {
      percentage: 100,
      step: "Results need review",
    },
    failed: {
      percentage: 100,
      step: "Audit could not be completed",
    },
    unsupported: {
      percentage: 100,
      step: unsupportedStep,
    },
  };

  const info = statusMap[status] || statusMap.submitted;

  return {
    percentage: info.percentage,
    currentStep: info.step,
  };
}

/**
 * The five terminal audit states (PRD decision #11). Single source of truth:
 * anything that needs to know "is this audit finished" must derive from this
 * rather than re-listing states, so `unsupported` cannot be missed in one
 * place while being terminal in another.
 */
export const TERMINAL_AUDIT_STATES = [
  "complete",
  "partial",
  "needs_review",
  "failed",
  "unsupported",
] as const;

/**
 * Check if a status is terminal (no further processing).
 *
 * Accepts `expired` in addition to the five audit states because callers also
 * pass report publication statuses through this helper.
 */
export function isTerminalState(status: string): boolean {
  return (
    (TERMINAL_AUDIT_STATES as readonly string[]).includes(status) ||
    status === "expired"
  );
}
