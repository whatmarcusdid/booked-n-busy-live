"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { FormHelperText } from "@/components/ui/form-helper-text"
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
} from "@/components/ui/card"
import { Nav, NavContainer, NavItem } from "@/components/ui/nav"
import { Eyebrow } from "@/components/ui/eyebrow"
import { Logo } from "@/components/ui/logo"

export default function DesignSystemPage() {
  const [loading, setLoading] = useState(false)

  const handleLoadingDemo = () => {
    setLoading(true)
    setTimeout(() => setLoading(false), 2000)
  }

  return (
    <div className="min-h-screen bg-[var(--color-bg-canvas)]">
      <div className="max-w-7xl mx-auto p-[var(--space-48)] space-y-[var(--space-64)]">
        <div>
          <h1 className="font-[family-name:var(--typography-display-xl-family)] text-[length:var(--typography-display-xl-size)] font-[number:var(--typography-display-xl-weight)] leading-[var(--typography-display-xl-line-height)] tracking-[var(--typography-display-xl-letter-spacing)] text-[var(--color-text-strong)] mb-[var(--space-16)]">
            Design System Components
          </h1>
          <p className="font-[family-name:var(--typography-body-lg-family)] text-[length:var(--typography-body-lg-size)] font-[number:var(--typography-body-lg-weight)] leading-[var(--typography-body-lg-line-height)] text-[var(--color-text-muted)]">
            Preview of all UI components using design tokens
          </p>
        </div>

        <section>
          <h2 className="font-[family-name:var(--typography-display-sm-family)] text-[length:var(--typography-display-sm-size)] font-[number:var(--typography-display-sm-weight)] leading-[var(--typography-display-sm-line-height)] tracking-[var(--typography-display-sm-letter-spacing)] text-[var(--color-text-strong)] mb-[var(--space-24)]">
            Buttons
          </h2>

          <div className="space-y-[var(--space-32)]">
            <div>
              <h3 className="font-[family-name:var(--typography-body-md-bold-family)] text-[length:var(--typography-body-md-bold-size)] font-[number:var(--typography-body-md-bold-weight)] mb-[var(--space-16)] text-[var(--color-text-strong)]">
                Primary Buttons
              </h3>
              <div className="flex flex-wrap gap-[var(--space-16)] items-center">
                <Button variant="primary">Default</Button>
                <Button variant="primary" disabled>
                  Disabled
                </Button>
                <Button variant="primary" loading={loading} onClick={handleLoadingDemo}>
                  {loading ? "Loading..." : "Click for Loading"}
                </Button>
              </div>
            </div>

            <div>
              <h3 className="font-[family-name:var(--typography-body-md-bold-family)] text-[length:var(--typography-body-md-bold-size)] font-[number:var(--typography-body-md-bold-weight)] mb-[var(--space-16)] text-[var(--color-text-strong)]">
                Secondary Buttons (Light Surface)
              </h3>
              <div className="flex flex-wrap gap-[var(--space-16)] items-center">
                <Button variant="secondary">Default</Button>
                <Button variant="secondary" disabled>
                  Disabled
                </Button>
                <Button variant="secondary" loading>
                  Loading
                </Button>
              </div>
            </div>

            <div className="bg-[var(--color-bg-dark)] p-[var(--space-24)] rounded-[var(--radius-lg)]">
              <h3 className="font-[family-name:var(--typography-body-md-bold-family)] text-[length:var(--typography-body-md-bold-size)] font-[number:var(--typography-body-md-bold-weight)] mb-[var(--space-16)] text-[var(--color-text-on-dark)]">
                Secondary Buttons (Dark Surface)
              </h3>
              <div className="flex flex-wrap gap-[var(--space-16)] items-center">
                <Button variant="secondary-on-dark">Default</Button>
                <Button variant="secondary-on-dark" disabled>
                  Disabled
                </Button>
                <Button variant="secondary-on-dark" loading>
                  Loading
                </Button>
              </div>
            </div>

            <div>
              <h3 className="font-[family-name:var(--typography-body-md-bold-family)] text-[length:var(--typography-body-md-bold-size)] font-[number:var(--typography-body-md-bold-weight)] mb-[var(--space-16)] text-[var(--color-text-strong)]">
                Button Sizes
              </h3>
              <div className="flex flex-wrap gap-[var(--space-16)] items-end">
                <Button variant="primary" size="sm">
                  Small
                </Button>
                <Button variant="primary" size="default">
                  Default
                </Button>
                <Button variant="primary" size="lg">
                  Large
                </Button>
              </div>
            </div>
          </div>
        </section>

        <section>
          <h2 className="font-[family-name:var(--typography-display-sm-family)] text-[length:var(--typography-display-sm-size)] font-[number:var(--typography-display-sm-weight)] leading-[var(--typography-display-sm-line-height)] tracking-[var(--typography-display-sm-letter-spacing)] text-[var(--color-text-strong)] mb-[var(--space-24)]">
            Inputs
          </h2>

          <div className="space-y-[var(--space-24)] max-w-md">
            <div className="space-y-[var(--space-8)]">
              <Label htmlFor="default-input">Default Input</Label>
              <Input id="default-input" placeholder="Enter text..." />
              <FormHelperText>This is a helper text</FormHelperText>
            </div>

            <div className="space-y-[var(--space-8)]">
              <Label htmlFor="error-input">Error State</Label>
              <Input
                id="error-input"
                error
                placeholder="Enter text..."
                aria-describedby="error-text"
              />
              <FormHelperText id="error-text" error>
                This field is required
              </FormHelperText>
            </div>

            <div className="space-y-[var(--space-8)]">
              <Label htmlFor="disabled-input">Disabled Input</Label>
              <Input id="disabled-input" disabled placeholder="Disabled..." />
            </div>

            <div className="space-y-[var(--space-8)]">
              <Label htmlFor="email-input">Email Input</Label>
              <Input
                id="email-input"
                type="email"
                placeholder="you@example.com"
              />
            </div>
          </div>
        </section>

        <section>
          <h2 className="font-[family-name:var(--typography-display-sm-family)] text-[length:var(--typography-display-sm-size)] font-[number:var(--typography-display-sm-weight)] leading-[var(--typography-display-sm-line-height)] tracking-[var(--typography-display-sm-letter-spacing)] text-[var(--color-text-strong)] mb-[var(--space-24)]">
            Cards
          </h2>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-[var(--space-24)]">
            <Card>
              <CardHeader>
                <CardTitle>Card Title</CardTitle>
                <CardDescription>
                  This is a description of the card content
                </CardDescription>
              </CardHeader>
              <CardContent>
                <p className="font-[family-name:var(--typography-body-md-family)] text-[length:var(--typography-body-md-size)] text-[var(--color-text-body)]">
                  Card content goes here. This uses the standard card shadow and
                  surface background.
                </p>
              </CardContent>
              <CardFooter>
                <Button variant="primary">Action</Button>
              </CardFooter>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Another Card</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="font-[family-name:var(--typography-body-md-family)] text-[length:var(--typography-body-md-size)] text-[var(--color-text-body)]">
                  Cards can have varying content and structure.
                </p>
              </CardContent>
            </Card>
          </div>
        </section>

        <section>
          <h2 className="font-[family-name:var(--typography-display-sm-family)] text-[length:var(--typography-display-sm-size)] font-[number:var(--typography-display-sm-weight)] leading-[var(--typography-display-sm-line-height)] tracking-[var(--typography-display-sm-letter-spacing)] text-[var(--color-text-strong)] mb-[var(--space-24)]">
            Navigation
          </h2>

          <div className="space-y-[var(--space-24)]">
            <div>
              <h3 className="font-[family-name:var(--typography-body-md-bold-family)] text-[length:var(--typography-body-md-bold-size)] font-[number:var(--typography-body-md-bold-weight)] mb-[var(--space-16)] text-[var(--color-text-strong)]">
                Light Nav
              </h3>
              <Nav variant="light">
                <NavContainer>
                  <div className="flex items-center gap-[var(--space-16)]">
                    <Logo size="sm" />
                    <span className="font-[family-name:var(--typography-body-md-bold-family)] text-[var(--color-text-strong)]">
                      Book Service
                    </span>
                  </div>
                  <div className="flex gap-[var(--space-8)]">
                    <NavItem href="#">Home</NavItem>
                    <NavItem href="#">Features</NavItem>
                    <NavItem href="#">Pricing</NavItem>
                  </div>
                </NavContainer>
              </Nav>
            </div>

            <div className="bg-[var(--color-bg-dark)] rounded-[var(--radius-lg)] overflow-hidden">
              <h3 className="font-[family-name:var(--typography-body-md-bold-family)] text-[length:var(--typography-body-md-bold-size)] font-[number:var(--typography-body-md-bold-weight)] p-[var(--space-24)] text-[var(--color-text-on-dark)]">
                Dark Nav (over dark hero)
              </h3>
              <Nav variant="dark">
                <NavContainer>
                  <div className="flex items-center gap-[var(--space-16)]">
                    <Logo size="sm" />
                    <span className="font-[family-name:var(--typography-body-md-bold-family)] text-[var(--color-text-on-dark)]">
                      Book Service
                    </span>
                  </div>
                  <div className="flex gap-[var(--space-8)]">
                    <NavItem href="#">Home</NavItem>
                    <NavItem href="#">Features</NavItem>
                    <NavItem href="#">Pricing</NavItem>
                  </div>
                </NavContainer>
              </Nav>
            </div>
          </div>
        </section>

        <section>
          <h2 className="font-[family-name:var(--typography-display-sm-family)] text-[length:var(--typography-display-sm-size)] font-[number:var(--typography-display-sm-weight)] leading-[var(--typography-display-sm-line-height)] tracking-[var(--typography-display-sm-letter-spacing)] text-[var(--color-text-strong)] mb-[var(--space-24)]">
            Logos
          </h2>

          <div className="space-y-[var(--space-32)]">
            <div>
              <h3 className="font-[family-name:var(--typography-body-md-bold-family)] text-[length:var(--typography-body-md-bold-size)] font-[number:var(--typography-body-md-bold-weight)] mb-[var(--space-16)] text-[var(--color-text-strong)]">
                Primary Logo (Horizontal)
              </h3>
              <div className="flex gap-[var(--space-32)] items-center flex-wrap">
                <div>
                  <p className="font-[family-name:var(--typography-body-sm-family)] text-[length:var(--typography-body-sm-size)] text-[var(--color-text-muted)] mb-[var(--space-8)]">
                    Small (24px)
                  </p>
                  <Logo variant="primary" size="sm" />
                </div>
                <div>
                  <p className="font-[family-name:var(--typography-body-sm-family)] text-[length:var(--typography-body-sm-size)] text-[var(--color-text-muted)] mb-[var(--space-8)]">
                    Medium (32px)
                  </p>
                  <Logo variant="primary" size="md" />
                </div>
                <div>
                  <p className="font-[family-name:var(--typography-body-sm-family)] text-[length:var(--typography-body-sm-size)] text-[var(--color-text-muted)] mb-[var(--space-8)]">
                    Large (48px)
                  </p>
                  <Logo variant="primary" size="lg" />
                </div>
              </div>
            </div>

            <div>
              <h3 className="font-[family-name:var(--typography-body-md-bold-family)] text-[length:var(--typography-body-md-bold-size)] font-[number:var(--typography-body-md-bold-weight)] mb-[var(--space-16)] text-[var(--color-text-strong)]">
                Secondary Logo (Stacked)
              </h3>
              <div className="flex gap-[var(--space-32)] items-end flex-wrap">
                <div>
                  <p className="font-[family-name:var(--typography-body-sm-family)] text-[length:var(--typography-body-sm-size)] text-[var(--color-text-muted)] mb-[var(--space-8)]">
                    Small (24px)
                  </p>
                  <Logo variant="secondary" size="sm" />
                </div>
                <div>
                  <p className="font-[family-name:var(--typography-body-sm-family)] text-[length:var(--typography-body-sm-size)] text-[var(--color-text-muted)] mb-[var(--space-8)]">
                    Medium (32px)
                  </p>
                  <Logo variant="secondary" size="md" />
                </div>
                <div>
                  <p className="font-[family-name:var(--typography-body-sm-family)] text-[length:var(--typography-body-sm-size)] text-[var(--color-text-muted)] mb-[var(--space-8)]">
                    Large (48px)
                  </p>
                  <Logo variant="secondary" size="lg" />
                </div>
              </div>
            </div>

            <div>
              <h3 className="font-[family-name:var(--typography-body-md-bold-family)] text-[length:var(--typography-body-md-bold-size)] font-[number:var(--typography-body-md-bold-weight)] mb-[var(--space-16)] text-[var(--color-text-strong)]">
                Secondary Logo with Tagline
              </h3>
              <div className="flex gap-[var(--space-32)] items-end flex-wrap">
                <div>
                  <p className="font-[family-name:var(--typography-body-sm-family)] text-[length:var(--typography-body-sm-size)] text-[var(--color-text-muted)] mb-[var(--space-8)]">
                    Small (24px)
                  </p>
                  <Logo variant="secondary-tagline" size="sm" />
                </div>
                <div>
                  <p className="font-[family-name:var(--typography-body-sm-family)] text-[length:var(--typography-body-sm-size)] text-[var(--color-text-muted)] mb-[var(--space-8)]">
                    Medium (32px)
                  </p>
                  <Logo variant="secondary-tagline" size="md" />
                </div>
                <div>
                  <p className="font-[family-name:var(--typography-body-sm-family)] text-[length:var(--typography-body-sm-size)] text-[var(--color-text-muted)] mb-[var(--space-8)]">
                    Large (48px)
                  </p>
                  <Logo variant="secondary-tagline" size="lg" />
                </div>
              </div>
            </div>

            <div>
              <h3 className="font-[family-name:var(--typography-body-md-bold-family)] text-[length:var(--typography-body-md-bold-size)] font-[number:var(--typography-body-md-bold-weight)] mb-[var(--space-16)] text-[var(--color-text-strong)]">
                Logo Mark (Icon)
              </h3>
              <div className="flex gap-[var(--space-32)] items-end flex-wrap">
                <div>
                  <p className="font-[family-name:var(--typography-body-sm-family)] text-[length:var(--typography-body-sm-size)] text-[var(--color-text-muted)] mb-[var(--space-8)]">
                    Small (24px)
                  </p>
                  <Logo variant="mark" size="sm" />
                </div>
                <div>
                  <p className="font-[family-name:var(--typography-body-sm-family)] text-[length:var(--typography-body-sm-size)] text-[var(--color-text-muted)] mb-[var(--space-8)]">
                    Medium (32px)
                  </p>
                  <Logo variant="mark" size="md" />
                </div>
                <div>
                  <p className="font-[family-name:var(--typography-body-sm-family)] text-[length:var(--typography-body-sm-size)] text-[var(--color-text-muted)] mb-[var(--space-8)]">
                    Large (48px)
                  </p>
                  <Logo variant="mark" size="lg" />
                </div>
              </div>
            </div>
          </div>
        </section>

        <section>
          <h2 className="font-[family-name:var(--typography-display-sm-family)] text-[length:var(--typography-display-sm-size)] font-[number:var(--typography-display-sm-weight)] leading-[var(--typography-display-sm-line-height)] tracking-[var(--typography-display-sm-letter-spacing)] text-[var(--color-text-strong)] mb-[var(--space-24)]">
            Other Components
          </h2>

          <div className="space-y-[var(--space-24)]">
            <div>
              <h3 className="font-[family-name:var(--typography-body-md-bold-family)] text-[length:var(--typography-body-md-bold-size)] font-[number:var(--typography-body-md-bold-weight)] mb-[var(--space-16)] text-[var(--color-text-strong)]">
                Eyebrow
              </h3>
              <Eyebrow>Featured Content</Eyebrow>
            </div>
          </div>
        </section>

        <section className="border-t border-[var(--color-border-default)] pt-[var(--space-32)]">
          <p className="font-[family-name:var(--typography-body-sm-family)] text-[length:var(--typography-body-sm-size)] text-[var(--color-text-muted)]">
            Note: This preview page is for development only and should be excluded from production navigation.
          </p>
        </section>
      </div>
    </div>
  )
}
