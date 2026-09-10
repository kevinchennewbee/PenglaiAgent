#!/usr/bin/env node
/** Rebuild fs-ext after ignore-scripts installs when that package is present.
 *  Official DSH 0.1.5-rc.1 JSONL persistence uses native prebuilds instead
 *  of fs-ext; absence is success, not a missing-binding failure. */

import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import { ROOT } from "./lib/repo.mjs";
import { nodeGypPrefix } from "./lib/node-gyp-prefix.mjs";

const dir = join(ROOT, "node_modules", "fs-ext");
const built = join(dir, "build", "Release", "fs_ext.node");
if (!existsSync(dir)) {
  console.log("fs-ext not in this DSH generation; JSONL persistence uses node-addon-system/flock");
  process.exit(0);
}
if (!existsSync(join(dir, "binding.gyp"))) {
  console.error("fs-ext is present without binding.gyp; refuse to treat a broken package as the 0.1.5 prebuild path");
  process.exit(1);
}
const npmJs = join(dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js");
const devdir = process.env.npm_config_devdir || join(tmpdir(), "node-gyp-dev");
const nodedir = process.env.npm_config_nodedir || nodeGypPrefix();
const env = {
  ...process.env,
  npm_config_devdir: devdir,
  npm_config_ignore_scripts: "false",
};
if (nodedir) env.npm_config_nodedir = nodedir;
const rebuilt = existsSync(npmJs)
  ? spawnSync(process.execPath, [npmJs, "rebuild", "fs-ext", "--ignore-scripts=false"], {
      cwd: ROOT,
      stdio: "inherit",
      env,
    })
  : spawnSync(process.platform === "win32" ? "npm.cmd" : "npm", ["rebuild", "fs-ext", "--ignore-scripts=false"], {
      cwd: ROOT,
      stdio: "inherit",
      env,
      shell: process.platform === "win32",
    });
if ((rebuilt.status ?? 1) !== 0 || !existsSync(built)) {
  console.error("fs-ext rebuild failed", rebuilt.error?.message ?? "", "status", rebuilt.status);
  process.exit(rebuilt.status ?? 1);
}
console.log("fs-ext rebuilt", built);
