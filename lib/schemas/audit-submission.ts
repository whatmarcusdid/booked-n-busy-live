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

export const auditSubmissionSchema = z.object({
  websiteUrl: z.string().min(1, "Website URL is required"),
  businessName: z.string().min(1, "Business name is required"),
  firstName: z.string().min(1, "First name is required"),
  email: z.string().email("Valid email is required"),
  trade: z.string().min(1, "Trade is required"),
  serviceArea: z.string().min(1, "Service area is required"),
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
