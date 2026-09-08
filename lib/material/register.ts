/**
 * Side-effect imports for the small @material/web set we actually use.
 * Call only in the browser. Top-level imports of these modules crash Node
 * SSR (`HTMLElement is not defined`).
 */
export async function registerMaterialWeb(): Promise<void> {
  if (typeof window === "undefined") return;
  await Promise.all([
    import("@material/web/button/filled-button.js"),
    import("@material/web/button/outlined-button.js"),
    import("@material/web/textfield/outlined-text-field.js"),
    import("@material/web/elevation/elevation.js"),
  ]);
}
