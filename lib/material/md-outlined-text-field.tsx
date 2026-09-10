"use client";

import type { ComponentPropsWithoutRef } from "react";
import { useMaterialWeb } from "./use-material-web";

type Props = ComponentPropsWithoutRef<"md-outlined-text-field">;

export function MdOutlinedTextField(props: Props) {
  useMaterialWeb();
  return <md-outlined-text-field {...props} />;
}
