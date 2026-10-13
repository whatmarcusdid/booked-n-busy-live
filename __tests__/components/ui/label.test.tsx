import React from "react"
import { render, screen } from "@testing-library/react"
import "@testing-library/jest-dom"
import { Label } from "@/components/ui/label"

describe("Label", () => {
  it("renders label element", () => {
    render(<Label htmlFor="test-input">Test Label</Label>)
    const label = screen.getByText("Test Label")
    expect(label).toBeInTheDocument()
    expect(label).toHaveAttribute("for", "test-input")
  })

  it("applies custom className", () => {
    render(<Label className="custom-class">Label</Label>)
    const label = screen.getByText("Label")
    expect(label).toHaveClass("custom-class")
  })

  it("uses typography tokens", () => {
    render(<Label>Label</Label>)
    const label = screen.getByText("Label")
    expect(label).toHaveClass("font-[family-name:var(--typography-label-family)]")
    expect(label).toHaveClass("text-[length:var(--typography-label-size)]")
  })
})
