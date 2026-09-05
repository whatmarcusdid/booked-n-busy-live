import { createClient } from "@supabase/supabase-js";
import { getServerEnv } from "../env";

export function createAdminClient() {
  const env = getServerEnv();

  if (!env) {
    throw new Error(
      "Supabase admin is not configured. Add NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.",
    );
  }

  return createClient(env.supabaseUrl, env.supabaseServiceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}
