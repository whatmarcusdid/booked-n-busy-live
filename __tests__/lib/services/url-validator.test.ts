import {
  normalizeUrl,
  validateHttpUrl,
  normalizeAndValidateUrl,
} from "@/lib/services/url-validator";

describe("URL Validator", () => {
  describe("normalizeUrl", () => {
    it("should add https:// to bare domains", () => {
      expect(normalizeUrl("example.com")).toBe("https://example.com");
      expect(normalizeUrl("www.example.com")).toBe("https://www.example.com");
    });

    it("should preserve existing http protocol", () => {
      expect(normalizeUrl("http://example.com")).toBe("http://example.com");
    });

    it("should preserve existing https protocol", () => {
      expect(normalizeUrl("https://example.com")).toBe("https://example.com");
    });

    it("should trim whitespace", () => {
      expect(normalizeUrl("  example.com  ")).toBe("https://example.com");
    });
  });

  describe("validateHttpUrl", () => {
    it("should accept valid http URLs", () => {
      const result = validateHttpUrl("http://example.com");
      expect(result.valid).toBe(true);
    });

    it("should accept valid https URLs", () => {
      const result = validateHttpUrl("https://example.com");
      expect(result.valid).toBe(true);
    });

    it("should reject invalid URL formats", () => {
      const result = validateHttpUrl("not a url");
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.error).toContain("Invalid URL format");
      }
    });

    it("should reject non-http protocols", () => {
      const result = validateHttpUrl("ftp://example.com");
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.error).toContain("http or https");
      }
    });

    it("should reject URLs without hostname", () => {
      const result = validateHttpUrl("https://");
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.error).toContain("Invalid URL format");
      }
    });
  });

  describe("normalizeAndValidateUrl", () => {
    it("should normalize and validate bare domains", () => {
      const result = normalizeAndValidateUrl("example.com");
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.url).toBe("https://example.com");
      }
    });

    it("should validate already normalized URLs", () => {
      const result = normalizeAndValidateUrl("https://example.com");
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.url).toBe("https://example.com");
      }
    });

    it("should reject invalid URLs after normalization", () => {
      const result = normalizeAndValidateUrl("not a url @#$%");
      expect(result.success).toBe(false);
    });
  });
});
