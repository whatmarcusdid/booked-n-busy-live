import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin/guard";
import { createSupabaseAdminStore } from "@/lib/admin/service";

export async function GET(request: NextRequest) {
  const auth = requireAdmin(request);
  if ("response" in auth) return auth.response;

  const url = request.nextUrl;
  const q = url.searchParams.get("q") ?? undefined;
  const limit = Math.min(Number(url.searchParams.get("limit") ?? 20), 100);
  const offset = Math.max(Number(url.searchParams.get("offset") ?? 0), 0);

  const result = await createSupabaseAdminStore().listAudits({ q, limit, offset });
  return NextResponse.json(result);
}
