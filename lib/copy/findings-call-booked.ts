import {
  FINDING_QUESTION,
  PRE_CALL_HEADLINE,
  RESULT_QUESTION,
  TIMING_QUESTION,
} from "./pre-call";

/**
 * Customer-facing copy for the results-page booked module
 * (Figma 131:1175 mobile, 131:1259 tablet, 131:1377 desktop).
 *
 * Add To Calendar is omitted: meetings store times and an optional
 * google_event_id, not an .ics or Calendar htmlLink. The unanswered
 * prep form in those frames is also omitted — captured answers only,
 * and only as a read-only callout.
 */

export const FINDINGS_CALL_BOOKED_PILL = "You\u2019re Booked";

export const FINDINGS_CALL_BOOKED_CHANGE_LEAD = "Need to change your time? ";

export const FINDINGS_CALL_BOOKED_CHANGE_HINT =
  "Check the confirmation email from Google for reschedule and cancel options.";

export const FINDINGS_CALL_BOOKED_PREP_HEADLINE = PRE_CALL_HEADLINE;

export const FINDINGS_CALL_BOOKED_PREP_QUESTIONS = [
  FINDING_QUESTION,
  RESULT_QUESTION,
  TIMING_QUESTION,
] as const;

const SHORT_MONTH_TO_FIGMA: Record<string, string> = {
  Jan: "Jan",
  Feb: "Feb",
  Mar: "Mar",
  Apr: "Apr",
  May: "May",
  Jun: "Jun",
  Jul: "Jul",
  Aug: "Aug",
  Sep: "Sept",
  Oct: "Oct",
  Nov: "Nov",
  Dec: "Dec",
};

function partsFor(date: Date, timeZone: string): Record<string, string> {
  const parts: Record<string, string> = {};
  for (const part of new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "long",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZoneName: "short",
  }).formatToParts(date)) {
    if (part.type !== "literal") parts[part.type] = part.value;
  }
  return parts;
}

/**
 * True when `timeZone` is a valid IANA zone for `Intl`.
 * Invalid values must not be passed to the formatter — they throw.
 */
export function resolveFindingsCallTimeZone(
  timeZone: string | null | undefined,
): string | null {
  if (!timeZone) return null;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone }).format(0);
    return timeZone;
  } catch {
    return null;
  }
}

/**
 * Figma shape: "Thursday, Sept 18 · 2:00–2:30 PM EDT"
 * (middle dot, en-dash, shared meridiem, short timezone).
 * `timeZone` is required so the abbreviation always matches the clock.
 */
export function formatFindingsCallWhen(
  startIso: string,
  endIso: string,
  timeZone: string,
): string {
  const start = partsFor(new Date(startIso), timeZone);
  const end = partsFor(new Date(endIso), timeZone);
  const month = SHORT_MONTH_TO_FIGMA[start.month] ?? start.month;
  const startTime = `${start.hour}:${start.minute}`;
  const endTime = `${end.hour}:${end.minute}`;
  const when =
    start.dayPeriod === end.dayPeriod
      ? `${startTime}\u2013${endTime} ${start.dayPeriod}`
      : `${startTime} ${start.dayPeriod}\u2013${endTime} ${end.dayPeriod}`;
  return `${start.weekday}, ${month} ${start.day} \u00b7 ${when} ${start.timeZoneName}`;
}
