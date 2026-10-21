import figma from "@figma/code-connect"
import { Input } from "./input"

figma.connect(
  Input,
  "https://www.figma.com/design/DqJfGSlaDK0EcqcBuMcftL/Ring-1?node-id=155-65",
  {
    props: {
      placeholder: figma.textContent("Placeholder"),
      disabled: figma.enum("State", {
        disabled: true,
      }),
      error: figma.enum("State", {
        error: true,
      }),
    },
    example: ({ placeholder, disabled, error }) => (
      <Input placeholder={placeholder} disabled={disabled} error={error} />
    ),
  }
)
