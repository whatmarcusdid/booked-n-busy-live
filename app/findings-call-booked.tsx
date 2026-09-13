import type { FindingsCallBookedView } from "@/lib/booking/findings-call-booked";
import {
  FINDINGS_CALL_BOOKED_CHANGE_HINT,
  FINDINGS_CALL_BOOKED_CHANGE_LEAD,
  FINDINGS_CALL_BOOKED_PILL,
  FINDINGS_CALL_BOOKED_PREP_HEADLINE,
} from "@/lib/copy/findings-call-booked";
import { FindingsCallWhen } from "./findings-call-when";
import "./findings-call-booked.css";

export function FindingsCallBooked({
  view,
  timeZone,
}: {
  view: FindingsCallBookedView;
  timeZone?: string;
}) {
  return (
    <section
      className="findings-call-booked"
      data-testid="findings-call-booked"
      aria-label={FINDINGS_CALL_BOOKED_PILL}
    >
      <div className="findings-call-booked-hero">
        <p className="findings-call-booked-pill">{FINDINGS_CALL_BOOKED_PILL}</p>
        <FindingsCallWhen
          startIso={view.scheduledStart}
          endIso={view.scheduledEnd}
          timeZone={timeZone}
        />
        <p className="findings-call-booked-change">
          <span>{FINDINGS_CALL_BOOKED_CHANGE_LEAD}</span>
          <span className="findings-call-booked-change-hint">
            {FINDINGS_CALL_BOOKED_CHANGE_HINT}
          </span>
        </p>
      </div>
      {view.prepAnswers ? (
        <div
          className="findings-call-booked-prep"
          data-testid="findings-call-booked-prep"
        >
          <h3 className="findings-call-booked-prep-headline">
            {FINDINGS_CALL_BOOKED_PREP_HEADLINE}
          </h3>
          <dl className="findings-call-booked-prep-list">
            {view.prepAnswers.map((item) => (
              <div
                className="findings-call-booked-prep-item"
                key={item.question}
              >
                <dt>{item.question}</dt>
                <dd>{item.answer}</dd>
              </div>
            ))}
          </dl>
        </div>
      ) : null}
    </section>
  );
}
