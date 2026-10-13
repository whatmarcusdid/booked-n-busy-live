import * as React from "react"

import { cn } from "@/lib/utils"

const Eyebrow = React.forwardRef<
  HTMLParagraphElement,
  React.HTMLAttributes<HTMLParagraphElement>
>(({ className, ...props }, ref) => (
  <p
    ref={ref}
    className={cn(
      "font-[family-name:var(--typography-label-family)] text-[length:var(--typography-label-size)] font-[number:var(--typography-label-weight)] leading-[var(--typography-label-line-height)] tracking-[0.12em] uppercase text-[var(--color-brand-secondary)]",
      className
    )}
    {...props}
  />
))
Eyebrow.displayName = "Eyebrow"

export { Eyebrow }
