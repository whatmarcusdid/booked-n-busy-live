import * as React from "react"

import { cn } from "@/lib/utils"

export interface LogoProps extends React.HTMLAttributes<HTMLDivElement> {
  size?: "sm" | "lg"
}

const Logo = React.forwardRef<HTMLDivElement, LogoProps>(
  ({ className, size = "sm", ...props }, ref) => {
    const sizeValue = size === "sm" ? "var(--size-logo-mark-sm)" : "var(--size-logo-mark-lg)"
    
    return (
      <div
        ref={ref}
        className={cn("inline-flex items-center", className)}
        style={{ width: sizeValue, height: sizeValue }}
        {...props}
      >
        <svg
          viewBox="0 0 48 48"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          className="w-full h-full"
          aria-label="Book Service"
        >
          <circle cx="24" cy="24" r="24" fill="var(--color-brand-primary)" />
          <path
            d="M24 12L32 20L24 28L16 20L24 12Z"
            fill="var(--color-text-on-primary)"
          />
          <path
            d="M24 20L32 28L24 36L16 28L24 20Z"
            fill="var(--color-text-on-primary)"
            opacity="0.6"
          />
        </svg>
      </div>
    )
  }
)
Logo.displayName = "Logo"

export { Logo }
