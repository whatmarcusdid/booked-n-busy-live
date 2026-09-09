/**
 * BookingFlow — the clickable homeowner journey wired together with local state.
 * UI-only prototype: no persistence, submit is stubbed. An engineer swaps the
 * mock data + stubbed handlers for the real catalog, availability, and lead API.
 *
 * The canvas for this feature is at tempo/designs/canvases/booking-flow/index.canvas.tsx.
 */
"use client";

import { useState } from "react";
import { BookingShell } from "./BookingShell";
import { JobTypeStep } from "./JobTypeStep";
import { JobDetailsStep } from "./JobDetailsStep";
import { PreferredTimeStep } from "./PreferredTimeStep";
import { EmergencyStep } from "./EmergencyStep";
import { ContactStep } from "./ContactStep";
import { ReviewStep } from "./ReviewStep";
import { ConfirmationStep } from "./ConfirmationStep";
import { JOB_TYPES } from "./mockData";

type Stage =
  | "job"
  | "details"
  | "time"
  | "contact"
  | "review"
  | "done"
  | "emergency";

export function BookingFlow() {
  const [stage, setStage] = useState<Stage>("job");
  const [jobId, setJobId] = useState<string>("leak");

  const isEmergencyJob = JOB_TYPES.find((j) => j.id === jobId)?.oftenUrgent;

  switch (stage) {
    case "job":
      return (
        <BookingShell
          step={1}
          title="What do you need help with?"
          intro="Pick the closest match — you can add detail on the next step."
        >
          <JobTypeStep
            initialSelected={jobId}
            onContinue={(id) => {
              setJobId(id);
              setStage("details");
            }}
          />
        </BookingShell>
      );
    case "details":
      return (
        <BookingShell
          step={2}
          title="Tell us a bit more"
          intro="The more we know, the faster we can send the right pro with the right parts."
        >
          <JobDetailsStep
            onContinue={() => setStage(isEmergencyJob ? "emergency" : "time")}
          />
        </BookingShell>
      );
    case "emergency":
      return (
        <BookingShell step={0} title="Let's get you help fast" showProgress={false}>
          <EmergencyStep variant="call" />
        </BookingShell>
      );
    case "time":
      return (
        <BookingShell
          step={3}
          title="When works for you?"
          intro="Choose a day and an arrival window. We'll confirm the exact time by text."
        >
          <PreferredTimeStep onContinue={() => setStage("contact")} />
        </BookingShell>
      );
    case "contact":
      return (
        <BookingShell step={4} title="Where should we come, and how do we reach you?">
          <ContactStep onContinue={() => setStage("review")} />
        </BookingShell>
      );
    case "review":
      return (
        <BookingShell step={5} title="Does this look right?">
          <ReviewStep mode="book" onConfirm={() => setStage("done")} />
        </BookingShell>
      );
    case "done":
      return (
        <BookingShell step={5} showProgress={false}>
          <ConfirmationStep variant="standard" />
        </BookingShell>
      );
  }
}
