"use client";

import {
  MdCard,
  MdFilledButton,
  MdOutlinedButton,
  MdOutlinedTextField,
} from "@/lib/material";

export function MaterialSetupDemo() {
  return (
    <MdCard>
      <p>Material Web setup check</p>
      <MdOutlinedTextField label="Sample field" name="sample" />
      <MdFilledButton type="button">Filled</MdFilledButton>
      <MdOutlinedButton type="button">Outlined</MdOutlinedButton>
    </MdCard>
  );
}
