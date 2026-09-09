/**
 * Step 5 — Review & confirm. Read-back with per-section edit, then the submit
 * action labeled to the intent (book a visit vs. send a quote request).
 * The canvas for this feature is at tempo/designs/canvases/booking-flow/index.canvas.tsx.
 */
"use client";

import styles from "./booking.module.css";
import { ClockIcon } from "./icons";
import { OPERATOR } from "./mockData";

type Row = { label: string; value: string; sub?: string };

const ROWS: Row[] = [
  { label: "Job", value: "Leak or burst pipe", sub: "Water pooling under the kitchen sink" },
  { label: "Urgency", value: "This week" },
  { label: "Time", value: "Tue, Sep 9", sub: "Earliest available window" },
  { label: "Address", value: "48 Maple Court", sub: "Rivertown, OH 45042" },
  { label: "Contact", value: "Jordan Alvarez", sub: "(555) 402-8891 · jordan.a@email.com" },
];

export function ReviewStep({
  mode = "book",
  onConfirm,
}: {
  mode?: "book" | "quote";
  onConfirm?: () => void;
}) {
  return (
    <>
      <div className={styles.reviewList}>
        {ROWS.map((r) => (
          <div key={r.label} className={styles.reviewRow}>
            <span className={styles.reviewLabel}>{r.label}</span>
            <span>
              <span className={styles.reviewValue}>{r.value}</span>
              {r.sub && (
                <>
                  <br />
                  <span className={styles.reviewSub}>{r.sub}</span>
                </>
              )}
            </span>
            <button type="button" className={styles.editLink}>
              Edit
            </button>
          </div>
        ))}
      </div>

      <div className={styles.footer}>
        <button type="button" className={`${styles.btn} ${styles.btnGhost}`}>
          Back
        </button>
        <button
          type="button"
          className={`${styles.btn} ${styles.btnPrimary}`}
          onClick={onConfirm}
        >
          {mode === "book" ? "Book my visit" : "Send my request"}
        </button>
      </div>
      <div className={styles.reassure}>
        <ClockIcon width={14} height={14} /> {OPERATOR.name} typically replies within{" "}
        {OPERATOR.responseMins} minutes.
      </div>
    </>
  );
}
