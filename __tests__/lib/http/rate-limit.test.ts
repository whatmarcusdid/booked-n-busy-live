import {
  consumeRateLimit,
  resetRateLimitForTests,
} from "@/lib/http/rate-limit";

describe("consumeRateLimit", () => {
  beforeEach(() => {
    resetRateLimitForTests();
  });

  it("allows up to the limit then rejects inside the window", () => {
    const now = 1_000_000;
    expect(consumeRateLimit("k", 2, 60_000, now).ok).toBe(true);
    expect(consumeRateLimit("k", 2, 60_000, now + 10).ok).toBe(true);
    expect(consumeRateLimit("k", 2, 60_000, now + 20).ok).toBe(false);
  });

  it("resets after the window", () => {
    const now = 1_000_000;
    consumeRateLimit("k", 1, 100, now);
    expect(consumeRateLimit("k", 1, 100, now + 50).ok).toBe(false);
    expect(consumeRateLimit("k", 1, 100, now + 100).ok).toBe(true);
  });
});
