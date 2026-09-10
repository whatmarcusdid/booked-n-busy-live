import { GET } from "@/app/api/v1/audit-status/[token]/route";
import { getAuditStatus } from "@/lib/services/audit-status-service";
import { NextRequest } from "next/server";

// Mock the audit status service
jest.mock("@/lib/services/audit-status-service");

const mockGetAuditStatus = getAuditStatus as jest.MockedFunction<
  typeof getAuditStatus
>;

describe("GET /api/v1/audit-status/[token]", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("should return 400 for invalid token", async () => {
    const request = new NextRequest(
      "http://localhost:3000/api/v1/audit-status/",
    );
    const context = { params: Promise.resolve({ token: "" }) };

    const response = await GET(request, context);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toBe("Invalid token");
    expect(data.code).toBe("INVALID_TOKEN");
    expect(mockGetAuditStatus).not.toHaveBeenCalled();
  });

  it("should return 404 for non-existent audit", async () => {
    mockGetAuditStatus.mockResolvedValue({
      error: "Audit not found",
      code: "NOT_FOUND",
    });

    const request = new NextRequest(
      "http://localhost:3000/api/v1/audit-status/invalid-token-123",
    );
    const context = { params: Promise.resolve({ token: "invalid-token-123" }) };

    const response = await GET(request, context);
    const data = await response.json();

    expect(response.status).toBe(404);
    expect(data.error).toBe("Audit not found");
    expect(data.code).toBe("NOT_FOUND");
  });

  it("should return in-progress audit status", async () => {
    mockGetAuditStatus.mockResolvedValue({
      auditId: "test-audit-id",
      status: "discovering",
      progress: {
        percentage: 30,
        currentStep: "Discovering pages and content",
      },
      websiteUrl: "https://example.com",
      businessName: "Test Business",
      submittedAt: "2026-09-05T20:00:00Z",
    });

    const request = new NextRequest(
      "http://localhost:3000/api/v1/audit-status/valid-token-123",
    );
    const context = { params: Promise.resolve({ token: "valid-token-123" }) };

    const response = await GET(request, context);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.auditId).toBe("test-audit-id");
    expect(data.status).toBe("discovering");
    expect(data.progress.percentage).toBe(30);
    expect(data.progress.currentStep).toBe("Discovering pages and content");
    expect(data.websiteUrl).toBe("https://example.com");
    expect(data.businessName).toBe("Test Business");
    expect(data.report).toBeUndefined();
  });

  it("should return complete audit with report data", async () => {
    mockGetAuditStatus.mockResolvedValue({
      auditId: "test-audit-id",
      status: "complete",
      progress: {
        percentage: 100,
        currentStep: "Report ready!",
      },
      websiteUrl: "https://example.com",
      businessName: "Test Business",
      submittedAt: "2026-09-05T20:00:00Z",
      completedAt: "2026-09-05T20:10:00Z",
      report: {
        overallScore: 0.78,
        publicationStatus: "review_required",
        pillars: [
          { key: "trust_signals", name: "Trust Signals", score: 0.79 },
          { key: "lead_conversion", name: "Lead Conversion", score: 0.76 },
          { key: "growth_infrastructure", name: "Growth Infrastructure", score: 0.75 },
        ],
        topRecommendations: [
          {
            priority: "high",
            title: "Improve Mobile Responsiveness",
            description: "Your website needs optimization for mobile devices.",
          },
          {
            priority: "high",
            title: "Add Clear Call-to-Action Buttons",
            description: "Make it easier for visitors to take action.",
          },
          {
            priority: "medium",
            title: "Optimize Page Load Speed",
            description: "Reduce page load times by optimizing images.",
          },
        ],
      },
    });

    const request = new NextRequest(
      "http://localhost:3000/api/v1/audit-status/valid-token-123",
    );
    const context = { params: Promise.resolve({ token: "valid-token-123" }) };

    const response = await GET(request, context);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.auditId).toBe("test-audit-id");
    expect(data.status).toBe("complete");
    expect(data.progress.percentage).toBe(100);
    expect(data.completedAt).toBe("2026-09-05T20:10:00Z");
    expect(data.report).toBeDefined();
    expect(data.report.overallScore).toBe(0.78);
    expect(data.report.publicationStatus).toBe("review_required");
    expect(data.report.pillars).toHaveLength(3);
    expect(data.report.topRecommendations).toHaveLength(3);
  });

  it("should return partial audit (complete without report)", async () => {
    mockGetAuditStatus.mockResolvedValue({
      auditId: "test-audit-id",
      status: "complete",
      progress: {
        percentage: 100,
        currentStep: "Report ready!",
      },
      websiteUrl: "https://example.com",
      businessName: "Test Business",
      submittedAt: "2026-09-05T20:00:00Z",
      completedAt: "2026-09-05T20:10:00Z",
      // No report field - simulates partial completion
    });

    const request = new NextRequest(
      "http://localhost:3000/api/v1/audit-status/valid-token-123",
    );
    const context = { params: Promise.resolve({ token: "valid-token-123" }) };

    const response = await GET(request, context);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.status).toBe("complete");
    expect(data.report).toBeUndefined();
  });

  it("should handle server errors gracefully", async () => {
    mockGetAuditStatus.mockResolvedValue({
      error: "Internal server error",
      code: "SERVER_ERROR",
    });

    const request = new NextRequest(
      "http://localhost:3000/api/v1/audit-status/valid-token-123",
    );
    const context = { params: Promise.resolve({ token: "valid-token-123" }) };

    const response = await GET(request, context);
    const data = await response.json();

    expect(response.status).toBe(500);
    expect(data.error).toBe("Internal server error");
    expect(data.code).toBe("SERVER_ERROR");
  });

  it("should not expose PII in responses", async () => {
    mockGetAuditStatus.mockResolvedValue({
      auditId: "test-audit-id",
      status: "complete",
      progress: {
        percentage: 100,
        currentStep: "Report ready!",
      },
      websiteUrl: "https://example.com",
      businessName: "Test Business",
      submittedAt: "2026-09-05T20:00:00Z",
      completedAt: "2026-09-05T20:10:00Z",
      report: {
        overallScore: 0.78,
        publicationStatus: "review_required",
      },
    });

    const request = new NextRequest(
      "http://localhost:3000/api/v1/audit-status/valid-token-123",
    );
    const context = { params: Promise.resolve({ token: "valid-token-123" }) };

    const response = await GET(request, context);
    const data = await response.json();
    const dataStr = JSON.stringify(data);

    // Should not contain any PII fields
    expect(dataStr).not.toContain("email");
    expect(dataStr).not.toContain("phone");
    expect(dataStr).not.toContain("firstName");
    expect(dataStr).not.toContain("first_name");
    expect(dataStr).not.toContain("email_hash");
    expect(dataStr).not.toContain("lead_id");
  });

  it("should handle needs_review status correctly", async () => {
    mockGetAuditStatus.mockResolvedValue({
      auditId: "test-audit-id",
      status: "complete",
      progress: {
        percentage: 100,
        currentStep: "Report ready!",
      },
      websiteUrl: "https://example.com",
      businessName: "Test Business",
      submittedAt: "2026-09-05T20:00:00Z",
      completedAt: "2026-09-05T20:10:00Z",
      report: {
        overallScore: 0.78,
        publicationStatus: "review_required",
        pillars: [
          { key: "growth_infrastructure", name: "Growth Infrastructure", score: 0.75 },
        ],
        topRecommendations: [
          {
            priority: "high",
            title: "Test Recommendation",
            description: "Test description",
          },
        ],
      },
    });

    const request = new NextRequest(
      "http://localhost:3000/api/v1/audit-status/valid-token-123",
    );
    const context = { params: Promise.resolve({ token: "valid-token-123" }) };

    const response = await GET(request, context);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.status).toBe("complete");
    expect(data.report.publicationStatus).toBe("review_required");
  });
});
