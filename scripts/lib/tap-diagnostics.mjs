export function extractTapFailureDiagnostics(output, maxChars = 12_000) {
  const lines = String(output || "").split(/\r?\n/);
  const selected = new Set();
  for (let index = 0; index < lines.length; index += 1) {
    if (!/^not ok\b/.test(lines[index].trim())) continue;
    const start = Math.max(0, index - 1);
    const end = Math.min(lines.length, index + 20);
    for (let cursor = start; cursor < end; cursor += 1) selected.add(cursor);
  }
  if (selected.size === 0) return "";
  const excerpt = [...selected]
    .sort((left, right) => left - right)
    .map((index) => lines[index])
    .join("\n");
  return excerpt.slice(0, maxChars);
}
