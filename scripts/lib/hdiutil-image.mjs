/** argv builders for hdiutil create/convert. Convert must use -o and one image. */

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";

export function hdiutilBusyRetryable(diagnostic) {
  return /resource busy|resource temporarily unavailable|couldn't eject|资源暂时不可用|无法推出/i.test(
    String(diagnostic ?? ""),
  );
}

export function disksAttachedToImage(infoText, imagePath) {
  const image = String(imagePath ?? "");
  if (!image) return [];
  const disks = [];
  const seen = new Set();
  for (const block of String(infoText ?? "").split(/^=+$/mu)) {
    if (!block.includes(image)) continue;
    for (const line of block.split(/\n/u)) {
      const match = /^(\/dev\/disk\d+)(?:\s|$)/u.exec(line.trim());
      if (!match || seen.has(match[1])) continue;
      seen.add(match[1]);
      disks.push(match[1]);
    }
  }
  return disks;
}

function hdiutilInfoText() {
  const result = spawnSync("hdiutil", ["info"], { encoding: "utf8" });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  return `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
}

export function detachDmgUntilReleased({ mount, image, attempts = 8, waitMs = 1_000 } = {}) {
  if (!mount && !image) {
    throw new Error("hdiutil detach requires a mount or image");
  }
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const info = hdiutilInfoText();
    const disks = image ? disksAttachedToImage(info, image) : [];
    const targets = [];
    if (mount) targets.push(mount);
    for (const disk of disks) {
      if (!targets.includes(disk)) targets.push(disk);
    }
    for (const target of targets) {
      if (target.startsWith("/dev/") && !existsSync(target)) continue;
      const detached = spawnSync("hdiutil", ["detach", target, "-force"], { encoding: "utf8" });
      if (detached.stdout) process.stdout.write(detached.stdout);
      if (detached.stderr) process.stderr.write(detached.stderr);
    }
    const stillMounted = Boolean(mount && existsSync(mount));
    const stillAttached = image ? disksAttachedToImage(hdiutilInfoText(), image).length > 0 : false;
    if (!stillMounted && !stillAttached) return;
    if (attempt === attempts) {
      throw new Error(
        `hdiutil detach did not release ${[mount, image].filter(Boolean).join(" ")}`,
      );
    }
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, attempt * waitMs);
  }
}

const CREATE_VALUE_FLAGS = new Set(["-volname", "-srcfolder", "-format", "-fs", "-size"]);
const CREATE_BARE_FLAGS = new Set(["-ov", "-plist", "-verbose", "-debug", "-quiet"]);

const CONVERT_VALUE_FLAGS = new Set([
  "-format",
  "-o",
  "-imagekey",
  "-srcimagekey",
  "-tgtimagekey",
  "-align",
  "-segmentSize",
  "-tasks",
  "-encryption",
  "-certificate",
  "-shadow",
  "-cacert",
]);
const CONVERT_BARE_FLAGS = new Set([
  "-ov",
  "-pmap",
  "-plist",
  "-verbose",
  "-debug",
  "-quiet",
  "-stdinpass",
  "-agentpass",
  "-insecurehttp",
  "-puppetstrings",
]);

function requireNonEmptyString(value, label) {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${label} must be a non-empty string`);
  }
  return value;
}

export function positionalHdiutilOperands(args, valueFlags, bareFlags) {
  if (!Array.isArray(args) || args.length === 0 || typeof args[0] !== "string") {
    throw new Error("hdiutil argv must start with a verb");
  }
  const positionals = [];
  for (let i = 1; i < args.length; i += 1) {
    const token = args[i];
    if (typeof token !== "string" || token.length === 0) {
      throw new Error(`hdiutil ${args[0]} argument must be a non-empty string`);
    }
    if (token.startsWith("-")) {
      if (valueFlags.has(token)) {
        const value = args[i + 1];
        if (typeof value !== "string" || value.length === 0 || value.startsWith("-")) {
          throw new Error(`hdiutil ${args[0]} ${token} requires a value`);
        }
        i += 1;
        continue;
      }
      if (bareFlags.has(token)) continue;
      throw new Error(`hdiutil ${args[0]} has unsupported flag ${token}`);
    }
    positionals.push(token);
  }
  return positionals;
}

export function hdiutilCreateArgs({
  volumeName,
  sourceFolder,
  format,
  output,
  overwrite = true,
} = {}) {
  requireNonEmptyString(volumeName, "hdiutil create -volname");
  requireNonEmptyString(sourceFolder, "hdiutil create -srcfolder");
  requireNonEmptyString(format, "hdiutil create -format");
  requireNonEmptyString(output, "hdiutil create output");
  if (!/^[A-Z]{4}$/.test(format)) {
    throw new Error("hdiutil create format must be a four-letter image format");
  }
  const args = [
    "create",
    "-volname",
    volumeName,
    "-srcfolder",
    sourceFolder,
    "-format",
    format,
  ];
  if (overwrite) args.push("-ov");
  args.push(output);
  assertHdiutilCreateArgs(args);
  return args;
}

export function assertHdiutilCreateArgs(args) {
  if (!Array.isArray(args) || args[0] !== "create") {
    throw new Error("hdiutil create argv must start with create");
  }
  if (args.indexOf("-volname") < 0 || args.indexOf("-srcfolder") < 0 || args.indexOf("-format") < 0) {
    throw new Error("hdiutil create requires -volname, -srcfolder, and -format");
  }
  const positionals = positionalHdiutilOperands(args, CREATE_VALUE_FLAGS, CREATE_BARE_FLAGS);
  if (positionals.length !== 1) {
    throw new Error(`hdiutil create accepts exactly one output image, got ${positionals.length}`);
  }
  return {
    output: positionals[0],
    volumeName: args[args.indexOf("-volname") + 1],
    sourceFolder: args[args.indexOf("-srcfolder") + 1],
    format: args[args.indexOf("-format") + 1],
  };
}

export function hdiutilConvertArgs({
  image,
  output,
  format = "UDZO",
  imageKey = "zlib-level=9",
  overwrite = true,
} = {}) {
  requireNonEmptyString(image, "hdiutil convert image");
  requireNonEmptyString(output, "hdiutil convert -o");
  requireNonEmptyString(format, "hdiutil convert -format");
  if (image === output) {
    throw new Error("hdiutil convert input image and output must differ");
  }
  if (!/^[A-Z]{4}$/.test(format)) {
    throw new Error("hdiutil convert format must be a four-letter image format");
  }
  const args = ["convert", "-format", format, "-o", output];
  if (overwrite) args.push("-ov");
  if (imageKey != null && imageKey !== "") {
    requireNonEmptyString(imageKey, "hdiutil convert -imagekey");
    if (!imageKey.includes("=") || /\s/.test(imageKey)) {
      throw new Error("hdiutil convert -imagekey must be key=value without spaces");
    }
    args.push("-imagekey", imageKey);
  }
  args.push(image);
  assertHdiutilConvertArgs(args);
  return args;
}

export function assertHdiutilConvertArgs(args) {
  if (!Array.isArray(args) || args[0] !== "convert") {
    throw new Error("hdiutil convert argv must start with convert");
  }
  const errors = [];
  const formatIdx = args.indexOf("-format");
  const outIdx = args.indexOf("-o");
  const output = outIdx >= 0 ? args[outIdx + 1] : undefined;
  if (formatIdx < 0 || outIdx < 0) {
    errors.push("hdiutil convert requires -format and -o");
  } else if (typeof output !== "string" || output.length === 0 || output.startsWith("-")) {
    errors.push("hdiutil convert -o requires an output path");
  }
  const positionals = positionalHdiutilOperands(args, CONVERT_VALUE_FLAGS, CONVERT_BARE_FLAGS);
  if (positionals.length !== 1) {
    errors.push(`hdiutil convert accepts exactly one input image, got ${positionals.length}`);
  }
  if (typeof output === "string" && positionals.length === 1 && output === positionals[0]) {
    errors.push("hdiutil convert -o output must not be the input image");
  }
  if (errors.length > 0) {
    throw new Error(errors.join("; "));
  }
  return {
    image: positionals[0],
    output,
    format: args[formatIdx + 1],
  };
}
