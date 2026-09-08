import { generateSecureToken, hmacSha256, hashEmail, sha256Hex } from "@/lib/crypto";

describe("Crypto utilities", () => {
  describe("generateSecureToken", () => {
    it("should generate a token", () => {
      const token = generateSecureToken();
      expect(token).toBeDefined();
      expect(typeof token).toBe("string");
      expect(token.length).toBeGreaterThan(0);
    });

    it("should generate unique tokens", () => {
      const token1 = generateSecureToken();
      const token2 = generateSecureToken();
      expect(token1).not.toBe(token2);
    });

    it("should generate tokens of appropriate length", () => {
      const token = generateSecureToken(16);
      expect(token.length).toBeGreaterThanOrEqual(20);
    });
  });

  describe("hmacSha256", () => {
    it("should hash a string", () => {
      const hash = hmacSha256("test");
      expect(hash).toBeDefined();
      expect(typeof hash).toBe("string");
      expect(hash.length).toBe(64);
    });

    it("should produce consistent hashes", () => {
      const hash1 = hmacSha256("test");
      const hash2 = hmacSha256("test");
      expect(hash1).toBe(hash2);
    });

    it("should produce different hashes for different inputs", () => {
      const hash1 = hmacSha256("test1");
      const hash2 = hmacSha256("test2");
      expect(hash1).not.toBe(hash2);
    });

    it("should throw when DATA_HASH_SECRET is missing", () => {
      const original = process.env.DATA_HASH_SECRET;
      delete process.env.DATA_HASH_SECRET;

      try {
        expect(() => hmacSha256("test")).toThrow(
          "Missing required environment variable: DATA_HASH_SECRET",
        );
      } finally {
        process.env.DATA_HASH_SECRET = original;
      }
    });
  });

  describe("sha256Hex", () => {
    it("returns a 64-char hex digest that does not need DATA_HASH_SECRET", () => {
      const digest = sha256Hex("report-token");
      expect(digest).toMatch(/^[a-f0-9]{64}$/);
      expect(sha256Hex("report-token")).toBe(digest);
      expect(sha256Hex("other")).not.toBe(digest);
    });
  });

  describe("hashEmail", () => {
    it("should hash an email", () => {
      const hash = hashEmail("test@example.com");
      expect(hash).toBeDefined();
      expect(typeof hash).toBe("string");
      expect(hash.length).toBe(64);
    });

    it("should normalize email case", () => {
      const hash1 = hashEmail("Test@Example.com");
      const hash2 = hashEmail("test@example.com");
      expect(hash1).toBe(hash2);
    });

    it("should trim whitespace", () => {
      const hash1 = hashEmail("  test@example.com  ");
      const hash2 = hashEmail("test@example.com");
      expect(hash1).toBe(hash2);
    });
  });
});
