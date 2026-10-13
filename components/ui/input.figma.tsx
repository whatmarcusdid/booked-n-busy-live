import figma from "@figma/code-connect"
import { Input } from "./input"

figma.connect(
  Input,
  "https://www.figma.com/design/DqJfGSlaDK0EcqcBuMcftL/Ring-1?node-id=155-65",
  {
    props: {
      placeholder: figma.textContent("Placeholder"),
      disabled: figma.boolean("State", {
        true: "disabled",
        false: "default",
      }),
      error: figma.boolean("State", {
        true: "error",
        false: "default",
      }),
    },
    example: ({ placeholder, disabled, error }) => (
      <Input placeholder={placeholder} disabled={disabled} error={error} />
    ),
  }
)
