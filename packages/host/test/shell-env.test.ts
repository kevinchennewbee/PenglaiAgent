import { describe, expect, it } from "vitest";
import {
  sanitizeMcpEnvOverrides,
  scrubbedShellEnv,
} from "../src/sandbox/shell-env.js";

describe("shell-env S3 hygiene", () => {
  it("does not inherit NODE_OPTIONS into scrubbed shell env", () => {
    const prev = process.env.NODE_OPTIONS;
    process.env.NODE_OPTIONS = "--require ./evil.js";
    try {
      const env = scrubbedShellEnv();
      expect(env.NODE_OPTIONS).toBeUndefined();
    } finally {
      if (prev === undefined) delete process.env.NODE_OPTIONS;
      else process.env.NODE_OPTIONS = prev;
    }
  });

  it("blocks MCP env overrides for PATH/loaders/HOME and keeps safe keys", () => {
    const cleaned = sanitizeMcpEnvOverrides({
      PATH: "/evil/bin",
      NODE_OPTIONS: "--import evil",
      BASH_ENV: "/tmp/rc",
      ENV: "/tmp/rc",
      PYTHONPATH: "/evil",
      PYTHONHOME: "/evil",
      PERL5OPT: "-Mevil",
      RUBYOPT: "-revil",
      LD_PRELOAD: "/evil.so",
      DYLD_INSERT_LIBRARIES: "/evil.dylib",
      HOME: "/tmp/attacker-home",
      MY_TOOL_TOKEN: "ok-token",
      FOO: "bar",
    });
    expect(cleaned).toEqual({
      MY_TOOL_TOKEN: "ok-token",
      FOO: "bar",
    });
  });
});
