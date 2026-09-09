/**
 * Mock data for the booking / quote-request prototype.
 * UI-only — no backend. An engineer replaces these with real service catalog,
 * availability, and operator settings at handoff.
 *
 * The canvas for this feature is at tempo/designs/canvases/booking-flow/index.canvas.tsx.
 * If you change these shapes, keep that canvas consistent.
 */
import type { ComponentType, SVGProps } from "react";
import {
  DropIcon,
  DrainIcon,
  HeaterIcon,
  FaucetIcon,
  PipeIcon,
  WrenchIcon,
} from "./icons";

export type JobType = {
  id: string;
  name: string;
  desc: string;
  Icon: ComponentType<SVGProps<SVGSVGElement>>;
  oftenUrgent?: boolean;
};

export const JOB_TYPES: JobType[] = [
  {
    id: "leak",
    name: "Leak or burst pipe",
    desc: "Dripping, flooding, or water where it shouldn't be.",
    Icon: DropIcon,
    oftenUrgent: true,
  },
  {
    id: "drain",
    name: "Clogged drain",
    desc: "Slow or backed-up sink, tub, or sewer line.",
    Icon: DrainIcon,
    oftenUrgent: true,
  },
  {
    id: "water-heater",
    name: "No hot water",
    desc: "Water heater not heating, leaking, or too old.",
    Icon: HeaterIcon,
  },
  {
    id: "fixture",
    name: "Toilet or faucet",
    desc: "Running, clogged, or a new fixture to install.",
    Icon: FaucetIcon,
  },
  {
    id: "repipe",
    name: "Repipe or remodel",
    desc: "Bigger project or planning a renovation.",
    Icon: PipeIcon,
  },
  {
    id: "other",
    name: "Something else",
    desc: "Not sure? Tell us and we'll figure it out.",
    Icon: WrenchIcon,
  },
];

export const PROPERTY_TYPES = ["House", "Condo", "Rental", "Business"];

export type ArrivalWindow = {
  id: string;
  name: string;
  time: string;
  soonest?: boolean;
};

export const ARRIVAL_WINDOWS: ArrivalWindow[] = [
  { id: "soonest", name: "Earliest available", time: "We'll grab the first open slot", soonest: true },
  { id: "morning", name: "Morning", time: "8:00 AM – 12:00 PM" },
  { id: "afternoon", name: "Afternoon", time: "12:00 PM – 4:00 PM" },
  { id: "evening", name: "Evening", time: "4:00 PM – 7:00 PM" },
];

export type DayCell = {
  dow: string;
  num: number;
  mon: string;
  disabled?: boolean;
};

export const DAYS: DayCell[] = [
  { dow: "Tue", num: 9, mon: "Sep" },
  { dow: "Wed", num: 10, mon: "Sep" },
  { dow: "Thu", num: 11, mon: "Sep" },
  { dow: "Fri", num: 12, mon: "Sep", disabled: true },
  { dow: "Sat", num: 13, mon: "Sep" },
  { dow: "Sun", num: 14, mon: "Sep", disabled: true },
  { dow: "Mon", num: 15, mon: "Sep" },
  { dow: "Tue", num: 16, mon: "Sep" },
];

export const OPERATOR = {
  name: "Rivertown Plumbing Co.",
  phone: "(555) 018-2274",
  responseMins: 15,
};
