import React from "react"
import { render, screen } from "@testing-library/react"
import "@testing-library/jest-dom"
import { Logo } from "@/components/ui/logo"

describe("Logo", () => {
  it("renders primary logo by default", () => {
    render(<Logo />)
    const logo = screen.getByRole("img", { name: /book service/i })
    expect(logo).toBeInTheDocument()
  })

  it("renders primary variant explicitly", () => {
    render(<Logo variant="primary" />)
    const logo = screen.getByRole("img", { name: /book service/i })
    expect(logo).toBeInTheDocument()
    expect(logo).toHaveAttribute("viewBox", "0 0 266 32")
  })

  it("renders secondary variant", () => {
    render(<Logo variant="secondary" />)
    const logo = screen.getByRole("img", { name: /book service/i })
    expect(logo).toBeInTheDocument()
    expect(logo).toHaveAttribute("viewBox", "0 0 210.737 80.7478")
  })

  it("renders secondary-tagline variant with text", () => {
    render(<Logo variant="secondary-tagline" />)
    const logo = screen.getByRole("img", { name: /book service/i })
    expect(logo).toBeInTheDocument()
    expect(screen.getByText(/finally, my website is working/i)).toBeInTheDocument()
  })

  it("renders mark variant", () => {
    render(<Logo variant="mark" />)
    const logo = screen.getByRole("img", { name: /book service/i })
    expect(logo).toBeInTheDocument()
    expect(logo).toHaveAttribute("viewBox", "0 0 100 100")
  })

  it("renders with small size", () => {
    render(<Logo size="sm" data-testid="logo-sm" />)
    const container = screen.getByTestId("logo-sm")
    expect(container).toHaveClass("h-[24px]")
  })

  it("renders with medium size", () => {
    render(<Logo size="md" data-testid="logo-md" />)
    const container = screen.getByTestId("logo-md")
    expect(container).toHaveClass("h-[32px]")
  })

  it("renders with large size", () => {
    render(<Logo size="lg" data-testid="logo-lg" />)
    const container = screen.getByTestId("logo-lg")
    expect(container).toHaveClass("h-[48px]")
  })

  it("applies custom className", () => {
    render(<Logo className="custom-class" data-testid="logo" />)
    const logo = screen.getByTestId("logo")
    expect(logo).toHaveClass("custom-class")
  })

  it("forwards ref correctly", () => {
    const ref = React.createRef<HTMLDivElement>()
    render(<Logo ref={ref} />)
    expect(ref.current).toBeInstanceOf(HTMLDivElement)
  })

  it("uses CSS var for secondary color in primary variant", () => {
    render(<Logo variant="primary" />)
    const logo = screen.getByRole("img", { name: /book service/i })
    const paths = logo.querySelectorAll("path")
    const markPath = paths[0]
    expect(markPath).toHaveAttribute("fill", "var(--color-brand-secondary)")
  })

  it("uses CSS var for text-on-primary in primary variant", () => {
    render(<Logo variant="primary" />)
    const logo = screen.getByRole("img", { name: /book service/i })
    const paths = logo.querySelectorAll("path")
    const textPaths = Array.from(paths).slice(1)
    textPaths.forEach((path) => {
      expect(path).toHaveAttribute("fill", "var(--color-text-on-primary)")
    })
  })

  it("uses CSS var in mark variant", () => {
    render(<Logo variant="mark" />)
    const logo = screen.getByRole("img", { name: /book service/i })
    const path = logo.querySelector("path")
    expect(path).toHaveAttribute("fill", "var(--color-brand-secondary)")
  })

  it("tagline uses typography tokens", () => {
    render(<Logo variant="secondary-tagline" />)
    const tagline = screen.getByText(/finally, my website is working/i)
    expect(tagline).toHaveClass("font-[family-name:var(--typography-tagline-family)]")
    expect(tagline).toHaveClass("text-[length:var(--typography-tagline-size)]")
    expect(tagline).toHaveClass("font-[number:var(--typography-tagline-weight)]")
  })
})
