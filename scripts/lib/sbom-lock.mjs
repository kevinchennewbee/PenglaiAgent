export function collectLockPackageIds(lock) {
  const names = new Set();
  for (const line of String(lock).split(/\r?\n/)) {
    const match = /^ {6}([^:]+@[^:]+):$/.exec(line) || /^ {2}([^:]+@[^:]+):$/.exec(line);
    if (match) names.add(match[1]);
  }
  return [...names].sort();
}
