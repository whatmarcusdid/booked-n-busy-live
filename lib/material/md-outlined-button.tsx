"use client";

import type { ComponentPropsWithoutRef, ReactNode } from "react";
import { useMaterialWeb } from "./use-material-web";

type Props = ComponentPropsWithoutRef<"md-outlined-button"> & {
  children?: ReactNode;
};

export function MdOutlinedButton({ children, ...props }: Props) {
  useMaterialWeb();
  return <md-outlined-button {...props}>{children}</md-outlined-button>;
}
