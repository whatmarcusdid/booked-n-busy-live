/**
 * Development-only manual trigger for the same workflow POST /api/v1/audits starts.
 * Production traffic should not use this route — submission is the real trigger.
 */

import { NextRequest, NextResponse } from "next/server";
import { startAuditWorkflow } from "@/lib/audit-workflow/start";
import { createSupabaseAuditStore } from "@/lib/audit-workflow/store";

export async function POST(request: NextRequest) {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json(
      {
        error: "This endpoint is not available in production",
      },
      { status: 403 },
    );
  }

  try {
    const body = await request.json();
    const { auditId } = body;

    if (!auditId) {
      return NextResponse.json(
        {
          error: "auditId is required",
        },
        { status: 400 },
      );
    }

    const store = createSupabaseAuditStore();
    const audit = await store.getAudit(auditId);
    if (!audit) {
      return NextResponse.json({ error: "Audit not found" }, { status: 404 });
    }

    const started = await startAuditWorkflow({
      auditId,
      websiteUrl: audit.website_url,
    });

    if (!started.started) {
      return NextResponse.json(
        {
          error: "A workflow is already active for this audit",
          auditId,
        },
        { status: 409 },
      );
    }

    return NextResponse.json(
      {
        message: "Processing started",
        auditId,
      },
      { status: 202 },
    );
  } catch (error) {
    console.error("Error in dev process-audit endpoint:", error);
    return NextResponse.json(
      {
        error: "Internal server error",
      },
      { status: 500 },
    );
  }
}
