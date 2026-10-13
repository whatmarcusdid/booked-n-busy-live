import figma from "@figma/code-connect"
import { Logo } from "./logo"

figma.connect(
  Logo,
  "https://www.figma.com/design/DqJfGSlaDK0EcqcBuMcftL/Ring-1?node-id=155-6",
  {
    props: {
      variant: figma.enum("Variant", {
        primary: "primary",
        secondary: "secondary",
        "secondary-tagline": "secondary-tagline",
        mark: "mark",
      }),
    },
    example: ({ variant }) => <Logo variant={variant} />,
  }
)
