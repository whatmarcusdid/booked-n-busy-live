"use client";

import type { ReactNode } from "react";
import { useMaterialWeb } from "./use-material-web";

/**
 * Token-backed surface using official <md-elevation>.
 * @material/web does not ship a stable card custom element.
 */
export function MdCard({ children }: { children?: ReactNode }) {
  useMaterialWeb();
  return (
    <div className="md-card">
      <md-elevation />
      {children}
    </div>
  );
}
