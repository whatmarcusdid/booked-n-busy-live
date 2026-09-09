import { BookingFlow } from "@/components/booking/BookingFlow";

export const metadata = {
  title: "Book a visit · Booked N Busy Live",
  description: "Request a plumbing visit or a quote in a couple of taps.",
};

// UI-only prototype for BOO-1. Renders the clickable homeowner booking flow.
// No persistence yet — see components/booking/BookingFlow.tsx.
export default function BookPage() {
  return <BookingFlow />;
}
