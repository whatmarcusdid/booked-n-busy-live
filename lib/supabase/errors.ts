/**
 * Renders a Supabase/PostgREST failure into a single log-safe string.
 *
 * Passing the error object straight to `console.error` loses it: the Next dev
 * server's structured logger serializes an object argument to `{}`, so
 * `console.error("...", error)` records `... {}` and the cause is gone. A
 * PostgREST error is a plain object rather than an `Error`, so it hits that
 * path every time — a connection refusal and a missing-function error become
 * the same empty log line.
 */
export function describeDatabaseError(error: unknown): string {
  if (error === null || error === undefined) return "no error object";
  if (typeof error === "string") return error;

  if (error instanceof Error) {
    return error.stack ?? `${error.name}: ${error.message}`;
  }

  if (typeof error === "object") {
    const record = error as Record<string, unknown>;
    const parts: string[] = [];

    for (const field of ["message", "code", "details", "hint"] as const) {
      const value = record[field];
      if (value !== null && value !== undefined && value !== "") {
        parts.push(`${field}=${String(value)}`);
      }
    }

    if (parts.length > 0) return parts.join(" | ");

    try {
      const json = JSON.stringify(error);
      if (json && json !== "{}") return json;
    } catch {
      // fall through to the constructor-name description below
    }

    return `unserializable ${record.constructor?.name ?? "object"} with no message`;
  }

  return String(error);
}
