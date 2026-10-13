import figma from "@figma/code-connect"
import { Label } from "./label"

figma.connect(
  Label,
  "https://www.figma.com/design/DqJfGSlaDK0EcqcBuMcftL/Ring-1?node-id=155-6",
  {
    props: {
      children: figma.textContent("Label"),
    },
    example: ({ children }) => <Label>{children}</Label>,
  }
)
