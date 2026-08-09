const requiredVariables = ["TAURI_SIGNING_PRIVATE_KEY"];

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

process.stdout.write(
  process.env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD?.trim()
    ? "[release] encrypted updater signing key credentials are present\n"
    : "[release] updater signing key is present (unencrypted-key mode)\n",
);
