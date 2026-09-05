import { generateSecureToken, sha256Hash, hashEmail } from "@/lib/crypto";

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
      // Base64url encoding: 4 chars per 3 bytes, so ~22 chars for 16 bytes
      expect(token.length).toBeGreaterThanOrEqual(20);
    });
  });

  describe("sha256Hash", () => {
    it("should hash a string", () => {
      const hash = sha256Hash("test");
      expect(hash).toBeDefined();
      expect(typeof hash).toBe("string");
      expect(hash.length).toBe(64); // SHA-256 produces 64 hex characters
    });

    it("should produce consistent hashes", () => {
      const hash1 = sha256Hash("test");
      const hash2 = sha256Hash("test");
      expect(hash1).toBe(hash2);
    });

    it("should produce different hashes for different inputs", () => {
      const hash1 = sha256Hash("test1");
      const hash2 = sha256Hash("test2");
      expect(hash1).not.toBe(hash2);
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
