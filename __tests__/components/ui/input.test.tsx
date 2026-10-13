import React from "react"
import { render, screen } from "@testing-library/react"
import "@testing-library/jest-dom"
import { Input } from "@/components/ui/input"

describe("Input", () => {
  it("renders input element", () => {
    render(<Input placeholder="Enter text" />)
    const input = screen.getByPlaceholderText("Enter text")
    expect(input).toBeInTheDocument()
  })

  it("renders with error state", () => {
    render(<Input error placeholder="Enter text" />)
    const input = screen.getByPlaceholderText("Enter text")
    expect(input).toHaveClass("border-[var(--component-input-border-error)]")
    expect(input).toHaveAttribute("aria-invalid", "true")
  })

  it("renders without aria-invalid when no error", () => {
    render(<Input placeholder="Enter text" />)
    const input = screen.getByPlaceholderText("Enter text")
    expect(input).not.toHaveAttribute("aria-invalid")
  })

  it("renders disabled input", () => {
    render(<Input disabled placeholder="Enter text" />)
    const input = screen.getByPlaceholderText("Enter text")
    expect(input).toBeDisabled()
  })

  it("applies custom className", () => {
    render(<Input className="custom-class" placeholder="Enter text" />)
    const input = screen.getByPlaceholderText("Enter text")
    expect(input).toHaveClass("custom-class")
  })

  it("handles different input types", () => {
    const { rerender } = render(<Input type="email" placeholder="Email" />)
    expect(screen.getByPlaceholderText("Email")).toHaveAttribute("type", "email")

    rerender(<Input type="password" placeholder="Password" />)
    expect(screen.getByPlaceholderText("Password")).toHaveAttribute("type", "password")

    rerender(<Input type="text" placeholder="Text" />)
    expect(screen.getByPlaceholderText("Text")).toHaveAttribute("type", "text")
  })

  it("forwards ref correctly", () => {
    const ref = React.createRef<HTMLInputElement>()
    render(<Input ref={ref} placeholder="Enter text" />)
    expect(ref.current).toBeInstanceOf(HTMLInputElement)
  })
})
