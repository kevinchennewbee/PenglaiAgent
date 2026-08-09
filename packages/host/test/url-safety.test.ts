import { describe, expect, it } from "vitest";
import { assertSafeProviderBaseUrl } from "../src/providers/url-safety.js";

describe("provider base URL safety", () => {
  it("accepts TLS endpoints and exact loopback development endpoints", () => {
    expect(assertSafeProviderBaseUrl("https://api.example.com/v1/")).toBe(
      "https://api.example.com/v1",
    );
    expect(assertSafeProviderBaseUrl("http://127.0.0.1:11434/v1")).toBe(
      "http://127.0.0.1:11434/v1",
    );
    expect(assertSafeProviderBaseUrl("http://[::1]:11434/v1")).toBe(
      "http://[::1]:11434/v1",
    );
  });

  it("rejects public plaintext, lookalike localhost, credentials, and fragments", () => {
    for (const value of [
      "http://api.example.com/v1",
      "http://localhost.example.com/v1",
      "https://user:pass@127.0.0.1/v1",
      "https://example.com/v1#secret",
      "file:///tmp/model",
    ]) {
      expect(() => assertSafeProviderBaseUrl(value)).toThrow();
    }
  });
});
