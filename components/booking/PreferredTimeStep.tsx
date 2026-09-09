/**
 * Step 3 — Preferred time: pick a day and an arrival window.
 * `noAvailability` renders the empty state for a fully-booked day.
 * The canvas for this feature is at tempo/designs/canvases/booking-flow/index.canvas.tsx.
 */
"use client";

import { useState } from "react";
import styles from "./booking.module.css";
import { DAYS, ARRIVAL_WINDOWS } from "./mockData";
import { CalendarIcon } from "./icons";

export function PreferredTimeStep({
  noAvailability = false,
  initialDay = 0,
  initialWindow = "soonest",
  onContinue,
}: {
  noAvailability?: boolean;
  initialDay?: number;
  initialWindow?: string | null;
  onContinue?: () => void;
}) {
  const [dayIdx, setDayIdx] = useState(initialDay);
  const [windowId, setWindowId] = useState<string | null>(initialWindow);

  return (
    <>
      <div className={styles.dateStrip}>
        {DAYS.map((d, i) => (
          <button
            key={`${d.dow}-${d.num}`}
            type="button"
            disabled={d.disabled}
            className={`${styles.dateCell} ${
              d.disabled ? styles.dateDisabled : ""
            } ${!d.disabled && dayIdx === i && !noAvailability ? styles.dateSelected : ""} ${
              noAvailability && i === 3 ? styles.dateSelected : ""
            }`}
            onClick={() => !d.disabled && setDayIdx(i)}
          >
            <span className={styles.dateDow}>{d.dow}</span>
            <span className={styles.dateNum}>{d.num}</span>
            <span className={styles.dateMon}>{d.mon}</span>
          </button>
        ))}
      </div>

      {noAvailability ? (
        <div className={styles.empty}>
          <span className={styles.emptyIcon}>
            <CalendarIcon />
          </span>
          <div className={styles.emptyTitle}>Fully booked that day</div>
          <p className={styles.emptyText}>
            Fri, Sep 12 has no open windows. The soonest we can be there is{" "}
            <strong>Sat, Sep 13, morning</strong>.
          </p>
          <div className={styles.footer}>
            <button type="button" className={`${styles.btn} ${styles.btnPrimary} ${styles.btnBlock}`}>
              See Sat, Sep 13
            </button>
          </div>
        </div>
      ) : (
        <>
          <div className={styles.windowList}>
            {ARRIVAL_WINDOWS.map((w) => {
              const isSel = windowId === w.id;
              return (
                <button
                  key={w.id}
                  type="button"
                  className={`${styles.windowBtn} ${isSel ? styles.windowSelected : ""}`}
                  aria-pressed={isSel}
                  onClick={() => setWindowId(w.id)}
                >
                  <span>
                    <span className={styles.windowName}>{w.name}</span>
                    <br />
                    <span className={styles.windowTime}>{w.time}</span>
                  </span>
                  {w.soonest && <span className={styles.windowBadge}>Fastest</span>}
                </button>
              );
            })}
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
      )}
    </>
  );
}
