import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { registerMaterialWeb } from "@/lib/material/register";

describe("Material Web setup", () => {
  it("uses the Figma landing palette as --md-sys-color tokens", () => {
    const css = readFileSync(
      resolve(__dirname, "../../../lib/material/tokens.css"),
      "utf8",
    );
    expect(css).toContain("Do NOT generate these from Material Theme Builder");
    expect(css).toContain("--md-sys-color-primary: #34d399");
    expect(css).toContain("--md-sys-color-on-primary: #0c0a28");
    expect(css).toContain("--md-sys-color-surface: #ffffff");
    expect(css).toContain("--md-sys-color-on-surface-variant: #737373");
    expect(css).toContain("--md-sys-color-outline: #d4d4d4");
  });

  it("does not evaluate Lit custom elements when imported on the server", async () => {
    expect(typeof registerMaterialWeb).toBe("function");
    await expect(registerMaterialWeb()).resolves.toBeUndefined();
  });
});
