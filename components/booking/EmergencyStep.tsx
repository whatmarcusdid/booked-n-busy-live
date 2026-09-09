/**
 * Emergency fast-lane — replaces standard scheduling when the homeowner marks the
 * job an emergency. This is where the operator's calls come from.
 * `variant="requested"` shows the urgent call-back confirmation.
 * The canvas for this feature is at tempo/designs/canvases/booking-flow/index.canvas.tsx.
 */
"use client";

import styles from "./booking.module.css";
import { OPERATOR } from "./mockData";
import { AlertIcon, PhoneIcon, CheckIcon } from "./icons";

export function EmergencyStep({
  variant = "call",
}: {
  variant?: "call" | "requested";
}) {
  if (variant === "requested") {
    return (
      <>
        <div className={styles.emgBanner}>
          <span className={styles.emgIcon} style={{ background: "var(--ok-ink)" }}>
            <CheckIcon width={18} height={18} />
          </span>
          <div>
            <div className={styles.emgTitle} style={{ color: "var(--ok-ink)" }}>
              We&apos;re calling you back now
            </div>
            <div className={styles.emgText} style={{ color: "var(--ok-ink)" }}>
              {OPERATOR.name} was notified and will ring you within about{" "}
              {OPERATOR.responseMins} minutes. Keep your phone close.
            </div>
          </div>
        </div>
        <p className={styles.stepIntro}>
          If it&apos;s getting worse — water spreading, no shut-off — call us directly, don&apos;t
          wait for the call-back.
        </p>
        <button type="button" className={styles.callBtn}>
          <PhoneIcon width={20} height={20} /> Call {OPERATOR.phone}
        </button>
      </>
    );
  }

  return (
    <>
      <div className={styles.emgBanner}>
        <span className={styles.emgIcon}>
          <AlertIcon width={18} height={18} />
        </span>
        <div>
          <div className={styles.emgTitle}>Sounds like an emergency</div>
          <div className={styles.emgText}>
            For active leaks and no-water situations, the fastest fix is a phone call. A live
            dispatcher at {OPERATOR.name} can be on the line right now.
          </div>
        </div>
      </div>

      <button type="button" className={styles.callBtn}>
        <PhoneIcon width={20} height={20} /> Call now
      </button>
      <p className={styles.callNumber}>
        {OPERATOR.phone} · Live 24/7 for emergencies
      </p>

      <div className={styles.divider}>or</div>

      <p className={styles.stepIntro} style={{ marginBottom: "0.75rem" }}>
        Can&apos;t talk right now? Leave your number and we&apos;ll call you back in about{" "}
        {OPERATOR.responseMins} minutes.
      </p>
      <div className={styles.field}>
        <label className={styles.label} htmlFor="emg-name">
          Your name
        </label>
        <input id="emg-name" className={styles.input} placeholder="Jordan Alvarez" />
      </div>
      <div className={styles.field}>
        <label className={styles.label} htmlFor="emg-phone">
          Best number to reach you
        </label>
        <input id="emg-phone" className={styles.input} placeholder="(555) 555-1234" inputMode="tel" />
      </div>
      <button type="button" className={`${styles.btn} ${styles.btnGhost} ${styles.btnBlock}`}>
        Request an urgent call-back
      </button>
    </>
  );
}
