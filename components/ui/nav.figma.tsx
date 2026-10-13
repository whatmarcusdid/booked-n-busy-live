import figma from "@figma/code-connect"
import { Nav, NavContainer, NavItem } from "./nav"

figma.connect(
  Nav,
  "https://www.figma.com/design/DqJfGSlaDK0EcqcBuMcftL/Ring-1?node-id=156-15",
  {
    props: {
      variant: figma.enum("Variant", {
        light: "light",
        dark: "dark",
      }),
    },
    example: ({ variant }) => (
      <Nav variant={variant}>
        <NavContainer>
          <NavItem href="/">Home</NavItem>
          <NavItem href="/about">About</NavItem>
        </NavContainer>
      </Nav>
    ),
  }
)
