import assert from "node:assert/strict";
import { copyFileSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";

// Import the same JavaScript module that embed-runtime copies into the app.
// @ts-expect-error the shipped launcher is intentionally plain Node JavaScript
import { bundledPackageManager, validateLaunchArguments } from "../../../scripts/runtime/penglai-dsh-launcher.mjs";

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "penglai-pnpm-launch-"));
  const node = join(root, "node", ...(process.platform === "win32" ? ["node.exe"] : ["bin", "node"]));
  const cli = join(root, "pnpm", "bin", "pnpm.mjs");
  mkdirSync(dirname(node), { recursive: true });
  mkdirSync(dirname(cli), { recursive: true });
  copyFileSync(process.execPath, node);
  writeFileSync(join(root, "pnpm", "package.json"), JSON.stringify({ name: "pnpm", version: "11.11.0" }));
  writeFileSync(cli, "process.stdout.write(JSON.stringify(process.argv.slice(2)));\n");
  return { root, node, cli };
}

test("bundled package operations never select pnpm from an untrusted PATH", () => {
  const f = fixture();
  try {
    const invocation = bundledPackageManager({ runtimeRoot: f.root, executable: f.node, systemPath: "untrusted-path" });
    assert.equal(invocation.command, realpathSync(f.node));
    assert.deepEqual(invocation.args, [f.cli, "--pm-on-fail=error"]);
    assert.equal(invocation.args[0], f.cli);
    assert.equal(invocation.args[1], "--pm-on-fail=error");
    assert.equal(invocation.env.npm_config_package_import_method, "copy");
    assert.equal(invocation.env.PATH?.split(process.platform === "win32" ? ";" : ":")[0], dirname(realpathSync(f.node)));
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});

test("a missing or mismatched bundled package manager cannot fall back to a machine executable", () => {
  const f = fixture();
  try {
    assert.throws(() => bundledPackageManager({ runtimeRoot: f.root, executable: process.execPath }));
    rmSync(f.cli);
    assert.throws(() => bundledPackageManager({ runtimeRoot: f.root, executable: f.node }));
    writeFileSync(f.cli, "");
    writeFileSync(join(f.root, "pnpm", "package.json"), JSON.stringify({ name: "pnpm", version: "0.0.0" }));
    assert.throws(() => bundledPackageManager({ runtimeRoot: f.root, executable: f.node }), /identity/);
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});

test("the application launcher accepts only the owned Web invocation", () => {
  assert.deepEqual(validateLaunchArguments(["--profile", "web", "--no-open", "--host", "127.0.0.1", "--port", "12345"]), {
    versionOnly: false, args: ["--no-open", "--host", "127.0.0.1", "--port", "12345"],
  });
  assert.deepEqual(validateLaunchArguments(["--version"]), { versionOnly: true });
  for (const args of [[], ["web"], ["--profile", "web", "--no-open", "--host", "127.0.0.1", "--port", "0"], ["--profile", "web", "--no-open", "--host", "127.0.0.1", "--port", "1;whoami"], ["--profile", "web", "--no-open", "--host", "0.0.0.0", "--port", "1234"]]) {
    assert.throws(() => validateLaunchArguments(args));
  }
});
