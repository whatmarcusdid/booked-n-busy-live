import { readFileSync } from "fs";
import { NextRequest } from "next/server";
import { GET, POST } from "@/app/api/v1/internal/retention-purge/route";
import { runRetentionPurge } from "@/lib/retention/purge";

jest.mock("@/lib/retention/purge", () => {
  const actual = jest.requireActual("@/lib/retention/purge");
  return { ...actual, runRetentionPurge: jest.fn() };
});

const mockRun = runRetentionPurge as jest.MockedFunction<typeof runRetentionPurge>;

function request(url: string, secret?: string) {
  return new NextRequest(url, {
    method: "GET",
    headers: secret ? { Authorization: `Bearer ${secret}` } : undefined,
  });
}

describe("GET /api/v1/internal/retention-purge", () => {
  const previous = process.env.CRON_SECRET;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.CRON_SECRET = "cron-test-secret";
    mockRun.mockResolvedValue({
      artifacts: {
        jobName: "artifacts",
        status: "success",
        rowsDeleted: 0,
        objectsDeleted: 0,
        cutoffUsed: new Date("2026-06-12T00:00:00.000Z"),
        errorDetail: null,
      },
      structuredData: {
        jobName: "structured_data",
        status: "success",
        rowsDeleted: 0,
        objectsDeleted: 0,
        cutoffUsed: new Date("2025-09-10T00:00:00.000Z"),
        errorDetail: null,
      },
    });
  });

  afterAll(() => {
    process.env.CRON_SECRET = previous;
  });

  it("rejects callers without the cron bearer secret", async () => {
    const response = await GET(
      request("http://localhost:3000/api/v1/internal/retention-purge"),
    );
    expect(response.status).toBe(401);
    expect(mockRun).not.toHaveBeenCalled();
  });

  it("rejects callers when CRON_SECRET is unset", async () => {
    delete process.env.CRON_SECRET;
    const response = await GET(
      request(
        "http://localhost:3000/api/v1/internal/retention-purge",
        "cron-test-secret",
      ),
    );
    expect(response.status).toBe(401);
    expect(mockRun).not.toHaveBeenCalled();
  });

  it("runs both jobs for a bearer-authenticated cron GET", async () => {
    const response = await GET(
      request(
        "http://localhost:3000/api/v1/internal/retention-purge",
        "cron-test-secret",
      ),
    );
    expect(response.status).toBe(200);
    expect(mockRun).toHaveBeenCalledTimes(1);
    const body = (await response.json()) as { ok: boolean };
    expect(body.ok).toBe(true);
  });

  it("accepts POST with the same secret", async () => {
    const response = await POST(
      new NextRequest("http://localhost:3000/api/v1/internal/retention-purge", {
        method: "POST",
        headers: { Authorization: "Bearer cron-test-secret" },
      }),
    );
    expect(response.status).toBe(200);
    expect(mockRun).toHaveBeenCalledTimes(1);
  });
});

describe("Vercel Cron wiring", () => {
  it("schedules the retention purge on the internal route", () => {
    const vercel = JSON.parse(readFileSync("vercel.json", "utf8")) as {
      crons: Array<{ path: string; schedule: string }>;
    };
    expect(vercel.crons).toEqual([
      {
        path: "/api/v1/internal/retention-purge",
        schedule: "15 6 * * *",
      },
    ]);
  });
});
