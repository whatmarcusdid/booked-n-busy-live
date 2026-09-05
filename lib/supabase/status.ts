import { getSupabaseEnv } from "./env";

export type SupabaseStatus =
  | { configured: false }
  | { configured: true; reachable: boolean; projectHost: string };

export async function getSupabaseStatus(): Promise<SupabaseStatus> {
  const env = getSupabaseEnv();

  if (!env) {
    return { configured: false };
  }

  const projectHost = new URL(env.url).host;

  try {
    const response = await fetch(`${env.url}/auth/v1/health`, {
      headers: { apikey: env.anonKey },
      cache: "no-store",
    });

    return {
      configured: true,
      reachable: response.ok,
      projectHost,
    };
  } catch {
    return {
      configured: true,
      reachable: false,
      projectHost,
    };
  }
}
