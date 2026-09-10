import { auditSubmissionSchema } from "@/lib/schemas/audit-submission";
import {
  formatOptionalLeadField,
  formatOptionalLeadList,
} from "@/lib/leads/display";

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

describe("audit submission service-mix fields (Decision #2)", () => {
  it("accepts a payload with service-mix fields omitted", () => {
    const parsed = auditSubmissionSchema.parse(requiredFields);
    expect(parsed.primaryTrade).toBeUndefined();
    expect(parsed.secondaryTrades).toBeUndefined();
    expect(parsed.businessModel).toBeUndefined();
    expect(parsed.auditFocus).toBeUndefined();
  });

  it("persists supplied service-mix values", () => {
    const parsed = auditSubmissionSchema.parse({
      ...requiredFields,
      primaryTrade: "Plumbing",
      secondaryTrades: ["HVAC", "Electrical"],
      businessModel: "dual_trade",
      auditFocus: "plumbing",
    });
    expect(parsed.primaryTrade).toBe("Plumbing");
    expect(parsed.secondaryTrades).toEqual(["HVAC", "Electrical"]);
    expect(parsed.businessModel).toBe("dual_trade");
    expect(parsed.auditFocus).toBe("plumbing");
  });

  it("treats blank service-mix strings and empty trade lists as absent", () => {
    const parsed = auditSubmissionSchema.parse({
      ...requiredFields,
      primaryTrade: "  ",
      secondaryTrades: ["  ", ""],
      businessModel: "",
      auditFocus: "",
    });
    expect(parsed.primaryTrade).toBeUndefined();
    expect(parsed.secondaryTrades).toBeUndefined();
    expect(parsed.businessModel).toBeUndefined();
    expect(parsed.auditFocus).toBeUndefined();
  });

  it("rejects an invalid businessModel", () => {
    expect(() =>
      auditSubmissionSchema.parse({
        ...requiredFields,
        businessModel: "franchise",
      }),
    ).toThrow();
  });

  it("rejects an invalid auditFocus", () => {
    expect(() =>
      auditSubmissionSchema.parse({
        ...requiredFields,
        auditFocus: "roofing",
      }),
    ).toThrow();
  });
});

describe("optional lead field display", () => {
  it("shows Not provided instead of undefined or a fake default", () => {
    expect(formatOptionalLeadField(undefined)).toBe("Not provided");
    expect(formatOptionalLeadField(null)).toBe("Not provided");
    expect(formatOptionalLeadField("")).toBe("Not provided");
    expect(formatOptionalLeadField("Plumbing")).toBe("Plumbing");
  });

  it("joins secondary trades or shows Not provided", () => {
    expect(formatOptionalLeadList(undefined)).toBe("Not provided");
    expect(formatOptionalLeadList(null)).toBe("Not provided");
    expect(formatOptionalLeadList([])).toBe("Not provided");
    expect(formatOptionalLeadList(["HVAC", "Electrical"])).toBe(
      "HVAC, Electrical",
    );
  });
});
