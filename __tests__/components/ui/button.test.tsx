import React from "react"
import { render, screen } from "@testing-library/react"
import "@testing-library/jest-dom"
import { Button } from "@/components/ui/button"

describe("Button", () => {
  it("renders primary button", () => {
    render(<Button variant="primary">Click me</Button>)
    const button = screen.getByRole("button", { name: /click me/i })
    expect(button).toBeInTheDocument()
    expect(button).toHaveClass("bg-[var(--component-button-primary-bg)]")
  })

  it("renders secondary button", () => {
    render(<Button variant="secondary">Click me</Button>)
    const button = screen.getByRole("button", { name: /click me/i })
    expect(button).toBeInTheDocument()
    expect(button).toHaveClass("border-[var(--component-button-secondary-border)]")
  })

  it("renders secondary-on-dark button", () => {
    render(<Button variant="secondary-on-dark">Click me</Button>)
    const button = screen.getByRole("button", { name: /click me/i })
    expect(button).toBeInTheDocument()
    expect(button).toHaveClass("border-[var(--component-button-secondary-on-dark-border)]")
  })

  it("renders disabled button", () => {
    render(<Button disabled>Click me</Button>)
    const button = screen.getByRole("button", { name: /click me/i })
    expect(button).toBeDisabled()
  })

  it("renders loading button", () => {
    render(<Button loading>Click me</Button>)
    const button = screen.getByRole("button")
    expect(button).toBeDisabled()
    const loader = button.querySelector("svg")
    expect(loader).toBeInTheDocument()
  })

  it("renders button with different sizes", () => {
    const { rerender } = render(<Button size="sm">Small</Button>)
    expect(screen.getByRole("button")).toHaveClass("h-[var(--size-control-sm)]")

    rerender(<Button size="default">Default</Button>)
    expect(screen.getByRole("button")).toHaveClass("h-[var(--component-button-shared-height)]")

    rerender(<Button size="lg">Large</Button>)
    expect(screen.getByRole("button")).toHaveClass("h-[var(--size-control-lg)]")
  })

  it("applies custom className", () => {
    render(<Button className="custom-class">Click me</Button>)
    const button = screen.getByRole("button", { name: /click me/i })
    expect(button).toHaveClass("custom-class")
  })

  it("handles onClick", () => {
    const handleClick = jest.fn()
    render(<Button onClick={handleClick}>Click me</Button>)
    const button = screen.getByRole("button", { name: /click me/i })
    button.click()
    expect(handleClick).toHaveBeenCalledTimes(1)
  })

  it("disabled button does not trigger onClick", () => {
    const handleClick = jest.fn()
    render(
      <Button disabled onClick={handleClick}>
        Click me
      </Button>
    )
    const button = screen.getByRole("button", { name: /click me/i })
    button.click()
    expect(handleClick).not.toHaveBeenCalled()
  })

  it("loading button does not trigger onClick", () => {
    const handleClick = jest.fn()
    render(
      <Button loading onClick={handleClick}>
        Click me
      </Button>
    )
    const button = screen.getByRole("button")
    button.click()
    expect(handleClick).not.toHaveBeenCalled()
  })
})
