import {
  createGoogleCalendarClient,
  getGoogleCalendarCredentials,
  parseGoogleCalendarEvent,
  redactGoogleSecrets,
} from "@/lib/calendar/client";

const CREDENTIALS = {
  clientId: "client-id-test",
  clientSecret: "client-secret-test",
  refreshToken: "refresh-token-test",
  calendarId: "primary",
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("getGoogleCalendarCredentials", () => {
  it("reads the three Production secrets from process.env", () => {
    expect(
      getGoogleCalendarCredentials({
        GOOGLE_CLIENT_ID: "id",
        GOOGLE_CLIENT_SECRET: "secret",
        GOOGLE_REFRESH_TOKEN: "refresh",
      }),
    ).toEqual({
      clientId: "id",
      clientSecret: "secret",
      refreshToken: "refresh",
      calendarId: "primary",
    });
  });

  it("returns null when any secret is missing", () => {
    expect(
      getGoogleCalendarCredentials({
        GOOGLE_CLIENT_ID: "id",
        GOOGLE_CLIENT_SECRET: "secret",
      }),
    ).toBeNull();
  });
});

describe("parseGoogleCalendarEvent", () => {
  it("drops the organizer/self attendee and normalizes emails", () => {
    const parsed = parseGoogleCalendarEvent({
      id: "evt-1",
      status: "confirmed",
      created: "2026-09-09T18:01:00.000Z",
      start: { dateTime: "2026-09-10T15:00:00-04:00" },
      end: { dateTime: "2026-09-10T15:30:00-04:00" },
      attendees: [
        { email: "Owner@Example.com" },
        { email: "marcus@example.com", self: true },
      ],
    });
    expect(parsed?.attendeeEmails).toEqual(["owner@example.com"]);
    expect(parsed?.start).toBe("2026-09-10T19:00:00.000Z");
  });
});

describe("createGoogleCalendarClient", () => {
  it("refreshes then lists events with the token in the header, not the URL", async () => {
    const urls: string[] = [];
    const client = createGoogleCalendarClient({
      credentials: CREDENTIALS,
      fetchImpl: async (input, init) => {
        const url = String(input);
        urls.push(url);
        if (url.includes("/token")) {
          const body = String(init?.body);
          expect(body).toContain("grant_type=refresh_token");
          expect(body).not.toContain("access_token");
          return jsonResponse({ access_token: "ya29.test-access", expires_in: 3600 });
        }
        expect(init?.headers).toMatchObject({
          Authorization: "Bearer ya29.test-access",
        });
        expect(url).not.toContain("access_token");
        expect(url).not.toContain("refresh-token-test");
        expect(url).toContain("showDeleted=true");
        expect(url).toContain("singleEvents=true");
        expect(url).toContain("updatedMin=");
        return jsonResponse({
          items: [
            {
              id: "evt-1",
              status: "confirmed",
              created: "2026-09-09T18:01:00.000Z",
              attendees: [{ email: "owner@example.com" }],
              start: { dateTime: "2026-09-10T15:00:00Z" },
              end: { dateTime: "2026-09-10T15:30:00Z" },
            },
          ],
        });
      },
    });

    const result = await client.listEvents({
      updatedMin: new Date("2026-09-07T18:00:00.000Z"),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.events).toHaveLength(1);
    expect(result.events[0].id).toBe("evt-1");
    expect(urls[0]).toContain("oauth2.googleapis.com/token");
    expect(urls[1]).toContain("/calendar/v3/calendars/primary/events");
  });

  it("maps a revoked refresh token to unauthorized without leaking secrets", async () => {
    const client = createGoogleCalendarClient({
      credentials: CREDENTIALS,
      fetchImpl: async () =>
        jsonResponse(
          {
            error: "invalid_grant",
            error_description: "Token has been expired or revoked.",
          },
          400,
        ),
    });
    const result = await client.listEvents({
      updatedMin: new Date("2026-09-07T18:00:00.000Z"),
    });
    expect(result).toEqual({ ok: false, reason: "unauthorized" });
    expect(JSON.stringify(result)).not.toContain("refresh-token-test");
    expect(JSON.stringify(result)).not.toContain("invalid_grant");
  });

  it("returns not_configured when credentials are missing", async () => {
    const client = createGoogleCalendarClient({
      credentials: null,
      fetchImpl: async () => {
        throw new Error("must not fetch");
      },
    });
    await expect(
      client.listEvents({ updatedMin: new Date() }),
    ).resolves.toEqual({ ok: false, reason: "not_configured" });
  });
});

describe("redactGoogleSecrets", () => {
  it("strips credential values from text", () => {
    const redacted = redactGoogleSecrets(
      "refresh_token=refresh-token-test client_secret=client-secret-test",
      {
        GOOGLE_CLIENT_SECRET: "client-secret-test",
        GOOGLE_REFRESH_TOKEN: "refresh-token-test",
      },
    );
    expect(redacted).not.toContain("refresh-token-test");
    expect(redacted).not.toContain("client-secret-test");
    expect(redacted).toContain("[redacted]");
  });
});
