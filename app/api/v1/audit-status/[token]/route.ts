import { NextRequest, NextResponse } from "next/server";
import { getAuditStatus } from "@/lib/services/audit-status-service";

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ token: string }> },
) {
  try {
    const { token } = await context.params;

    if (!token || token.length === 0) {
      return NextResponse.json(
        {
          error: "Invalid token",
          code: "INVALID_TOKEN",
        },
        { status: 400 },
      );
    }

    const result = await getAuditStatus(token);

    if ("error" in result) {
      const statusCode = result.code === "NOT_FOUND" ? 404 : 500;
      return NextResponse.json(
        {
          error: result.error,
          code: result.code,
        },
        { status: statusCode },
      );
    }

    return NextResponse.json(result, { status: 200 });
  } catch (error) {
    console.error("Unexpected error in audit status endpoint:", error);
    return NextResponse.json(
      {
        error: "Internal server error",
        code: "SERVER_ERROR",
      },
      { status: 500 },
    );
  }
}
