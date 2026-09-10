import { POST } from "@/app/api/v1/audits/route";
import { createAudit } from "@/lib/services/audit-service";
import { NextRequest } from "next/server";

// Mock the audit service
jest.mock("@/lib/services/audit-service");

const mockCreateAudit = createAudit as jest.MockedFunction<typeof createAudit>;

describe("POST /api/v1/audits", () => {
  const validPayload = {
    websiteUrl: "example.com",
    businessName: "Test Business",
    firstName: "John",
    email: "john@example.com",
    trade: "Plumbing",
    serviceArea: "New York, NY",
    phone: "555-1234",
    primaryConcern: "Need more leads",
    teamSize: "1-5",
    platform: "WordPress",
    referralSource: "Google",
    consent: {
      reportDelivery: true,
      followUp: true,
    },
    attribution: {
      utmSource: "google",
      utmMedium: "cpc",
      utmCampaign: "spring2024",
    },
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("should accept a valid request and return 202", async () => {
    mockCreateAudit.mockResolvedValue({
      auditId: "test-audit-id",
      status: "submitted",
      statusUrl: "/audit/status/test-token",
      duplicate: false,
    });

    const request = new NextRequest("http://localhost:3000/api/v1/audits", {
      method: "POST",
      body: JSON.stringify(validPayload),
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(202);
    expect(data).toEqual({
      auditId: "test-audit-id",
      status: "submitted",
      statusUrl: "/audit/status/test-token",
      duplicate: false,
    });
  });

  it("should reject request with missing required field", async () => {
    const invalidPayload = {
      ...validPayload,
      firstName: undefined,
    };

    const request = new NextRequest("http://localhost:3000/api/v1/audits", {
      method: "POST",
      body: JSON.stringify(invalidPayload),
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toBe("Validation failed");
    expect(data.fields).toBeDefined();
    expect(data.fields.some((f: any) => f.field === "firstName")).toBe(true);
  });

  it("should reject request with invalid email", async () => {
    const invalidPayload = {
      ...validPayload,
      email: "not-an-email",
    };

    const request = new NextRequest("http://localhost:3000/api/v1/audits", {
      method: "POST",
      body: JSON.stringify(invalidPayload),
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toBe("Validation failed");
    expect(data.fields).toBeDefined();
    expect(data.fields.some((f: any) => f.field === "email")).toBe(true);
  });

  it("should reject request with malformed URL", async () => {
    const invalidPayload = {
      ...validPayload,
      websiteUrl: "not a url @#$%",
    };

    const request = new NextRequest("http://localhost:3000/api/v1/audits", {
      method: "POST",
      body: JSON.stringify(invalidPayload),
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toBe("Validation failed");
    expect(data.fields).toBeDefined();
    expect(data.fields.some((f: any) => f.field === "websiteUrl")).toBe(true);
  });

  it("should reject request with non-http protocol URL", async () => {
    // No need to mock createAudit since validation should fail before it's called
    const invalidPayload = {
      ...validPayload,
      websiteUrl: "ftp://example.com",
    };

    const request = new NextRequest("http://localhost:3000/api/v1/audits", {
      method: "POST",
      body: JSON.stringify(invalidPayload),
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toBe("Validation failed");
    expect(data.fields).toBeDefined();
    expect(data.fields.some((f: any) => f.field === "websiteUrl")).toBe(true);
    // Ensure createAudit was never called since validation failed
    expect(mockCreateAudit).not.toHaveBeenCalled();
  });

  it("should handle database failure gracefully", async () => {
    mockCreateAudit.mockResolvedValue({
      error: "Database error",
    });

    const request = new NextRequest("http://localhost:3000/api/v1/audits", {
      method: "POST",
      body: JSON.stringify(validPayload),
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(500);
    expect(data.error).toBe("Failed to create audit");
    expect(data).not.toHaveProperty("details");
  });

  it("should normalize bare domain to https", async () => {
    mockCreateAudit.mockResolvedValue({
      auditId: "test-audit-id",
      status: "submitted",
      statusUrl: "/audit/status/test-token",
      duplicate: false,
    });

    const request = new NextRequest("http://localhost:3000/api/v1/audits", {
      method: "POST",
      body: JSON.stringify({
        ...validPayload,
        websiteUrl: "example.com",
      }),
    });

    const response = await POST(request);

    expect(response.status).toBe(202);
    expect(mockCreateAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        websiteUrl: "example.com",
      }),
      "https://example.com",
      expect.objectContaining({ idempotencyKey: undefined }),
    );
  });

  it("should accept http URLs", async () => {
    mockCreateAudit.mockResolvedValue({
      auditId: "test-audit-id",
      status: "submitted",
      statusUrl: "/audit/status/test-token",
      duplicate: false,
    });

    const request = new NextRequest("http://localhost:3000/api/v1/audits", {
      method: "POST",
      body: JSON.stringify({
        ...validPayload,
        websiteUrl: "http://example.com",
      }),
    });

    const response = await POST(request);

    expect(response.status).toBe(202);
    expect(mockCreateAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        websiteUrl: "http://example.com",
      }),
      "http://example.com",
      expect.objectContaining({ idempotencyKey: undefined }),
    );
  });

  it("should pass Idempotency-Key through to createAudit", async () => {
    mockCreateAudit.mockResolvedValue({
      auditId: "test-audit-id",
      status: "submitted",
      statusUrl: "/audit/status/test-token",
      duplicate: false,
    });

    const request = new NextRequest("http://localhost:3000/api/v1/audits", {
      method: "POST",
      headers: { "Idempotency-Key": "replay-me" },
      body: JSON.stringify(validPayload),
    });

    const response = await POST(request);

    expect(response.status).toBe(202);
    expect(mockCreateAudit).toHaveBeenCalledWith(
      expect.any(Object),
      "https://example.com",
      { idempotencyKey: "replay-me" },
    );
  });

  it("accepts a 4-field payload with trade and serviceArea omitted", async () => {
    mockCreateAudit.mockResolvedValue({
      auditId: "test-audit-id",
      status: "submitted",
      statusUrl: "/audit/status/test-token",
      duplicate: false,
    });

    const { trade: _trade, serviceArea: _serviceArea, ...fourFields } =
      validPayload;
    const request = new NextRequest("http://localhost:3000/api/v1/audits", {
      method: "POST",
      body: JSON.stringify(fourFields),
    });

    const response = await POST(request);

    expect(response.status).toBe(202);
    expect(mockCreateAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        firstName: "John",
        businessName: "Test Business",
        email: "john@example.com",
        websiteUrl: "example.com",
      }),
      "https://example.com",
      expect.anything(),
    );
    const submitted = mockCreateAudit.mock.calls[0][0];
    expect(submitted.trade).toBeUndefined();
    expect(submitted.serviceArea).toBeUndefined();
  });

  it("should not expose sensitive data in error responses", async () => {
    mockCreateAudit.mockRejectedValue(new Error("Internal database error"));

    const request = new NextRequest("http://localhost:3000/api/v1/audits", {
      method: "POST",
      body: JSON.stringify(validPayload),
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(500);
    expect(data.error).toBe("Internal server error");
    expect(data).not.toHaveProperty("email");
    expect(data).not.toHaveProperty("phone");
    expect(JSON.stringify(data)).not.toContain("database");
  });
});
