import { loadFindingsCallBooked } from "@/lib/booking/findings-call-booked";
import {
  FINDING_QUESTION,
  RESULT_QUESTION,
  TIMING_QUESTION,
} from "@/lib/copy/pre-call";

describe("loadFindingsCallBooked", () => {
  it("returns the formatted module when a meeting and prep answers exist", async () => {
    const view = await loadFindingsCallBooked("audit-1", {
      lookup: {
        async findActiveMeeting() {
          return {
            scheduledStart: "2026-09-18T18:00:00.000Z",
            scheduledEnd: "2026-09-18T18:30:00.000Z",
          };
        },
        async findPrepAnswers() {
          return {
            findingAnswer: "Make the phone number obvious",
            resultAnswer: "More phone calls",
            timingAnswer: "Right away",
          };
        },
      },
    });
    expect(view).toEqual({
      scheduledStart: "2026-09-18T18:00:00.000Z",
      scheduledEnd: "2026-09-18T18:30:00.000Z",
      prepAnswers: [
        {
          question: FINDING_QUESTION,
          answer: "Make the phone number obvious",
        },
        { question: RESULT_QUESTION, answer: "More phone calls" },
        { question: TIMING_QUESTION, answer: "Right away" },
      ],
    });
  });

  it("omits the prep callout when no answers were captured", async () => {
    const view = await loadFindingsCallBooked("audit-1", {
      lookup: {
        async findActiveMeeting() {
          return {
            scheduledStart: "2026-09-18T18:00:00.000Z",
            scheduledEnd: "2026-09-18T18:30:00.000Z",
          };
        },
        async findPrepAnswers() {
          return {
            findingAnswer: null,
            resultAnswer: null,
            timingAnswer: null,
          };
        },
      },
    });
    expect(view).toEqual({
      scheduledStart: "2026-09-18T18:00:00.000Z",
      scheduledEnd: "2026-09-18T18:30:00.000Z",
      prepAnswers: null,
    });
  });

  it("returns null when no booked meeting exists", async () => {
    const view = await loadFindingsCallBooked("audit-1", {
      lookup: {
        async findActiveMeeting() {
          return null;
        },
        async findPrepAnswers() {
          throw new Error("must not look up prep answers without a meeting");
        },
      },
    });
    expect(view).toBeNull();
  });
});
