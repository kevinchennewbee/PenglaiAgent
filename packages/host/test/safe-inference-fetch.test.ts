import { describe, expect, it, vi } from "vitest";
import {
  buildSafeProviderFetch,
  wrapProviderStreamsWithSafeFetch,
} from "../src/providers/safe-inference-fetch.js";

describe("R7 safe inference fetch", () => {
  it("injects a safe fetch into every stream call of a ProviderStreams wrapper", async () => {
    const calls: Array<{ options: { fetch?: unknown } }> = [];
    const baseApi = {
      stream: (_model: unknown, _ctx: unknown, options: { fetch?: unknown }) => {
        calls.push({ options });
        return "stream-result";
      },
      streamSimple: (_model: unknown, _ctx: unknown, options: { fetch?: unknown }) => {
        calls.push({ options });
        return "simple-result";
      },
    };
    const wrapped = wrapProviderStreamsWithSafeFetch(baseApi, "https://api.example.com/v1");
    wrapped.stream({}, {}, {});
    wrapped.streamSimple({}, {}, {});
    expect(calls).toHaveLength(2);
    for (const call of calls) {
      expect(typeof call.options.fetch).toBe("function");
    }
    // A caller-supplied fetch wins (explicit override still honored).
    const explicit = vi.fn();
    wrapped.streamSimple({}, {}, { fetch: explicit });
    expect(calls[2]!.options.fetch).toBe(explicit);
  });

  it("public fetch rejects private/metadata endpoints before connect", async () => {
    const fetch = buildSafeProviderFetch("https://api.example.com/v1");
    await expect(fetch("https://169.254.169.254/latest/meta-data")).rejects.toThrow();
    await expect(fetch("https://metadata.google.internal/")).rejects.toThrow();
    await expect(fetch("https://192.168.1.1/v1/chat/completions")).rejects.toThrow();
    await expect(fetch("http://10.0.0.5/v1/chat/completions")).rejects.toThrow();
  });

  it("local fetch rejects any URL outside the configured loopback origin", async () => {
    const fetch = buildSafeProviderFetch("http://127.0.0.1:11434/v1");
    // Different loopback port/origin must be rejected.
    await expect(fetch("http://127.0.0.1:9999/v1/chat/completions")).rejects.toThrow();
    await expect(fetch("http://localhost:11434/v1/chat/completions")).rejects.toThrow();
    await expect(fetch("https://evil.example/v1/chat/completions")).rejects.toThrow();
    // Same origin reaches real fetch (loopback) — but we do not start a server
    // here; a connection-refused is a network error, not a policy rejection.
    const res = fetch("http://127.0.0.1:11434/v1/chat/completions", {
      method: "POST",
      body: "{}",
    });
    await expect(res).rejects.toThrow(/fetch failed|ECONNREFUSED/);
  });

  it("rejects URL-embedded credentials", async () => {
    const fetch = buildSafeProviderFetch("https://api.example.com/v1");
    await expect(fetch("https://user:pass@api.example.com/v1/chat/completions")).rejects.toThrow(
      /credentials/,
    );
  });
});
