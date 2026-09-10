"use client";

import { canRecordAttendance } from "@/lib/booking/attendance";
import { useRouter } from "next/navigation";
import { useState } from "react";

export interface BookingSessionView {
  id: string;
  customerEmail: string | null;
  createdAt: string;
  expiresAt: string;
  consumedAt: string | null;
}

export interface MeetingView {
  id: string;
  bookingSessionId: string;
  status: string;
  googleEventId: string | null;
  scheduledStart: string;
  scheduledEnd: string;
  createdAt: string;
}

interface Props {
  auditId: string;
  currentState: string;
  sessions: BookingSessionView[];
  meetings: MeetingView[];
}

type Outcome = { kind: "ok" | "error"; message: string } | null;

export function BookingLinkage({
  auditId,
  currentState,
  sessions,
  meetings,
}: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<Outcome>(null);

  async function post(path: string, body: Record<string, unknown> = {}) {
    const response = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const detail = await response.json().catch(() => null);
    if (!response.ok) {
      throw new Error(
        detail?.error ?? `Request failed with ${response.status}`,
      );
    }
    return detail;
  }

  async function createSession() {
    setBusy("create");
    setOutcome(null);
    try {
      const json = await post(`/api/v1/audits/${auditId}/booking-session`);
      setOutcome({
        kind: "ok",
        message: `Booking session ${json.bookingSessionId} ready.`,
      });
      router.refresh();
    } catch (error) {
      setOutcome({
        kind: "error",
        message:
          error instanceof Error ? error.message : "Could not create session",
      });
    } finally {
      setBusy(null);
    }
  }

  async function markAttendance(
    meetingId: string,
    status: "attended" | "no_show",
  ) {
    setBusy(meetingId + status);
    setOutcome(null);
    try {
      const json = await post(
        `/api/v1/admin/meetings/${meetingId}/attendance`,
        { status },
      );
      setOutcome({
        kind: "ok",
        message: `Meeting ${json.meetingId} marked ${status === "no_show" ? "no-show" : "attended"}.`,
      });
      router.refresh();
    } catch (error) {
      setOutcome({
        kind: "error",
        message:
          error instanceof Error ? error.message : "Could not record attendance",
      });
    } finally {
      setBusy(null);
    }
  }

  async function markBooked(sessionId: string) {
    setBusy(sessionId);
    setOutcome(null);
    try {
      const json = await post(
        `/api/v1/admin/booking-sessions/${sessionId}/mark-booked`,
      );
      setOutcome({
        kind: "ok",
        message: `Meeting ${json.meetingId} booked for this audit and lead.`,
      });
      router.refresh();
    } catch (error) {
      setOutcome({
        kind: "error",
        message:
          error instanceof Error ? error.message : "Could not mark booked",
      });
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="admin-section" aria-label="Findings-call booking">
      <h2>Findings-call booking</h2>
      <p className="admin-note">
        Manual stub for the Google Calendar linkage. Creating a session and
        marking it booked writes a real <code>meetings</code> row tied to this
        audit and lead. No Calendar redirect or webhook yet. Audit state:{" "}
        <code>{currentState}</code>
      </p>

      <div className="admin-actions">
        <button
          type="button"
          className="admin-button"
          disabled={busy !== null}
          onClick={createSession}
        >
          {busy === "create" ? "Creating…" : "Create booking session"}
        </button>
      </div>

      {sessions.length === 0 ? (
        <p>No booking session yet.</p>
      ) : (
        <table className="admin-table">
          <thead>
            <tr>
              <th scope="col">Session</th>
              <th scope="col">Email</th>
              <th scope="col">Expires</th>
              <th scope="col">Consumed</th>
              <th scope="col">Action</th>
            </tr>
          </thead>
          <tbody>
            {sessions.map((session) => (
              <tr key={session.id}>
                <td>
                  <code>{session.id}</code>
                </td>
                <td>{session.customerEmail ?? "—"}</td>
                <td>{session.expiresAt}</td>
                <td>{session.consumedAt ?? "—"}</td>
                <td>
                  <button
                    type="button"
                    className="admin-button admin-button-secondary"
                    disabled={busy !== null || session.consumedAt !== null}
                    onClick={() => markBooked(session.id)}
                  >
                    {busy === session.id ? "Saving…" : "Mark booked"}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <h3>Meetings</h3>
      {meetings.length === 0 ? (
        <p>No meeting linked yet.</p>
      ) : (
        <table className="admin-table">
          <thead>
            <tr>
              <th scope="col">Meeting</th>
              <th scope="col">Session</th>
              <th scope="col">Status</th>
              <th scope="col">Google event</th>
              <th scope="col">Start</th>
              <th scope="col">Attendance</th>
            </tr>
          </thead>
          <tbody>
            {meetings.map((meeting) => {
              const eligible = canRecordAttendance(meeting.status);
              return (
              <tr key={meeting.id}>
                <td>
                  <code>{meeting.id}</code>
                </td>
                <td>
                  <code>{meeting.bookingSessionId}</code>
                </td>
                <td>{meeting.status}</td>
                <td>{meeting.googleEventId ?? "—"}</td>
                <td>{meeting.scheduledStart}</td>
                <td>
                  <button
                    type="button"
                    className="admin-button admin-button-secondary"
                    disabled={busy !== null || !eligible}
                    onClick={() => markAttendance(meeting.id, "attended")}
                  >
                    {busy === `${meeting.id}attended` ? "Saving…" : "Attended"}
                  </button>{" "}
                  <button
                    type="button"
                    className="admin-button admin-button-secondary"
                    disabled={busy !== null || !eligible}
                    onClick={() => markAttendance(meeting.id, "no_show")}
                  >
                    {busy === `${meeting.id}no_show` ? "Saving…" : "No-Show"}
                  </button>
                </td>
              </tr>
              );
            })}
          </tbody>
        </table>
      )}

      {outcome ? (
        <p
          className={
            outcome.kind === "ok" ? "admin-note admin-note-ok" : "admin-note admin-note-error"
          }
          role={outcome.kind === "error" ? "alert" : "status"}
        >
          {outcome.message}
        </p>
      ) : null}
    </section>
  );
}
