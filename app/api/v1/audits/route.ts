import { NextRequest, NextResponse } from "next/server";
import { auditSubmissionSchema } from "@/lib/schemas/audit-submission";
import { normalizeAndValidateUrl } from "@/lib/services/url-validator";
import { createAudit } from "@/lib/services/audit-service";
import { ZodError } from "zod";

export async function POST(request: NextRequest) {
  try {
    // Parse request body
    const body = await request.json();

    // Validate with Zod
    let validatedData;
    try {
      validatedData = auditSubmissionSchema.parse(body);
    } catch (error) {
      if (error instanceof ZodError) {
        return NextResponse.json(
          {
            error: "Validation failed",
            fields: error.errors.map((err) => ({
              field: err.path.join("."),
              message: err.message,
            })),
          },
          { status: 400 },
        );
      }
      throw error;
    }

    // Normalize and validate URL
    const urlResult = normalizeAndValidateUrl(validatedData.websiteUrl);
    if (!urlResult.success) {
      return NextResponse.json(
        {
          error: "Validation failed",
          fields: [
            {
              field: "websiteUrl",
              message: urlResult.error,
            },
          ],
        },
        { status: 400 },
      );
    }

    const idempotencyKey = request.headers.get("Idempotency-Key") ?? undefined;

    // Create audit and enqueue the durable workflow
    const result = await createAudit(validatedData, urlResult.url, {
      idempotencyKey,
    });

    // Check for errors
    if (!result) {
      console.error("Audit creation returned undefined");
      return NextResponse.json(
        {
          error: "Failed to create audit",
        },
        { status: 500 },
      );
    }

    if ("error" in result) {
      console.error("Audit creation failed:", result);
      return NextResponse.json(
        {
          error: "Failed to create audit",
        },
        { status: 500 },
      );
    }

    // Return success response
    return NextResponse.json(
      {
        auditId: result.auditId,
        status: result.status,
        statusUrl: result.statusUrl,
        duplicate: result.duplicate,
      },
      { status: 202 },
    );
  } catch (error) {
    console.error("Unexpected error in audit submission:", error);
    return NextResponse.json(
      {
        error: "Internal server error",
      },
      { status: 500 },
    );
  }
}
