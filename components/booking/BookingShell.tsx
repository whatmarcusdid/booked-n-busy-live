/**
 * Shared frame for every booking step: brand header, step progress, title/intro,
 * and the step's body. Presentational — orchestration lives in BookingFlow.
 *
 * The canvas for this feature is at tempo/designs/canvases/booking-flow/index.canvas.tsx.
 * If you adjust this component, keep the canvas and its storyboards consistent.
 */
import type { ReactNode } from "react";
import styles from "./booking.module.css";
import { WrenchIcon } from "./icons";

export const TOTAL_STEPS = 5;

export function BookingShell({
  step,
  title,
  intro,
  children,
  showProgress = true,
}: {
  step: number;
  title?: ReactNode;
  intro?: ReactNode;
  children: ReactNode;
  showProgress?: boolean;
}) {
  return (
    <div className={styles.stage}>
      <div className={styles.widget}>
        <div className={styles.header}>
          <div className={styles.brandRow}>
            <span className={styles.brandMark}>
              <WrenchIcon width={16} height={16} />
            </span>
            <span className={styles.brandName}>Booked N Busy Live</span>
            <span className={styles.brandTag}>Rivertown Plumbing</span>
          </div>
          {showProgress && (
            <div className={styles.progress}>
              <span className={styles.progressLabel}>
                Step {step} of {TOTAL_STEPS}
              </span>
              {Array.from({ length: TOTAL_STEPS }).map((_, i) => (
                <span
                  key={i}
                  className={`${styles.pip} ${
                    i + 1 < step
                      ? styles.pipDone
                      : i + 1 === step
                        ? styles.pipActive
                        : ""
                  }`}
                />
              ))}
            </div>
          )}
        </div>
        <div className={styles.body}>
          {title && <h2 className={styles.stepTitle}>{title}</h2>}
          {intro && <p className={styles.stepIntro}>{intro}</p>}
          {children}
        </div>
      </div>
    </div>
  );
}
