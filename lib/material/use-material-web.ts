"use client";

import { useEffect } from "react";
import { registerMaterialWeb } from "./register";

let pending: Promise<void> | null = null;

function ensureRegistered() {
  pending ??= registerMaterialWeb();
  return pending;
}

/**
 * Registers the small @material/web set after mount so Lit never evaluates
 * during Next.js App Router SSR of this Client Component.
 */
export function useMaterialWeb() {
  useEffect(() => {
    void ensureRegistered();
  }, []);
}
