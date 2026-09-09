/**
 * Step 2 — Job details: description, urgency, property type, optional photo.
 * `showErrors` renders the validation state used in the canvas.
 * The canvas for this feature is at tempo/designs/canvases/booking-flow/index.canvas.tsx.
 */
"use client";

import { useState } from "react";
import styles from "./booking.module.css";
import { PROPERTY_TYPES } from "./mockData";
import { AlertIcon, BoltIcon, ClockIcon, CalendarIcon } from "./icons";

const URGENCY = [
  { id: "emergency", name: "Emergency", sub: "Right now", Icon: BoltIcon, urgent: true },
  { id: "this-week", name: "This week", sub: "Soon-ish", Icon: ClockIcon },
  { id: "flexible", name: "Flexible", sub: "No rush", Icon: CalendarIcon },
];

export function JobDetailsStep({
  showErrors = false,
  initialDescription = showErrors ? "" : "Water is pooling under the kitchen sink and the cabinet floor is soaked.",
  initialUrgency = showErrors ? null : "this-week",
  initialProperty = "House",
  onContinue,
}: {
  showErrors?: boolean;
  initialDescription?: string;
  initialUrgency?: string | null;
  initialProperty?: string;
  onContinue?: () => void;
}) {
  const [description, setDescription] = useState(initialDescription);
  const [urgency, setUrgency] = useState<string | null>(initialUrgency);
  const [property, setProperty] = useState(initialProperty);

  const descError = showErrors && description.trim() === "";
  const urgencyError = showErrors && !urgency;

  return (
    <>
      <div className={styles.field}>
        <label className={styles.label} htmlFor="job-desc">
          Tell us what&apos;s going on
        </label>
        <textarea
          id="job-desc"
          className={`${styles.textarea} ${descError ? styles.inputError : ""}`}
          placeholder="e.g. The water heater stopped working last night and there's a puddle underneath."
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
        {descError && (
          <span className={styles.errorText}>
            <AlertIcon width={13} height={13} /> A quick description helps us send the right pro.
          </span>
        )}
      </div>

      <div className={styles.field}>
        <label className={styles.label}>How soon do you need it?</label>
        <div className={styles.segment}>
          {URGENCY.map((u) => {
            const isSel = urgency === u.id;
            return (
              <button
                key={u.id}
                type="button"
                className={`${styles.segmentBtn} ${
                  isSel ? (u.urgent ? styles.segmentSelectedUrgent : styles.segmentSelected) : ""
                }`}
                aria-pressed={isSel}
                onClick={() => setUrgency(u.id)}
              >
                <u.Icon width={18} height={18} />
                {u.name}
                <span className={styles.segmentSub}>{u.sub}</span>
              </button>
            );
          })}
        </div>
        {urgencyError && (
          <span className={styles.errorText}>
            <AlertIcon width={13} height={13} /> Let us know how urgent this is.
          </span>
        )}
      </div>

      <div className={styles.field}>
        <label className={styles.label}>Property type</label>
        <div className={styles.chipRow}>
          {PROPERTY_TYPES.map((p) => (
            <button
              key={p}
              type="button"
              className={`${styles.chip} ${property === p ? styles.chipSelected : ""}`}
              aria-pressed={property === p}
              onClick={() => setProperty(p)}
            >
              {p}
            </button>
          ))}
        </div>
      </div>

      <div className={styles.field}>
        <label className={styles.label}>
          Add a photo <span className={styles.optional}>— optional, speeds up your quote</span>
        </label>
        <button type="button" className={`${styles.btn} ${styles.btnGhost} ${styles.btnBlock}`}>
          + Attach a photo
        </button>
      </div>

      <div className={styles.footer}>
        <button type="button" className={`${styles.btn} ${styles.btnGhost}`}>
          Back
        </button>
        <button
          type="button"
          className={`${styles.btn} ${styles.btnPrimary}`}
          onClick={onContinue}
        >
          Continue
        </button>
      </div>
    </>
  );
}
