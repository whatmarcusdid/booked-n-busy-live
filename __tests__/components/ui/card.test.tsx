import React from "react"
import { render, screen } from "@testing-library/react"
import "@testing-library/jest-dom"
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
} from "@/components/ui/card"

describe("Card", () => {
  it("renders card component", () => {
    render(
      <Card data-testid="card">
        <CardContent>Card content</CardContent>
      </Card>
    )
    const card = screen.getByTestId("card")
    expect(card).toBeInTheDocument()
    expect(card).toHaveClass("bg-[var(--color-bg-surface)]")
    expect(card).toHaveClass("rounded-[var(--radius-lg)]")
    expect(card).toHaveClass("shadow-[var(--shadow-card)]")
  })

  it("renders card with header", () => {
    render(
      <Card>
        <CardHeader>
          <CardTitle>Card Title</CardTitle>
          <CardDescription>Card description</CardDescription>
        </CardHeader>
      </Card>
    )
    expect(screen.getByText("Card Title")).toBeInTheDocument()
    expect(screen.getByText("Card description")).toBeInTheDocument()
  })

  it("renders card with content", () => {
    render(
      <Card>
        <CardContent>This is card content</CardContent>
      </Card>
    )
    expect(screen.getByText("This is card content")).toBeInTheDocument()
  })

  it("renders card with footer", () => {
    render(
      <Card>
        <CardFooter>Footer content</CardFooter>
      </Card>
    )
    expect(screen.getByText("Footer content")).toBeInTheDocument()
  })

  it("renders complete card structure", () => {
    render(
      <Card>
        <CardHeader>
          <CardTitle>Title</CardTitle>
          <CardDescription>Description</CardDescription>
        </CardHeader>
        <CardContent>Content</CardContent>
        <CardFooter>Footer</CardFooter>
      </Card>
    )
    expect(screen.getByText("Title")).toBeInTheDocument()
    expect(screen.getByText("Description")).toBeInTheDocument()
    expect(screen.getByText("Content")).toBeInTheDocument()
    expect(screen.getByText("Footer")).toBeInTheDocument()
  })

  it("applies custom className to card", () => {
    render(
      <Card className="custom-class" data-testid="card">
        <CardContent>Content</CardContent>
      </Card>
    )
    const card = screen.getByTestId("card")
    expect(card).toHaveClass("custom-class")
  })
})
