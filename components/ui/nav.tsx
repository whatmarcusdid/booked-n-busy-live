import * as React from "react"

import { cn } from "@/lib/utils"

const Nav = React.forwardRef<
  HTMLElement,
  React.HTMLAttributes<HTMLElement> & {
    variant?: "light" | "dark"
  }
>(({ className, variant = "light", ...props }, ref) => (
  <nav
    ref={ref}
    className={cn(
      "h-[var(--component-nav-height)] flex items-center",
      variant === "light"
        ? "bg-[var(--color-bg-nav)] text-[var(--color-text-strong)]"
        : "bg-transparent text-[var(--color-text-on-dark)]",
      className
    )}
    {...props}
  />
))
Nav.displayName = "Nav"

const NavItem = React.forwardRef<
  HTMLAnchorElement,
  React.AnchorHTMLAttributes<HTMLAnchorElement>
>(({ className, ...props }, ref) => (
  <a
    ref={ref}
    className={cn(
      "inline-flex items-center justify-center rounded-[var(--radius-md)] px-[var(--space-12)] py-[var(--space-8)]",
      "font-[family-name:var(--typography-body-md-family)] text-[length:var(--typography-body-md-size)] font-[number:var(--typography-body-md-weight)] leading-[var(--typography-body-md-line-height)]",
      "transition-colors hover:bg-[var(--color-bg-canvas)]",
      "focus-visible:outline-none focus-visible:ring-[length:var(--component-focus-ring-width)] focus-visible:ring-[var(--component-focus-ring-color)] focus-visible:ring-offset-[length:var(--component-focus-ring-offset)]",
      className
    )}
    {...props}
  />
))
NavItem.displayName = "NavItem"

const NavContainer = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn(
      "container mx-auto flex items-center justify-between px-[var(--space-24)]",
      className
    )}
    {...props}
  />
))
NavContainer.displayName = "NavContainer"

export { Nav, NavItem, NavContainer }
