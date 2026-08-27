const PERMISSIVE_LICENSES = new Set([
  "(MIT AND Zlib)",
  "(MIT OR CC0-1.0)",
  "0BSD",
  "Apache-2.0",
  "BSD-2-Clause",
  "BSD-3-Clause",
  "BlueOak-1.0.0",
  "ISC",
  "MIT",
  "Python-2.0",
]);

export function normalizeRepository(value, homepage = "") {
  const raw = typeof value === "string" ? value : value?.url;
  const candidate = String(raw || homepage || "").trim();
  if (!candidate) return "NOASSERTION";
  return candidate
    .replace(/^git\+/, "")
    .replace(/^git@github\.com:/, "https://github.com/")
    .replace(/^git\+ssh:\/\/git@github\.com\//, "https://github.com/")
    .replace(/\.git$/, "");
}

export function classifyLicense(name, declaredLicense) {
  const license = String(declaredLicense || "").trim();
  if (!license || /unknown|unlicensed|see license/i.test(license)) {
    throw new Error(`production dependency has unknown license: ${name} (${license || "missing"})`);
  }
  if (name === "jszip" && license === "(MIT OR GPL-3.0-or-later)") {
    return {
      effectiveLicense: "MIT",
      disposition: "distributed-under-permissive-option",
      rationale: "Penglai selects jszip's MIT option",
    };
  }
  if (/^@img\/sharp-libvips-/.test(name) && /^LGPL-/.test(license)) {
    return {
      effectiveLicense: license,
      disposition: "excluded-from-release",
      rationale: "Penglai Office disables PPT image probing and does not package sharp or libvips",
    };
  }
  if (/\b(?:AGPL|GPL|LGPL)-/i.test(license)) {
    throw new Error(`unapproved copyleft production dependency: ${name} (${license})`);
  }
  if (!PERMISSIVE_LICENSES.has(license)) {
    throw new Error(`unreviewed production license: ${name} (${license})`);
  }
  return {
    effectiveLicense: license,
    disposition: "production-closure-reviewed",
    rationale: "permissive production dependency",
  };
}

export function collectLockIntegrities(lock) {
  const rows = [];
  let current;
  for (const line of String(lock).split(/\r?\n/)) {
    const packageRow = /^ {2}(.+@[^:]+):$/.exec(line);
    if (packageRow) {
      current = packageRow[1].replace(/^'|'$/g, "");
      continue;
    }
    if (!current) continue;
    const integrity = /^ {4}resolution: \{[^}]*integrity: ([^,}]+)[^}]*\}$/.exec(line);
    if (integrity) rows.push({ packageId: current, integrity: integrity[1].trim() });
  }
  return rows;
}

export function integrityForPackage(lockRows, name, version) {
  const base = `${name}@${version}`;
  const matches = lockRows.filter(
    (row) => row.packageId === base || row.packageId.startsWith(`${base}(`),
  );
  const values = [...new Set(matches.map((row) => row.integrity))];
  if (values.length !== 1) return undefined;
  return values[0];
}
