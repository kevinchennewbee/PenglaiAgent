import assert from "node:assert/strict";
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { PenglaiError } from "@penglai/contracts";
import { convergePrivatePosixModes, PRIVATE_MODE_TREES } from "./private-mode.js";
import { ensurePrivateHome, resolveUserLayout } from "./index.js";
import { refusePosixModeAsWindowsAcl } from "./windows-host.js";

const posix = process.platform !== "win32";

test("R56-SEC-003 private trees include vault grant artifact IM and backup", () => {
  assert.deepEqual(
    PRIVATE_MODE_TREES.map((tree) => tree.id),
    ["user-root", "dsh-home", "vault", "grant", "artifact", "im", "backup"],
  );
});

test("R56-SEC-003 converges secret files to 0600 and directories to 0700", { skip: !posix }, () => {
  const user = resolveUserLayout(mkdtempSync(join(tmpdir(), "penglai-mode-")));
  mkdirSync(join(user.root, "im"), { recursive: true, mode: 0o777 });
  writeFileSync(join(user.root, "im", "penglai-im.sqlite"), "db\n", { mode: 0o666 });
  mkdirSync(join(user.root, "dsh-home"), { recursive: true, mode: 0o755 });
  writeFileSync(join(user.root, "dsh-home", ".credentials.yaml"), "DEEPSEEK_API_KEY: penglai-test-fixture-key-not-real\n", {
    mode: 0o644,
  });
  mkdirSync(join(user.root, "plugins"), { recursive: true, mode: 0o755 });
  writeFileSync(join(user.root, "plugins", "owner-capability.json"), "{}\n", { mode: 0o644 });
  const report = convergePrivatePosixModes(user);
  assert.equal(report.posixModesApplied, true);
  assert.equal(lstatSync(join(user.root, "im")).mode & 0o777, 0o700);
  assert.equal(lstatSync(join(user.root, "im", "penglai-im.sqlite")).mode & 0o777, 0o600);
  assert.equal(lstatSync(join(user.root, "dsh-home", ".credentials.yaml")).mode & 0o777, 0o600);
  assert.equal(lstatSync(join(user.root, "plugins", "owner-capability.json")).mode & 0o777, 0o600);
  assert.equal(lstatSync(join(user.root, "objects")).isDirectory(), true);
  assert.equal(lstatSync(join(user.root, ".penglai-backup")).mode & 0o777, 0o700);
});

test("R56-SEC-003 refuses a symlink private tree", { skip: !posix }, () => {
  const user = resolveUserLayout(mkdtempSync(join(tmpdir(), "penglai-mode-link-")));
  const outside = mkdtempSync(join(tmpdir(), "penglai-mode-outside-"));
  mkdirSync(user.root, { recursive: true });
  symlinkSync(outside, join(user.root, "im"));
  assert.throws(() => convergePrivatePosixModes(user), (error: unknown) => {
    return error instanceof PenglaiError && /private tree im is a symlink/.test(error.message);
  });
});

test("R56-SEC-003 refuses a symlink inside a secret tree", { skip: !posix }, () => {
  const user = resolveUserLayout(mkdtempSync(join(tmpdir(), "penglai-mode-inner-")));
  const outside = join(mkdtempSync(join(tmpdir(), "penglai-mode-escape-")), "secret");
  writeFileSync(outside, "escaped\n");
  mkdirSync(join(user.root, ".penglai-backup"), { recursive: true });
  symlinkSync(outside, join(user.root, ".penglai-backup", "escape"));
  assert.throws(() => convergePrivatePosixModes(user), /private tree backup is a symlink/);
});

test("R56-SEC-003 boot home converges and does not follow a credentials symlink", { skip: !posix }, () => {
  const user = resolveUserLayout(mkdtempSync(join(tmpdir(), "penglai-mode-boot-")));
  mkdirSync(user.dshHome, { recursive: true });
  const outside = join(mkdtempSync(join(tmpdir(), "penglai-mode-cred-")), ".credentials.yaml");
  writeFileSync(outside, "DEEPSEEK_API_KEY: penglai-test-other-fixture-key-not-real\n");
  symlinkSync(outside, join(user.dshHome, ".credentials.yaml"));
  assert.throws(() => ensurePrivateHome(user), /private tree vault is a symlink/);
  assert.equal(existsSync(outside), true);
});

test("P059-DATA-015 private-mode convergence follows the selected alpha.2 Home", () => {
  const root = mkdtempSync(join(tmpdir(), "penglai-mode-alpha2-"));
  const alpha2Home = join(root, "dsh-homes", "dsh-v0.1.2-rc.1");
  const user = resolveUserLayout(root, alpha2Home);
  convergePrivatePosixModes(user, process.platform);
  assert.equal(existsSync(alpha2Home), true);
  assert.equal(existsSync(join(root, "dsh-home")), false);
});

test("R56-SEC-003 a broken symlink still fails closed", { skip: !posix }, () => {
  const user = resolveUserLayout(mkdtempSync(join(tmpdir(), "penglai-mode-broken-")));
  mkdirSync(user.root, { recursive: true });
  symlinkSync(join(user.root, "missing-target"), join(user.root, "im"));
  assert.throws(() => convergePrivatePosixModes(user), /private tree im is a symlink/);
});

test("R56-SEC-003 Windows evidence stays ACL-shaped and POSIX mode is not an ACL", () => {
  assert.throws(() => refusePosixModeAsWindowsAcl("posix-mode"), /POSIX mode cannot impersonate/);
  const user = resolveUserLayout(mkdtempSync(join(tmpdir(), "penglai-mode-win-")));
  const report = convergePrivatePosixModes(user, "win32");
  assert.equal(report.posixModesApplied, false);
  assert.equal(report.platform, "win32");
});
