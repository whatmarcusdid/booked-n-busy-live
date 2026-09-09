/**
 * Composed booking screens (shell + step) used one-per-storyboard on the canvas.
 * These keep the canvas file a thin pointer and give each frame a full,
 * in-context screen to render.
 *
 * The canvas for this feature is at tempo/designs/canvases/booking-flow/index.canvas.tsx.
 * If you add or rename a screen, keep that canvas consistent.
 */
"use client";

import { BookingShell } from "./BookingShell";
import { JobTypeStep } from "./JobTypeStep";
import { JobDetailsStep } from "./JobDetailsStep";
import { PreferredTimeStep } from "./PreferredTimeStep";
import { EmergencyStep } from "./EmergencyStep";
import { ContactStep } from "./ContactStep";
import { ReviewStep } from "./ReviewStep";
import { ConfirmationStep } from "./ConfirmationStep";

export function ScreenJobType() {
  return (
    <BookingShell
      step={1}
      title="What do you need help with?"
      intro="Pick the closest match — you can add detail on the next step."
    >
      <JobTypeStep />
    </BookingShell>
  );
}

export function ScreenJobDetails() {
  return (
    <BookingShell
      step={2}
      title="Tell us a bit more"
      intro="The more we know, the faster we can send the right pro with the right parts."
    >
      <JobDetailsStep />
    </BookingShell>
  );
}

export function ScreenJobDetailsErrors() {
  return (
    <BookingShell
      step={2}
      title="Tell us a bit more"
      intro="The more we know, the faster we can send the right pro with the right parts."
    >
      <JobDetailsStep showErrors />
    </BookingShell>
  );
}

export function ScreenPreferredTime() {
  return (
    <BookingShell
      step={3}
      title="When works for you?"
      intro="Choose a day and an arrival window. We'll confirm the exact time by text."
    >
      <PreferredTimeStep />
    </BookingShell>
  );
}

export function ScreenPreferredTimeEmpty() {
  return (
    <BookingShell
      step={3}
      title="When works for you?"
      intro="Choose a day and an arrival window. We'll confirm the exact time by text."
    >
      <PreferredTimeStep noAvailability />
    </BookingShell>
  );
}

export function ScreenEmergencyCall() {
  return (
    <BookingShell step={0} title="Let's get you help fast" showProgress={false}>
      <EmergencyStep variant="call" />
    </BookingShell>
  );
}

export function ScreenEmergencyRequested() {
  return (
    <BookingShell step={0} title="Hang tight" showProgress={false}>
      <EmergencyStep variant="requested" />
    </BookingShell>
  );
}

export function ScreenContact() {
  return (
    <BookingShell
      step={4}
      title="Where should we come, and how do we reach you?"
    >
      <ContactStep />
    </BookingShell>
  );
}

export function ScreenReview() {
  return (
    <BookingShell step={5} title="Does this look right?">
      <ReviewStep mode="book" />
    </BookingShell>
  );
}

export function ScreenConfirmation() {
  return (
    <BookingShell step={5} showProgress={false}>
      <ConfirmationStep variant="standard" />
    </BookingShell>
  );
}

export function ScreenConfirmationEmergency() {
  return (
    <BookingShell step={0} showProgress={false}>
      <ConfirmationStep variant="emergency" />
    </BookingShell>
  );
}
