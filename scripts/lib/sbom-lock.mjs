export function collectLockPackageIds(lock) {
  const names = new Set();
  for (const line of String(lock).split(/\r?\n/)) {
    // pnpm lockfile v9 package and snapshot identities are top-level mapping
    // entries indented by two spaces. Six-space entries are dependency and
    // peer metadata and may contain a scoped package name without a version.
    const match = /^ {2}([^:]+@[^:]+):$/.exec(line);
    if (match) names.add(match[1]);
  }
  return [...names].sort();
}

export function splitLockPackageId(id) {
  const clean = String(id).replace(/^'|'$/g, "").replace(/\([^)]*\).*$/, "");
  const at = clean.lastIndexOf("@");
  if (at <= 0 || at === clean.length - 1) {
    throw new Error(`invalid pnpm lock package id: ${id}`);
  }
  return { name: clean.slice(0, at), version: clean.slice(at + 1) };
}
