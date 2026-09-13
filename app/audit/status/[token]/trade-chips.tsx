"use client";

import { useState } from "react";
import {
  SERVICE_MIX_CHIPS,
  SERVICE_MIX_HEADING,
  SERVICE_MIX_QUESTION,
  type ServiceMixSelectionId,
} from "@/lib/copy/audit-service-mix";

/**
 * Optional wait-screen trade chips. Selecting a chip POSTs the mapped
 * service-mix fields for this status token. No Submit, no Skip.
 */
export function TradeChips({ token }: { token: string }) {
  const [selected, setSelected] = useState<ServiceMixSelectionId | null>(null);

  function onSelect(id: ServiceMixSelectionId) {
    setSelected(id);
    void fetch(`/api/v1/audits/${token}/service-mix`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ selection: id }),
    });
  }

  return (
    <section
      className="audit-loading-section audit-loading-service-mix"
      data-testid="service-mix"
    >
      <h2 className="audit-loading-section-heading">{SERVICE_MIX_HEADING}</h2>
      <p className="audit-loading-service-mix-question" id="service-mix-question">
        {SERVICE_MIX_QUESTION}
      </p>
      <div
        className="audit-loading-chips"
        role="radiogroup"
        aria-labelledby="service-mix-question"
      >
        {SERVICE_MIX_CHIPS.map((chip) => {
          const isSelected = selected === chip.id;
          return (
            <button
              key={chip.id}
              type="button"
              role="radio"
              aria-checked={isSelected}
              className={
                isSelected
                  ? "audit-loading-chip is-selected"
                  : "audit-loading-chip"
              }
              onClick={() => onSelect(chip.id)}
            >
              {chip.label}
            </button>
          );
        })}
      </div>
    </section>
  );
}
