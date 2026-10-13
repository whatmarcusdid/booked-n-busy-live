import React from "react"
import { render, screen } from "@testing-library/react"
import "@testing-library/jest-dom"
import { FormHelperText } from "@/components/ui/form-helper-text"

describe("FormHelperText", () => {
  it("renders helper text", () => {
    render(<FormHelperText>This is helper text</FormHelperText>)
    const helperText = screen.getByText("This is helper text")
    expect(helperText).toBeInTheDocument()
  })

  it("renders in default state", () => {
    render(<FormHelperText>Helper text</FormHelperText>)
    const helperText = screen.getByText("Helper text")
    expect(helperText).toHaveClass("text-[var(--color-text-muted)]")
  })

  it("renders in error state", () => {
    render(<FormHelperText error>Error text</FormHelperText>)
    const helperText = screen.getByText("Error text")
    expect(helperText).toHaveClass("text-[var(--color-feedback-error)]")
  })

  it("applies custom className", () => {
    render(<FormHelperText className="custom-class">Helper text</FormHelperText>)
    const helperText = screen.getByText("Helper text")
    expect(helperText).toHaveClass("custom-class")
  })

  it("forwards ref correctly", () => {
    const ref = React.createRef<HTMLParagraphElement>()
    render(<FormHelperText ref={ref}>Helper text</FormHelperText>)
    expect(ref.current).toBeInstanceOf(HTMLParagraphElement)
  })
})
