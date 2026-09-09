/**
 * Step 4 — Contact & address. Phone is the money field: it's how the operator
 * reaches the lead fast.
 * The canvas for this feature is at tempo/designs/canvases/booking-flow/index.canvas.tsx.
 */
"use client";

import styles from "./booking.module.css";
import { ShieldIcon } from "./icons";

export function ContactStep({
  prefilled = true,
  onContinue,
}: {
  prefilled?: boolean;
  onContinue?: () => void;
}) {
  return (
    <>
      <div className={styles.field}>
        <label className={styles.label} htmlFor="c-name">
          Full name
        </label>
        <input
          id="c-name"
          className={styles.input}
          placeholder="Jordan Alvarez"
          defaultValue={prefilled ? "Jordan Alvarez" : ""}
        />
      </div>
      <div className={styles.field}>
        <label className={styles.label} htmlFor="c-phone">
          Phone <span className={styles.optional}>— how we confirm your visit</span>
        </label>
        <input
          id="c-phone"
          className={styles.input}
          placeholder="(555) 555-1234"
          inputMode="tel"
          defaultValue={prefilled ? "(555) 402-8891" : ""}
        />
      </div>
      <div className={styles.field}>
        <label className={styles.label} htmlFor="c-email">
          Email <span className={styles.optional}>— for your confirmation</span>
        </label>
        <input
          id="c-email"
          className={styles.input}
          placeholder="you@email.com"
          inputMode="email"
          defaultValue={prefilled ? "jordan.a@email.com" : ""}
        />
      </div>
      <div className={styles.field}>
        <label className={styles.label} htmlFor="c-address">
          Service address
        </label>
        <input
          id="c-address"
          className={styles.input}
          placeholder="Street, city, ZIP"
          defaultValue={prefilled ? "48 Maple Court, Rivertown, OH 45042" : ""}
        />
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
          Review request
        </button>
      </div>
      <div className={styles.reassure}>
        <ShieldIcon width={14} height={14} /> We only use this to contact you about your job.
      </div>
    </>
  );
}
