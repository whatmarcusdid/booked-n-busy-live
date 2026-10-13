import * as React from "react"

import { cn } from "@/lib/utils"

export interface FormHelperTextProps
  extends React.HTMLAttributes<HTMLParagraphElement> {
  error?: boolean
}

const FormHelperText = React.forwardRef<HTMLParagraphElement, FormHelperTextProps>(
  ({ className, error, ...props }, ref) => {
    return (
      <p
        ref={ref}
        className={cn(
          "font-[family-name:var(--typography-body-sm-family)] text-[length:var(--typography-body-sm-size)] font-[number:var(--typography-body-sm-weight)] leading-[var(--typography-body-sm-line-height)] tracking-[var(--typography-body-sm-letter-spacing)]",
          "mt-[var(--component-input-label-gap)]",
          error ? "text-[var(--color-feedback-error)]" : "text-[var(--color-text-muted)]",
          className
        )}
        {...props}
      />
    )
  }
)
FormHelperText.displayName = "FormHelperText"

export { FormHelperText }
