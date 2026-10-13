import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"
import { Loader2 } from "lucide-react"

import { cn } from "@/lib/utils"

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap transition-colors focus-visible:outline-none disabled:pointer-events-none disabled:cursor-not-allowed font-sans",
  {
    variants: {
      variant: {
        primary:
          "bg-[var(--component-button-primary-bg)] text-[var(--component-button-primary-text)] hover:bg-[var(--component-button-primary-bg-hover)] focus-visible:ring-[length:var(--component-focus-ring-width)] focus-visible:ring-[var(--component-focus-ring-color)] focus-visible:ring-offset-[length:var(--component-focus-ring-offset)] disabled:bg-[var(--component-button-primary-bg-disabled)] disabled:text-[var(--component-button-primary-text-disabled)]",
        secondary:
          "border-[length:var(--component-button-shared-border-width)] border-[var(--component-button-secondary-border)] text-[var(--component-button-secondary-text)] bg-transparent hover:border-[var(--component-button-secondary-border-hover)] hover:text-[var(--component-button-secondary-text-hover)] focus-visible:ring-[length:var(--component-focus-ring-width)] focus-visible:ring-[var(--component-focus-ring-color)] focus-visible:ring-offset-[length:var(--component-focus-ring-offset)] disabled:border-[var(--component-button-secondary-border-disabled)] disabled:text-[var(--component-button-secondary-text-disabled)]",
        "secondary-on-dark":
          "border-[length:var(--component-button-shared-border-width)] border-[var(--component-button-secondary-on-dark-border)] text-[var(--component-button-secondary-on-dark-text)] bg-transparent hover:border-[var(--component-button-secondary-on-dark-border-hover)] hover:text-[var(--component-button-secondary-on-dark-text-hover)] focus-visible:ring-[length:var(--component-focus-ring-width)] focus-visible:ring-[var(--component-focus-ring-color-on-dark)] focus-visible:ring-offset-[length:var(--component-focus-ring-offset)] disabled:border-[var(--component-button-secondary-border-disabled)] disabled:text-[var(--component-button-secondary-text-disabled)]",
      },
      size: {
        default: "h-[var(--component-button-shared-height)] px-[var(--component-button-shared-padding-x)] py-[var(--component-button-shared-padding-y)] rounded-[var(--component-button-shared-radius)]",
        sm: "h-[var(--size-control-sm)] px-[var(--space-16)] py-[var(--space-6)] rounded-[var(--radius-md)]",
        lg: "h-[var(--size-control-lg)] px-[var(--space-32)] py-[var(--space-12)] rounded-[var(--radius-lg)]",
      },
    },
    defaultVariants: {
      variant: "primary",
      size: "default",
    },
  }
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean
  loading?: boolean
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, loading = false, disabled, children, ...props }, ref) => {
    const Comp = asChild ? Slot : "button"
    const isDisabled = disabled || loading

    return (
      <Comp
        className={cn(
          buttonVariants({ variant, size, className }),
          "font-[family-name:var(--typography-body-md-bold-family)] text-[length:var(--typography-body-md-bold-size)] font-[number:var(--typography-body-md-bold-weight)] leading-[var(--typography-body-md-bold-line-height)]"
        )}
        ref={ref}
        disabled={isDisabled}
        {...props}
      >
        {loading && <Loader2 className="h-4 w-4 animate-spin" />}
        {children}
      </Comp>
    )
  }
)
Button.displayName = "Button"

export { Button, buttonVariants }
