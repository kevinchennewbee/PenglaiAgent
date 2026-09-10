/**
 * Product overlay for the official directory-picker seam.
 * cordis-plugin-include.applyEntryPatches treats patch.name as an identity
 * guard, not a rename. Disable auto by matching id+name, then insert a
 * distinct browse host/client pair with product-owned IDs.
 */

export const OFFICIAL_DIRECTORY_PICKER_AUTO = "@deepseek-ai/dsh-host-directory-picker-auto";
export const OFFICIAL_DIRECTORY_PICKER_HOST = "@deepseek-ai/dsh-host-directory-picker-browse";
export const OFFICIAL_DIRECTORY_PICKER_SURFACE = "@deepseek-ai/dsh-client-ui-directory-picker-browse";
export const OFFICIAL_DIRECTORY_PICKER_NATIVE_HOST = "@deepseek-ai/dsh-host-directory-picker-native";
export const OFFICIAL_DIRECTORY_PICKER_NATIVE_CLIENT = "@deepseek-ai/dsh-client-ui-directory-picker-native";
export const OFFICIAL_DIRECTORY_PICKER_ID = "directory-picker";
export const PENGLAI_DIRECTORY_PICKER_HOST_ID = "penglai-directory-picker";
export const PENGLAI_DIRECTORY_PICKER_SURFACE_ID = "penglai-directory-picker-ui";

const OWNED_PICKER_IDS = new Set([
  PENGLAI_DIRECTORY_PICKER_HOST_ID,
  PENGLAI_DIRECTORY_PICKER_SURFACE_ID,
  "ui-directory-picker",
]);

const OWNED_PICKER_PACKAGES = new Set([
  OFFICIAL_DIRECTORY_PICKER_HOST,
  OFFICIAL_DIRECTORY_PICKER_SURFACE,
  OFFICIAL_DIRECTORY_PICKER_NATIVE_HOST,
  OFFICIAL_DIRECTORY_PICKER_NATIVE_CLIENT,
]);

const DISABLE_AUTO_BLOCK = [
  `- id: ${OFFICIAL_DIRECTORY_PICKER_ID}`,
  `  name: "${OFFICIAL_DIRECTORY_PICKER_AUTO}"`,
  "  disabled: true",
].join("\n");

const BROWSE_HOST_ITEM = [
  `    - id: ${PENGLAI_DIRECTORY_PICKER_HOST_ID}`,
  `      name: "${OFFICIAL_DIRECTORY_PICKER_HOST}"`,
].join("\n");

const BROWSE_SURFACE_ITEM = [
  `    - id: ${PENGLAI_DIRECTORY_PICKER_SURFACE_ID}`,
  `      name: "${OFFICIAL_DIRECTORY_PICKER_SURFACE}"`,
].join("\n");

function unquoteYaml(value: string): string {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function field(line: string, key: string): string | undefined {
  const stripped = line.replace(/^\s*-\s+/, "");
  const match = stripped.match(new RegExp(String.raw`^\s*${key}:\s*(.+?)\s*$`));
  if (!match?.[1]) return undefined;
  return unquoteYaml(match[1]);
}

function splitTopLevelYamlList(text: string): string[] {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const items: string[][] = [];
  let current: string[] = [];
  const flush = (): void => {
    if (current.some((line) => line.trim().length > 0)) items.push(current);
    current = [];
  };
  for (const line of lines) {
    if (line.startsWith("- ")) {
      flush();
      current.push(line);
      continue;
    }
    current.push(line);
  }
  flush();
  return items.map((block) => block.join("\n").replace(/\n+$/, ""));
}

interface InsertRow {
  id: string | undefined;
  name: string | undefined;
  disabled: boolean;
  raw: string;
}

function splitInsertRows(insertRaw: string): { header: string; rows: InsertRow[] } {
  const lines = insertRaw.split("\n");
  const header: string[] = [];
  const rowBlocks: string[][] = [];
  let row: string[] = [];
  const flushRow = (): void => {
    if (row.some((line) => line.trim().length > 0)) rowBlocks.push(row);
    row = [];
  };
  let inRows = false;
  for (const line of lines) {
    if (/^    - /.test(line)) {
      inRows = true;
      flushRow();
      row.push(line);
      continue;
    }
    if (!inRows) {
      header.push(line);
      continue;
    }
    row.push(line);
  }
  flushRow();
  return {
    header: header.join("\n"),
    rows: rowBlocks.map((block) => {
      const raw = block.join("\n");
      return {
        id: field(block[0] ?? "", "id") ?? field(block.find((line) => field(line, "id")) ?? "", "id"),
        name: block.map((line) => field(line, "name")).find((value) => value !== undefined),
        disabled: block.map((line) => field(line, "disabled")).find((value) => value !== undefined) === "true",
        raw,
      };
    }),
  };
}

function inspectTopLevel(raw: string): {
  kind: "insert" | "patch";
  id: string | undefined;
  name: string | undefined;
  disabled: boolean;
} {
  const trimmed = raw.replace(/^\s*#.*$/gm, "").trim();
  if (trimmed.startsWith("- insert:")) {
    return { kind: "insert", id: undefined, name: undefined, disabled: false };
  }
  return {
    kind: "patch",
    id: field(raw.split("\n").find((line) => line.startsWith("- id:")) ?? "", "id"),
    name: raw.split("\n").map((line) => field(line, "name")).find((value) => value !== undefined),
    disabled: raw.split("\n").map((line) => field(line, "disabled")).find((value) => value !== undefined) === "true",
  };
}

function isOwnedPickerRow(id: string | undefined, name: string | undefined): boolean {
  if (id && OWNED_PICKER_IDS.has(id)) return true;
  if (name && OWNED_PICKER_PACKAGES.has(name)) return true;
  return false;
}

function isCanonicalDisableAuto(raw: string): boolean {
  const info = inspectTopLevel(raw);
  return (
    info.kind === "patch" &&
    info.id === OFFICIAL_DIRECTORY_PICKER_ID &&
    info.name === OFFICIAL_DIRECTORY_PICKER_AUTO &&
    info.disabled === true
  );
}

function rebuildInsert(header: string, rows: InsertRow[]): string {
  const body = rows.map((row) => row.raw.replace(/\n+$/, "")).join("\n");
  const head = header.replace(/\n+$/, "");
  return body ? `${head}\n${body}` : head;
}

/**
 * Normalize a product cordis overlay so official applyEntryPatches mounts
 * exactly one enabled browse host/client pair and disables auto-native.
 */
export function pinOfficialBrowseDirectoryPickerPatch(text: string): { text: string; changed: boolean } {
  const original = text.replace(/\r\n/g, "\n");
  const items = splitTopLevelYamlList(original);
  const kept: string[] = [];
  let disablePresent = false;
  let firstInsertIndex = -1;

  for (const item of items) {
    const info = inspectTopLevel(item);
    if (info.kind === "insert") {
      const parsed = splitInsertRows(item);
      const rows = parsed.rows.filter((row) => !isOwnedPickerRow(row.id, row.name));
      if (rows.length === 0) continue;
      if (firstInsertIndex < 0) firstInsertIndex = kept.length;
      kept.push(rebuildInsert(parsed.header, rows));
      continue;
    }
    if (info.id === OFFICIAL_DIRECTORY_PICKER_ID) {
      if (isCanonicalDisableAuto(item) && !disablePresent) {
        kept.push(DISABLE_AUTO_BLOCK);
        disablePresent = true;
      }
      continue;
    }
    if (isOwnedPickerRow(info.id, info.name)) continue;
    kept.push(item);
  }

  const addition = `${BROWSE_HOST_ITEM}\n${BROWSE_SURFACE_ITEM}`;
  const firstInsert = firstInsertIndex >= 0 ? kept[firstInsertIndex] : undefined;
  if (firstInsert !== undefined && firstInsertIndex >= 0) {
    kept[firstInsertIndex] = `${firstInsert.replace(/\n+$/, "")}\n${addition}`;
  } else {
    kept.push(`- insert:\n${addition}`);
  }
  if (!disablePresent) kept.push(DISABLE_AUTO_BLOCK);

  const next = `${kept.join("\n").replace(/\n+$/, "")}\n`;
  const normalizedOriginal = original.endsWith("\n") || original.length === 0 ? original : `${original}\n`;
  return { text: next, changed: next !== normalizedOriginal };
}
