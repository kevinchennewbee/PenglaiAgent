/** argv builders for hdiutil create/convert. Convert must use -o and one image. */

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
