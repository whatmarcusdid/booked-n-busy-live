import { normalizeEmail } from "../crypto";

/**
 * Read-only Google Calendar client.
 *
 * Access tokens are kept in memory for the duration of a single call and
 * never written to audit_events, logs, or error payloads. Refresh and
 * access tokens are also stripped from any provider text we do keep.
 */

export const GOOGLE_OAUTH_TOKEN_URL = "https://oauth2.googleapis.com/token";
export const GOOGLE_CALENDAR_API_ORIGIN = "https://www.googleapis.com";

export type CalendarAuthReason =
  | "not_configured"
  | "unauthorized"
  | "provider_error";

export type GoogleCalendarCredentials = {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  calendarId: string;
};

export type GoogleEventTime = {
  dateTime?: string;
  date?: string;
};

export type GoogleCalendarEvent = {
  id?: string;
  status?: string;
  created?: string;
  updated?: string;
  start?: GoogleEventTime;
  end?: GoogleEventTime;
  attendees?: Array<{ email?: string; self?: boolean }>;
};

export type CalendarEvent = {
  id: string;
  status: string;
  created: string | null;
  updated: string | null;
  start: string | null;
  end: string | null;
  attendeeEmails: string[];
};

export type CalendarListResult =
  | { ok: true; events: CalendarEvent[] }
  | { ok: false; reason: CalendarAuthReason };

export interface CalendarClient {
  listEvents(input: { updatedMin: Date }): Promise<CalendarListResult>;
}

export interface CalendarClientDeps {
  fetchImpl?: typeof fetch;
  credentials?: GoogleCalendarCredentials | null;
  tokenUrl?: string;
  apiOrigin?: string;
}

export function getGoogleCalendarCredentials(
  env: Record<string, string | undefined> = process.env,
): GoogleCalendarCredentials | null {
  const clientId = env.GOOGLE_CLIENT_ID?.trim();
  const clientSecret = env.GOOGLE_CLIENT_SECRET?.trim();
  const refreshToken = env.GOOGLE_REFRESH_TOKEN?.trim();
  if (!clientId || !clientSecret || !refreshToken) return null;
  return {
    clientId,
    clientSecret,
    refreshToken,
    calendarId: env.GOOGLE_CALENDAR_ID?.trim() || "primary",
  };
}

export function redactGoogleSecrets(
  text: string,
  env: Record<string, string | undefined> = process.env,
): string {
  let next = text;
  for (const key of [
    "GOOGLE_CLIENT_ID",
    "GOOGLE_CLIENT_SECRET",
    "GOOGLE_REFRESH_TOKEN",
  ] as const) {
    const value = env[key];
    if (value) next = next.split(value).join("[redacted]");
  }
  next = next.replace(
    /(access_token|refresh_token|client_secret|client_id)=[^&\s"]+/gi,
    "$1=[redacted]",
  );
  next = next.replace(
    /"(access_token|refresh_token|client_secret|client_id)"\s*:\s*"[^"]*"/gi,
    '"$1":"[redacted]"',
  );
  return next;
}

export function parseGoogleCalendarEvent(
  raw: GoogleCalendarEvent,
): CalendarEvent | null {
  if (!raw.id) return null;
  const attendeeEmails = (raw.attendees ?? [])
    .filter((attendee) => attendee.email && !attendee.self)
    .map((attendee) => normalizeEmail(attendee.email as string));
  return {
    id: raw.id,
    status: raw.status ?? "confirmed",
    created: raw.created ?? null,
    updated: raw.updated ?? null,
    start: instantFromGoogleTime(raw.start),
    end: instantFromGoogleTime(raw.end),
    attendeeEmails,
  };
}

export function createGoogleCalendarClient(
  deps: CalendarClientDeps = {},
): CalendarClient {
  return {
    async listEvents(input) {
      if (process.env.JEST_WORKER_ID && !deps.fetchImpl) {
        return { ok: false, reason: "provider_error" };
      }

      const credentials =
        deps.credentials === undefined
          ? getGoogleCalendarCredentials()
          : deps.credentials;
      if (!credentials) return { ok: false, reason: "not_configured" };

      const fetchImpl = deps.fetchImpl ?? fetch;
      const access = await refreshAccessToken(credentials, {
        fetchImpl,
        tokenUrl: deps.tokenUrl ?? GOOGLE_OAUTH_TOKEN_URL,
      });
      if (!access.ok) return access;

      return listEventsWithAccessToken(credentials, access.accessToken, input, {
        fetchImpl,
        apiOrigin: deps.apiOrigin ?? GOOGLE_CALENDAR_API_ORIGIN,
      });
    },
  };
}

async function refreshAccessToken(
  credentials: GoogleCalendarCredentials,
  deps: { fetchImpl: typeof fetch; tokenUrl: string },
): Promise<
  | { ok: true; accessToken: string }
  | { ok: false; reason: CalendarAuthReason }
> {
  try {
    const response = await deps.fetchImpl(deps.tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: credentials.clientId,
        client_secret: credentials.clientSecret,
        refresh_token: credentials.refreshToken,
        grant_type: "refresh_token",
      }),
    });
    const bodyText = await response.text();
    if (!response.ok) {
      return { ok: false, reason: authFailureReason(response.status, bodyText) };
    }
    const body = JSON.parse(bodyText) as { access_token?: string };
    if (!body.access_token) return { ok: false, reason: "provider_error" };
    return { ok: true, accessToken: body.access_token };
  } catch {
    return { ok: false, reason: "provider_error" };
  }
}

async function listEventsWithAccessToken(
  credentials: GoogleCalendarCredentials,
  accessToken: string,
  input: { updatedMin: Date },
  deps: { fetchImpl: typeof fetch; apiOrigin: string },
): Promise<CalendarListResult> {
  const events: CalendarEvent[] = [];
  let pageToken: string | undefined;
  const calendarId = encodeURIComponent(credentials.calendarId);

  try {
    do {
      const url = new URL(
        `${deps.apiOrigin}/calendar/v3/calendars/${calendarId}/events`,
      );
      url.searchParams.set("singleEvents", "true");
      url.searchParams.set("showDeleted", "true");
      url.searchParams.set("maxResults", "250");
      url.searchParams.set("orderBy", "updated");
      url.searchParams.set("updatedMin", input.updatedMin.toISOString());
      if (pageToken) url.searchParams.set("pageToken", pageToken);

      const response = await deps.fetchImpl(url, {
        method: "GET",
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const bodyText = await response.text();
      if (!response.ok) {
        return {
          ok: false,
          reason: authFailureReason(response.status, bodyText),
        };
      }
      const body = JSON.parse(bodyText) as {
        items?: GoogleCalendarEvent[];
        nextPageToken?: string;
      };
      for (const item of body.items ?? []) {
        const parsed = parseGoogleCalendarEvent(item);
        if (parsed) events.push(parsed);
      }
      pageToken = body.nextPageToken;
    } while (pageToken);

    return { ok: true, events };
  } catch {
    return { ok: false, reason: "provider_error" };
  }
}

function authFailureReason(status: number, bodyText: string): CalendarAuthReason {
  if (status === 401 || status === 403) return "unauthorized";
  try {
    const body = JSON.parse(bodyText) as {
      error?: string | { status?: string };
    };
    if (body.error === "invalid_grant" || body.error === "invalid_client") {
      return "unauthorized";
    }
  } catch {
    // Provider text is discarded; never forwarded to callers or logs.
  }
  return "provider_error";
}

function instantFromGoogleTime(value?: GoogleEventTime): string | null {
  if (!value) return null;
  const raw = value.dateTime ?? value.date;
  if (!raw) return null;
  const parsed = Date.parse(raw);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}
