import figma from "@figma/code-connect"
import { Eyebrow } from "./eyebrow"

figma.connect(
  Eyebrow,
  "https://www.figma.com/design/DqJfGSlaDK0EcqcBuMcftL/Ring-1?node-id=155-63",
  {
    props: {
      children: figma.textContent("Text"),
    },
    example: ({ children }) => <Eyebrow>{children}</Eyebrow>,
  }
)
