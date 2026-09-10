"use client";

import type { ComponentPropsWithoutRef, ReactNode } from "react";
import { useMaterialWeb } from "./use-material-web";

type Props = ComponentPropsWithoutRef<"md-filled-button"> & {
  children?: ReactNode;
};

export function MdFilledButton({ children, ...props }: Props) {
  useMaterialWeb();
  return <md-filled-button {...props}>{children}</md-filled-button>;
}
