import { auditSubmissionSchema } from "@/lib/schemas/audit-submission";
import { formatOptionalLeadField } from "@/lib/leads/display";

const requiredFields = {
  websiteUrl: "https://example.com",
  businessName: "Test Business",
  firstName: "John",
  email: "john@example.com",
  consent: { reportDelivery: true },
};

describe("audit submission optional lead fields", () => {
  it("accepts a payload with trade and serviceArea omitted", () => {
    const parsed = auditSubmissionSchema.parse(requiredFields);
    expect(parsed.trade).toBeUndefined();
    expect(parsed.serviceArea).toBeUndefined();
  });

  it("stores blank trade/serviceArea as absent, not a placeholder", () => {
    const parsed = auditSubmissionSchema.parse({
      ...requiredFields,
      trade: "   ",
      serviceArea: "",
    });
    expect(parsed.trade).toBeUndefined();
    expect(parsed.serviceArea).toBeUndefined();
  });

  it("still accepts a provided trade and serviceArea", () => {
    const parsed = auditSubmissionSchema.parse({
      ...requiredFields,
      trade: "Plumbing",
      serviceArea: "New York, NY",
    });
    expect(parsed.trade).toBe("Plumbing");
    expect(parsed.serviceArea).toBe("New York, NY");
  });
});

describe("optional lead field display", () => {
  it("shows Not provided instead of undefined or a fake default", () => {
    expect(formatOptionalLeadField(undefined)).toBe("Not provided");
    expect(formatOptionalLeadField(null)).toBe("Not provided");
    expect(formatOptionalLeadField("")).toBe("Not provided");
    expect(formatOptionalLeadField("Plumbing")).toBe("Plumbing");
  });
});
