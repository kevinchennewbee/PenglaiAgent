import { lstatSync, readFileSync, realpathSync } from "node:fs";
import { delimiter, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const BUNDLED_PNPM_VERSION = "11.11.0";

function regular(path, label) {
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`${label} must be a bundled regular file`);
  return path;
}

/** Launcher facts, not a PATH lookup or a renderer-selected executable. */
export function bundledPackageManager({ runtimeRoot, executable, platform = process.platform, systemPath = "" }) {
  if (!isAbsolute(runtimeRoot) || !isAbsolute(executable)) throw new Error("absolute package runtime required");
  const node = join(runtimeRoot, "node", ...(platform === "win32" ? ["node.exe"] : ["bin", "node"]));
  regular(node, "Node");
  const actual = realpathSync(executable);
  const expected = realpathSync(node);
  const same = platform === "win32" ? actual.toLowerCase() === expected.toLowerCase() : actual === expected;
  if (!same) throw new Error("plugin management requires the application's embedded Node");
  const pnpmRoot = join(runtimeRoot, "pnpm");
  const manifest = JSON.parse(readFileSync(regular(join(pnpmRoot, "package.json"), "pnpm manifest"), "utf8"));
  if (manifest.name !== "pnpm" || manifest.version !== BUNDLED_PNPM_VERSION) throw new Error("bundled pnpm identity mismatch");
  const cli = regular(join(pnpmRoot, "bin", "pnpm.mjs"), "pnpm entry");
  return {
    command: expected,
    args: [cli, "--pm-on-fail=error"],
    env: {
      PATH: `${dirname(expected)}${delimiter}${systemPath}`,
      // Package files belong to the mutable profile, never shared app bytes.
      npm_config_package_import_method: "copy",
    },
  };
}

export function validateLaunchArguments(args) {
  if (args.length === 1 && args[0] === "--version") return { versionOnly: true };
  if (args.length !== 7 || args[0] !== "--profile" || args[1] !== "web" || args[2] !== "--no-open" || args[3] !== "--host" || args[4] !== "127.0.0.1" || args[5] !== "--port") {
    throw new Error("Penglai launches only its owned Web profile and explicit port");
  }
  const port = Number(args[6]);
  if (!/^[0-9]+$/.test(args[6]) || !Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("invalid owned DSH port");
  }
  return { versionOnly: false, args: args.slice(2) };
}

async function main() {
  const launch = validateLaunchArguments(process.argv.slice(2));
  const dshRoot = dirname(dirname(fileURLToPath(import.meta.url)));
  const manifest = JSON.parse(readFileSync(join(dshRoot, "package.json"), "utf8"));
  if (manifest.name !== "@deepseek-ai/dsh" || manifest.version !== "0.1.6-alpha.2") {
    throw new Error("Penglai DSH launch identity mismatch");
  }
  if (launch.versionOnly) {
    process.stdout.write(`${manifest.version}\n`);
    return;
  }
  const userRoot = process.env.PENGLAI_USER_DATA;
  const home = process.env.DSH_HOME;
  if (!userRoot || !home || !isAbsolute(userRoot) || !isAbsolute(home)) throw new Error("private DSH Home required");
  const homeRelative = relative(resolve(userRoot), resolve(home));
  if (!homeRelative || homeRelative.startsWith("..") || isAbsolute(homeRelative)) throw new Error("DSH Home escapes application data");
  const packageManager = bundledPackageManager({
    runtimeRoot: dirname(dshRoot),
    executable: process.execPath,
    systemPath: process.env.PATH ?? "",
  });
  // Invoke the public, pinned launcher API. The official CLI and all upstream
  // package bytes remain unchanged. There is no second Agent or profile engine.
  const { runProfile } = await import("./profile-boot.js");
  const { loadLayeredEnv } = await import("@deepseek-ai/dsh-app-boot");
  await runProfile({
    environment: loadLayeredEnv("dsh"),
    profile: "web",
    patchFiles: [
      regular(join(dshRoot, "penglai-profile-policy.yml"), "product profile policy"),
      ...((process.arch === "loong64" || process.arch === "loongarch64")
        ? [regular(join(dshRoot, "penglai-loong64-policy.yml"), "platform profile policy")]
        : []),
    ],
    args: launch.args,
    packageManager,
    resolutionMode: "runtime",
  });
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main().catch((error) => {
    process.stderr.write(`Penglai DSH launch failed: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
