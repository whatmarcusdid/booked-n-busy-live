/**
 * Step 6 — Confirmation. Standard success (visit booked) and the emergency
 * variant (we're calling you now).
 * The canvas for this feature is at tempo/designs/canvases/booking-flow/index.canvas.tsx.
 */
"use client";

import styles from "./booking.module.css";
import { CheckIcon, PhoneIcon } from "./icons";
import { OPERATOR } from "./mockData";

export function ConfirmationStep({
  variant = "standard",
}: {
  variant?: "standard" | "emergency";
}) {
  const emergency = variant === "emergency";

  return (
    <div className={styles.confirm}>
      <span
        className={`${styles.confirmMark} ${emergency ? styles.confirmMarkUrgent : ""}`}
      >
        {emergency ? <PhoneIcon width={26} height={26} /> : <CheckIcon width={28} height={28} />}
      </span>

      <h2 className={styles.confirmTitle}>
        {emergency ? "Help is on the way" : "You're on the schedule"}
      </h2>
      <p className={styles.confirmText}>
        {emergency ? (
          <>
            {OPERATOR.name} is calling you now at <strong>(555) 402-8891</strong>. If you miss it,
            they&apos;ll try again right away.
          </>
        ) : (
          <>
            {OPERATOR.name} received your request for <strong>Tue, Sep 9</strong>. You&apos;ll get a
            text to confirm your arrival window shortly.
          </>
        )}
      </p>

      <div className={styles.nextCard}>
        <div className={styles.nextTitle}>What happens next</div>
        {emergency ? (
          <>
            <div className={styles.nextStep}>
              <span className={styles.nextNum}>1</span>
              <span>Answer the call from {OPERATOR.phone} — that&apos;s your dispatcher.</span>
            </div>
            <div className={styles.nextStep}>
              <span className={styles.nextNum}>2</span>
              <span>They&apos;ll walk you through shutting off the water if needed.</span>
            </div>
            <div className={styles.nextStep}>
              <span className={styles.nextNum}>3</span>
              <span>A pro is dispatched to 48 Maple Court.</span>
            </div>
          </>
        ) : (
          <>
            <div className={styles.nextStep}>
              <span className={styles.nextNum}>1</span>
              <span>We confirm your window by text within {OPERATOR.responseMins} minutes.</span>
            </div>
            <div className={styles.nextStep}>
              <span className={styles.nextNum}>2</span>
              <span>Your pro texts when they&apos;re on the way.</span>
            </div>
            <div className={styles.nextStep}>
              <span className={styles.nextNum}>3</span>
              <span>You get an upfront quote before any work starts.</span>
            </div>
          </>
        )}
      </div>

      {!emergency && (
        <p className={styles.refRow}>
          Confirmation <span className={styles.refCode}>#BNB-4821</span>
        </p>
      )}
    </div>
  );
}
