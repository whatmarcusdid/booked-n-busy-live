/**
 * Small inline line-icons for the booking flow, sized by the parent's color/font.
 * Kept local to the feature; a future design system would replace these with the
 * shared icon set.
 */
import type { SVGProps } from "react";

const base = {
  width: 20,
  height: 20,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.8,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

export function DropIcon(p: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base} {...p}>
      <path d="M12 3s6 6.5 6 11a6 6 0 0 1-12 0c0-4.5 6-11 6-11Z" />
    </svg>
  );
}

export function DrainIcon(p: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base} {...p}>
      <circle cx="12" cy="12" r="8" />
      <path d="M12 4v16M4 12h16M6.5 6.5l11 11M17.5 6.5l-11 11" />
    </svg>
  );
}

export function HeaterIcon(p: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base} {...p}>
      <rect x="6" y="3" width="12" height="18" rx="3" />
      <path d="M9 7h6M12 12c1.5 1 1.5 3 0 4-1.5-1-1.5-3 0-4Z" />
    </svg>
  );
}

export function FaucetIcon(p: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base} {...p}>
      <path d="M4 10h6V7a2 2 0 0 1 2-2h4a3 3 0 0 1 3 3M10 10v3a3 3 0 0 0 3 3M4 10v3h6" />
      <path d="M13 16v4" />
    </svg>
  );
}

export function PipeIcon(p: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base} {...p}>
      <path d="M4 8h5V5M4 8v3a3 3 0 0 0 3 3h6a3 3 0 0 1 3 3v3M20 5h-4" />
      <rect x="2.5" y="6" width="3" height="4" rx="1" />
      <rect x="18.5" y="17" width="3" height="4" rx="1" />
    </svg>
  );
}

export function WrenchIcon(p: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base} {...p}>
      <path d="M15 6a3.5 3.5 0 0 0-4.6 4.3l-5.1 5.1a1.5 1.5 0 0 0 2.1 2.1l5.1-5.1A3.5 3.5 0 0 0 18 8l-2 2-2-2 1-2Z" />
    </svg>
  );
}

export function BoltIcon(p: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base} {...p}>
      <path d="M13 2 4 14h6l-1 8 9-12h-6l1-8Z" />
    </svg>
  );
}

export function PhoneIcon(p: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base} {...p}>
      <path d="M4 5c0 8 7 15 15 15l-.5-3.5-4-1-1.8 1.8a12 12 0 0 1-4.8-4.8L9.7 9.5l-1-4L5 5Z" />
    </svg>
  );
}

export function ClockIcon(p: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base} {...p}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </svg>
  );
}

export function CheckIcon(p: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base} {...p}>
      <path d="m5 13 4 4L19 7" />
    </svg>
  );
}

export function AlertIcon(p: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base} {...p}>
      <path d="M12 3 2 20h20L12 3ZM12 10v4M12 17h.01" />
    </svg>
  );
}

export function ShieldIcon(p: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base} {...p}>
      <path d="M12 3l7 3v5c0 4.5-3 8-7 10-4-2-7-5.5-7-10V6l7-3Z" />
      <path d="m9 12 2 2 4-4" />
    </svg>
  );
}

export function CalendarIcon(p: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base} {...p}>
      <rect x="4" y="5" width="16" height="16" rx="2" />
      <path d="M4 9h16M8 3v4M16 3v4" />
    </svg>
  );
}
