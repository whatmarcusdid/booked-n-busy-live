import figma from "@figma/code-connect"
import { Button } from "./button"

figma.connect(
  Button,
  "https://www.figma.com/design/DqJfGSlaDK0EcqcBuMcftL/Ring-1?node-id=153-7",
  {
    props: {
      variant: figma.enum("Variant", {
        primary: "primary",
        secondary: "secondary",
        "secondary-on-dark": "secondary-on-dark",
      }),
      size: figma.enum("Size", {
        default: "default",
        sm: "sm",
        lg: "lg",
      }),
      disabled: figma.enum("State", {
        disabled: true,
      }),
      loading: figma.enum("State", {
        loading: true,
      }),
      children: figma.textContent("Label"),
    },
    example: ({ variant, size, disabled, loading, children }) => (
      <Button
        variant={variant}
        size={size}
        disabled={disabled}
        loading={loading}
      >
        {children}
      </Button>
    ),
  }
)
