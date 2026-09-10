import { z } from "zod";

export const consentSchema = z.object({
  reportDelivery: z.boolean({
    required_error: "Report delivery consent is required",
  }),
  followUp: z.boolean().optional().default(false),
});

export const attributionSchema = z.object({
  utmSource: z.string().optional(),
  utmMedium: z.string().optional(),
  utmCampaign: z.string().optional(),
  utmTerm: z.string().optional(),
  utmContent: z.string().optional(),
  landingVariant: z.string().optional(),
});

/** Blank or omitted strings become undefined — never a fake placeholder. */
const optionalLeadText = z
  .union([z.string(), z.null(), z.undefined()])
  .transform((value) => {
    if (typeof value !== "string") return undefined;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  });

export const BUSINESS_MODELS = [
  "single_trade",
  "dual_trade",
  "multi_trade_home_services",
] as const;

export const AUDIT_FOCUSES = [
  "plumbing",
  "hvac",
  "electrical",
  "overall_website_conversion",
] as const;

export type BusinessModel = (typeof BUSINESS_MODELS)[number];
export type AuditFocus = (typeof AUDIT_FOCUSES)[number];

const optionalBusinessModel = z
  .union([z.enum(BUSINESS_MODELS), z.null(), z.undefined(), z.literal("")])
  .transform((value) => {
    if (value === "" || value == null) return undefined;
    return value;
  });

const optionalAuditFocus = z
  .union([z.enum(AUDIT_FOCUSES), z.null(), z.undefined(), z.literal("")])
  .transform((value) => {
    if (value === "" || value == null) return undefined;
    return value;
  });

const optionalSecondaryTrades = z
  .union([z.array(z.string()), z.null(), z.undefined()])
  .transform((value) => {
    if (!Array.isArray(value)) return undefined;
    const cleaned = value
      .map((item) => item.trim())
      .filter((item) => item.length > 0);
    return cleaned.length > 0 ? cleaned : undefined;
  });

export const auditSubmissionSchema = z.object({
  websiteUrl: z.string().min(1, "Website URL is required"),
  businessName: z.string().min(1, "Business name is required"),
  firstName: z.string().min(1, "First name is required"),
  email: z.string().email("Valid email is required"),
  trade: optionalLeadText,
  serviceArea: optionalLeadText,
  primaryTrade: optionalLeadText,
  secondaryTrades: optionalSecondaryTrades,
  businessModel: optionalBusinessModel,
  auditFocus: optionalAuditFocus,
  phone: z.string().optional(),
  primaryConcern: z.string().optional(),
  teamSize: z.string().optional(),
  platform: z.string().optional(),
  referralSource: z.string().optional(),
  consent: consentSchema,
  attribution: attributionSchema.optional().default({}),
});

export type AuditSubmission = z.infer<typeof auditSubmissionSchema>;
export type Consent = z.infer<typeof consentSchema>;
export type Attribution = z.infer<typeof attributionSchema>;
