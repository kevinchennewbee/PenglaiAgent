/** Instance-scoped Windows process matching. Never match by image name alone. */

export function normalizeWindowsPath(value) {
  return String(value ?? "")
    .trim()
    .replace(/^"(.*)"$/u, "$1")
    .replaceAll("/", "\\")
    .replace(/\\+$/u, "");
}

export function executablePathUnderRoot(executablePath, installRoot) {
  const exe = normalizeWindowsPath(executablePath).toLowerCase();
  const root = normalizeWindowsPath(installRoot).toLowerCase();
  if (!exe || !root) return false;
  return exe === root || exe.startsWith(`${root}\\`);
}

export function commandLineMentionsRoot(commandLine, installRoot) {
  const line = normalizeWindowsPath(commandLine).toLowerCase();
  const root = normalizeWindowsPath(installRoot).toLowerCase();
  if (!line || !root) return false;
  let from = 0;
  while (from <= line.length) {
    const idx = line.indexOf(root, from);
    if (idx < 0) return false;
    const before = idx === 0 ? "" : line[idx - 1];
    const after = line[idx + root.length] ?? "";
    const beforeOk = idx === 0 || /[\\"'\s,;=]/.test(before);
    const afterOk = after === "" || after === "\\" || /[\s"'.,;]/.test(after);
    if (beforeOk && afterOk) return true;
    from = idx + 1;
  }
  return false;
}

/**
 * Keep a process only when its executable lives under the target install root.
 * Image names such as Penglai.exe are not sufficient: a second instance with
 * a different INSTDIR must survive.
 */
export function selectProcessesUnderInstallRoot(rows, installRoot) {
  const root = normalizeWindowsPath(installRoot);
  return (Array.isArray(rows) ? rows : []).filter((row) => {
    const exe = String(row?.executablePath ?? "");
    if (exe) return executablePathUnderRoot(exe, root);
    return false;
  });
}

export function parseCimProcessLine(line) {
  const text = String(line ?? "").trim();
  if (!text) return null;
  const match = /^(\d+)\s+(\d+)\s+(\S+)\s+(.*)$/u.exec(text);
  if (!match) return null;
  const rest = match[4];
  const exeEnd = rest.search(/ \S*:\\/iu) > 0 ? rest.search(/ \S*:\\/iu) : -1;
  let executablePath = rest;
  let commandLine = "";
  if (exeEnd >= 0) {
    executablePath = rest.slice(0, exeEnd).trim();
    commandLine = rest.slice(exeEnd + 1).trim();
  } else {
    const quoted = /^("(?:[^"]+)"|[^\s]+)\s*(.*)$/u.exec(rest);
    if (quoted) {
      executablePath = quoted[1].replace(/^"|"$/gu, "");
      commandLine = quoted[2];
    }
  }
  return {
    pid: Number(match[1]),
    parentPid: Number(match[2]),
    name: match[3],
    executablePath,
    commandLine,
  };
}

export function selectProcessesForInstance(rows, { installRoot, dataRoot } = {}) {
  const underInstall = selectProcessesUnderInstallRoot(rows, installRoot);
  const helpers = dataRoot
    ? (Array.isArray(rows) ? rows : []).filter((row) => {
        if (!commandLineMentionsRoot(row?.commandLine, dataRoot)) return false;
        const exe = String(row?.executablePath ?? "");
        if (exe && executablePathUnderRoot(exe, installRoot)) return false;
        return true;
      })
    : [];
  const seen = new Set();
  return [...underInstall, ...helpers].filter((row) => {
    const pid = Number(row?.pid);
    if (!Number.isSafeInteger(pid) || pid <= 0 || seen.has(pid)) return false;
    seen.add(pid);
    return true;
  });
}

export const WINDOWS_SCOPED_STOP_POWERSHELL = [
  "$root = [IO.Path]::GetFullPath($env:PENGLAI_INSTALL_ROOT).TrimEnd([char]92)",
  "$prefix = $root + [char]92",
  "Get-CimInstance Win32_Process | ForEach-Object {",
  "  if ($_.ExecutablePath -and ($_.ExecutablePath.Equals($root, [StringComparison]::OrdinalIgnoreCase) -or $_.ExecutablePath.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase))) {",
  "    Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue",
  "  }",
  "}",
].join("; ");

export function nsisScopedStopContract(script) {
  const text = String(script ?? "");
  const errors = [];
  if (/\/IM\s+Penglai\.exe/i.test(text) || /\/IM", "Penglai\.exe"/.test(text)) {
    errors.push("must not taskkill /IM Penglai.exe");
  }
  if (/\/IM\s+"Penglai Helper\.exe"/i.test(text) || /\/IM", "Penglai Helper\.exe"/.test(text)) {
    errors.push("must not taskkill /IM Penglai Helper.exe");
  }
  if (!/ExecutablePath/.test(text) || !/StartsWith/.test(text)) {
    errors.push("must stop processes by ExecutablePath under INSTDIR");
  }
  if (!/TrimEnd/.test(text) || !/\[char\]92/.test(text)) {
    errors.push("must bound INSTDIR with a trailing separator so 0.5 does not match 0.50");
  }
  return errors;
}
