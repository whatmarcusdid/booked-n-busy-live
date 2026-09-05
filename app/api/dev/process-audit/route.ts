/**
 * Development-only endpoint to trigger mock audit processing
 * DO NOT DEPLOY TO PRODUCTION
 */

import { NextRequest, NextResponse } from "next/server";
import { processMockAudit } from "@/lib/services/mock-audit-processor";

export async function POST(request: NextRequest) {
  // Block in production
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

    // Process audit asynchronously (don't await in production-like scenario)
    processMockAudit(auditId).catch((error) => {
      console.error(`Error processing audit ${auditId}:`, error);
    });

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
