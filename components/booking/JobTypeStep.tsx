/**
 * Step 1 — Job type. Homeowner picks what they need help with.
 * The canvas for this feature is at tempo/designs/canvases/booking-flow/index.canvas.tsx.
 */
"use client";

import { useState } from "react";
import styles from "./booking.module.css";
import { JOB_TYPES } from "./mockData";
import { AlertIcon } from "./icons";

export function JobTypeStep({
  initialSelected = "leak",
  onContinue,
}: {
  initialSelected?: string | null;
  onContinue?: (jobId: string) => void;
}) {
  const [selected, setSelected] = useState<string | null>(initialSelected);

  return (
    <>
      <div className={styles.jobGrid}>
        {JOB_TYPES.map((job) => {
          const isSel = selected === job.id;
          return (
            <button
              key={job.id}
              type="button"
              className={`${styles.jobCard} ${isSel ? styles.jobCardSelected : ""}`}
              aria-pressed={isSel}
              onClick={() => setSelected(job.id)}
            >
              <span className={styles.jobIcon}>
                <job.Icon />
              </span>
              <span className={styles.jobName}>{job.name}</span>
              <span className={styles.jobDesc}>{job.desc}</span>
              {job.oftenUrgent && (
                <span className={styles.urgentTag}>
                  <AlertIcon width={12} height={12} /> Often urgent
                </span>
              )}
            </button>
          );
        })}
      </div>
      <div className={styles.footer}>
        <button
          type="button"
          className={`${styles.btn} ${styles.btnPrimary} ${
            selected ? "" : styles.btnDisabled
          }`}
          disabled={!selected}
          onClick={() => selected && onContinue?.(selected)}
        >
          Continue
        </button>
      </div>
    </>
  );
}
