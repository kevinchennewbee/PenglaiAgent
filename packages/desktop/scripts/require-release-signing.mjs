const requiredVariables = [
  "TAURI_SIGNING_PRIVATE_KEY",
  "TAURI_SIGNING_PRIVATE_KEY_PASSWORD",
];

const missingVariables = requiredVariables.filter(
  (name) => !process.env[name]?.trim(),
);

if (missingVariables.length > 0) {
  process.stderr.write(
    [
      "[release] Refusing to create updater artifacts without release signing.",
      `[release] Missing: ${missingVariables.join(", ")}`,
      "[release] Use `npm run tauri:build:local` for a non-distributable local bundle.",
      "",
    ].join("\n"),
  );
  process.exit(1);
}

process.stdout.write("[release] updater signing credentials are present\n");
