import { describe, expect, it } from "vitest";
import {
  assertSafeProviderBaseUrl,
  isLocalProviderBaseUrl,
  providerOriginKey,
  sameProviderOrigin,
} from "../src/providers/url-safety.js";

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

  it("S1: origin key ignores path but tracks scheme/host/port", () => {
    expect(sameProviderOrigin("https://api.example.com/v1", "https://api.example.com/v2")).toBe(
      true,
    );
    expect(
      sameProviderOrigin("https://api.example.com/v1", "https://api.example.com:443/v1"),
    ).toBe(true);
    expect(
      sameProviderOrigin("https://api.example.com/v1", "https://other.example.com/v1"),
    ).toBe(false);
    expect(
      sameProviderOrigin("https://api.example.com/v1", "http://127.0.0.1:11434/v1"),
    ).toBe(false);
    expect(providerOriginKey("https://API.Example.com:443/foo")).toBe(
      "https://api.example.com:443",
    );
    expect(isLocalProviderBaseUrl("http://127.0.0.1:11434")).toBe(true);
    expect(isLocalProviderBaseUrl("https://api.openai.com")).toBe(false);
  });
});

describe("R7 provider transport policy", () => {
  it("rejects private/metadata hostnames before connect on public path", async () => {
    const { fetchProviderHttp } = await import(
      "../src/providers/provider-transport.js"
    );
    await expect(
      fetchProviderHttp("https://169.254.169.254/latest", "/models", {
        timeoutMs: 2_000,
      }),
    ).rejects.toThrow();
    await expect(
      fetchProviderHttp("https://metadata.google.internal/", "/models", {
        timeoutMs: 2_000,
      }),
    ).rejects.toThrow();
  });
});
