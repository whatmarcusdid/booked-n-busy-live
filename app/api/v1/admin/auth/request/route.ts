import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  ADMIN_AUTH_GENERIC,
  isAdminEmailAllowed,
} from "@/lib/admin/auth";
import { createSupabaseAdminStore, requestAdminMagicLink } from "@/lib/admin/service";
import { createResendProvider } from "@/lib/email/resend";

const bodySchema = z.object({ email: z.string().email() });

export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(ADMIN_AUTH_GENERIC);
  }
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(ADMIN_AUTH_GENERIC);
  }

  const origin = request.nextUrl.origin;
  await requestAdminMagicLink({
    email: parsed.data.email,
    allowed: isAdminEmailAllowed(parsed.data.email),
    provider: createResendProvider(),
    store: createSupabaseAdminStore(),
    origin,
  });

  return NextResponse.json(ADMIN_AUTH_GENERIC);
}
