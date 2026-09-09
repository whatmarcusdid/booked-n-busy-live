/**
 * Canvas narration — presentational only, never shipped to the app.
 * Explains how to read the Booking Flow canvas and flags the emergency branch.
 * Styled from the project's brand tokens so it sits in the same visual world.
 */
import type { ReactNode } from "react";

const font =
  'Inter, ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif';

function Card({
  accent,
  children,
}: {
  accent: string;
  children: ReactNode;
}) {
  return (
    <div
      style={{
        fontFamily: font,
        background: "#fffdf9",
        border: "1px solid #e7e5e4",
        borderLeft: `4px solid ${accent}`,
        borderRadius: "0.9rem",
        padding: "1.25rem 1.4rem",
        maxWidth: "31rem",
        color: "#1c1917",
        boxShadow: "0 10px 30px rgba(28,25,23,0.05)",
      }}
    >
      {children}
    </div>
  );
}

export function FlowIntro() {
  return (
    <Card accent="#c2410c">
      <div
        style={{
          fontSize: "0.72rem",
          fontWeight: 700,
          letterSpacing: "0.12em",
          textTransform: "uppercase",
          color: "#c2410c",
          marginBottom: "0.5rem",
        }}
      >
        Booked N Busy Live · BOO-1
      </div>
      <h1
        style={{
          margin: "0 0 0.6rem",
          fontSize: "1.5rem",
          letterSpacing: "-0.03em",
          lineHeight: 1.15,
        }}
      >
        Homeowner booking &amp; quote-request flow
      </h1>
      <p style={{ margin: "0 0 0.75rem", color: "#57534e", lineHeight: 1.55, fontSize: "0.9rem" }}>
        The widget an operator embeds on their site to turn a visitor with a plumbing
        problem into a booked visit or a quote request — built to capture the lead fast.
      </p>
      <p style={{ margin: 0, color: "#57534e", lineHeight: 1.55, fontSize: "0.85rem" }}>
        <strong style={{ color: "#1c1917" }}>Reading this canvas:</strong> the happy path runs
        top-to-bottom, steps 1→6. Alternate states (validation, no availability, the emergency
        fast-lane, and the emergency confirmation) sit beside or below their step. Every frame is a
        real production component from <code>components/booking/</code>, not a mockup.
      </p>
    </Card>
  );
}

export function EmergencyCallout() {
  return (
    <Card accent="#b91c1c">
      <div
        style={{
          fontSize: "0.72rem",
          fontWeight: 700,
          letterSpacing: "0.1em",
          textTransform: "uppercase",
          color: "#b91c1c",
          marginBottom: "0.4rem",
        }}
      >
        ↓ Emergency branch
      </div>
      <p style={{ margin: 0, color: "#57534e", lineHeight: 1.55, fontSize: "0.88rem" }}>
        When the homeowner marks the job an <strong style={{ color: "#1c1917" }}>emergency</strong>{" "}
        on step 2, the flow skips scheduling and goes straight to a phone call — a live{" "}
        <em>Call now</em> plus an urgent call-back. This is the path that produces the operator&apos;s
        calls, so it&apos;s deliberately the shortest one in the product.
      </p>
    </Card>
  );
}
