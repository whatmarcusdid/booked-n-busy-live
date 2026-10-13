import * as React from "react"

import { cn } from "@/lib/utils"

export interface InputProps
  extends React.InputHTMLAttributes<HTMLInputElement> {
  error?: boolean
}

const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, error, ...props }, ref) => {
    return (
      <input
        type={type}
        className={cn(
          "flex w-full bg-[var(--component-input-bg)] text-[var(--component-input-text)] border-[length:var(--component-input-border-width)] border-[var(--component-input-border)] rounded-[var(--component-input-radius)] h-[var(--component-input-height)] px-[var(--component-input-padding-x)] py-[var(--component-input-padding-y)]",
          "font-[family-name:var(--typography-body-sm-family)] text-[length:var(--typography-body-sm-size)] font-[number:var(--typography-body-sm-weight)] leading-[var(--typography-body-sm-line-height)] tracking-[var(--typography-body-sm-letter-spacing)]",
          "placeholder:text-[var(--component-input-placeholder)]",
          "focus-visible:outline-none focus-visible:border-[var(--component-input-border-focus)] focus-visible:ring-[length:var(--component-focus-ring-width)] focus-visible:ring-[var(--component-focus-ring-color)] focus-visible:ring-offset-[length:var(--component-focus-ring-offset)]",
          "disabled:bg-[var(--component-input-bg-disabled)] disabled:cursor-not-allowed disabled:opacity-50",
          "transition-colors",
          error && "border-[var(--component-input-border-error)] focus-visible:ring-[var(--component-input-border-error)]",
          className
        )}
        ref={ref}
        aria-invalid={error ? "true" : undefined}
        {...props}
      />
    )
  }
)
Input.displayName = "Input"

export { Input }
