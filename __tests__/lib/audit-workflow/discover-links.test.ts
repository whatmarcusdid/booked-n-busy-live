import { selectCategoryUrls } from "@/lib/audit-workflow/discover-links";

const HOME = "https://shop.example.com/";

function htmlWith(links: Array<{ href: string; text: string }>): string {
  return `<html><body>${links
    .map((link) => `<a href="${link.href}">${link.text}</a>`)
    .join("")}</body></html>`;
}

describe("selectCategoryUrls", () => {
  it("picks same-origin About, Services, and Contact links", () => {
    const selected = selectCategoryUrls(
      htmlWith([
        { href: "/about", text: "About Us" },
        { href: "/services", text: "Our Services" },
        { href: "/contact", text: "Contact" },
        { href: "https://other.example/about", text: "About them" },
      ]),
      HOME,
    );

    expect(selected.about).toBe("https://shop.example.com/about");
    expect(selected.services).toBe("https://shop.example.com/services");
    expect(selected.contact).toBe("https://shop.example.com/contact");
  });

  it("prefers an exact /about path over a longer about-team URL", () => {
    const selected = selectCategoryUrls(
      htmlWith([
        { href: "/about/team", text: "About the team" },
        { href: "/about", text: "About" },
      ]),
      HOME,
    );
    expect(selected.about).toBe("https://shop.example.com/about");
  });

  it("returns null for a category with no matching same-origin link", () => {
    const selected = selectCategoryUrls(
      htmlWith([{ href: "/about", text: "About" }]),
      HOME,
    );
    expect(selected.about).toBe("https://shop.example.com/about");
    expect(selected.services).toBeNull();
    expect(selected.contact).toBeNull();
  });

  it("ignores mailto, tel, and javascript hrefs", () => {
    const selected = selectCategoryUrls(
      htmlWith([
        { href: "mailto:contact@example.com", text: "Contact" },
        { href: "tel:5551234", text: "Contact us" },
        { href: "javascript:void(0)", text: "About" },
      ]),
      HOME,
    );
    expect(selected).toEqual({
      about: null,
      services: null,
      contact: null,
    });
  });
});
