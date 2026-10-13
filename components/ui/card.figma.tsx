import figma from "@figma/code-connect"
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "./card"

figma.connect(
  Card,
  "https://www.figma.com/design/DqJfGSlaDK0EcqcBuMcftL/Ring-1?node-id=156-6",
  {
    props: {
      title: figma.textContent("Title"),
      description: figma.textContent("Description"),
    },
    example: ({ title, description }) => (
      <Card>
        <CardHeader>
          <CardTitle>{title}</CardTitle>
          <CardDescription>{description}</CardDescription>
        </CardHeader>
        <CardContent>Content goes here</CardContent>
      </Card>
    ),
  }
)
