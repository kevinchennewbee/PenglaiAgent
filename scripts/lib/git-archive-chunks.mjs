const DEFAULT_MAX_FILES = 100;
const DEFAULT_MAX_ARGUMENT_CHARS = 12_000;

export function partitionGitArchivePaths(
  paths,
  { maxFiles = DEFAULT_MAX_FILES, maxArgumentChars = DEFAULT_MAX_ARGUMENT_CHARS } = {},
) {
  if (!Number.isSafeInteger(maxFiles) || maxFiles < 1) throw new Error("maxFiles must be positive");
  if (!Number.isSafeInteger(maxArgumentChars) || maxArgumentChars < 1) {
    throw new Error("maxArgumentChars must be positive");
  }

  const chunks = [];
  let current = [];
  let currentChars = 0;
  for (const path of paths) {
    if (typeof path !== "string" || path.length === 0 || path.includes("\0")) {
      throw new Error("archive paths must be non-empty strings without NUL bytes");
    }
    if (path.length > maxArgumentChars) {
      throw new Error(`archive path exceeds the per-command character limit: ${path}`);
    }
    if (current.length >= maxFiles || currentChars + path.length > maxArgumentChars) {
      chunks.push(current);
      current = [];
      currentChars = 0;
    }
    current.push(path);
    currentChars += path.length;
  }
  if (current.length) chunks.push(current);
  return chunks;
}
