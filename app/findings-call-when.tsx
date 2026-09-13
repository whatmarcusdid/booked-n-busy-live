"use client";

import { useSyncExternalStore } from "react";
import {
  formatFindingsCallWhen,
  resolveFindingsCallTimeZone,
} from "@/lib/copy/findings-call-booked";

function subscribe() {
  return () => {};
}

function browserTimeZone(): string | null {
  return resolveFindingsCallTimeZone(
    Intl.DateTimeFormat().resolvedOptions().timeZone,
  );
}

function useViewerTimeZone(): string | null {
  return useSyncExternalStore(subscribe, browserTimeZone, () => null);
}

/**
 * Formats the meeting instant in the viewer's browser timezone.
 * Server HTML is an empty `<time>` so we never paint a hardcoded zone
 * (including Eastern) before the client can read Intl.
 */
export function FindingsCallWhen({
  startIso,
  endIso,
  timeZone,
}: {
  startIso: string;
  endIso: string;
  timeZone?: string;
}) {
  const viewerZone = useViewerTimeZone();
  const zone = resolveFindingsCallTimeZone(timeZone) ?? viewerZone;
  const label = zone ? formatFindingsCallWhen(startIso, endIso, zone) : "";

  return (
    <h2 className="findings-call-booked-when">
      <time dateTime={startIso} data-timezone={zone ?? undefined}>
        {label}
      </time>
    </h2>
  );
}
