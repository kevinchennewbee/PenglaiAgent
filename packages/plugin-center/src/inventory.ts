export interface InventoryRow {
  entryId?: string;
  id?: string;
  name?: string;
  moduleName?: string;
  disabled?: boolean;
  enabled?: boolean;
  fiberPhase?: string | null;
}

export function normalizeInventory(raw: unknown): InventoryRow[] {
  if (Array.isArray(raw)) return raw as InventoryRow[];
  if (raw && typeof raw === "object" && "entries" in raw) {
    const entries = (raw as { entries?: InventoryRow[] }).entries;
    return Array.isArray(entries) ? entries : [];
  }
  return [];
}

export function rowMatches(row: InventoryRow, id: string): boolean {
  if (row.moduleName === id || row.name === id || row.id === id) return true;
  const entryTail = row.entryId?.split(":").at(-1);
  return entryTail === id || entryTail === id.replace("@penglai/", "penglai-");
}

export function rowLoaded(row: InventoryRow | undefined): boolean {
  if (!row) return false;
  if (row.disabled === true || row.enabled === false) return false;
  return row.fiberPhase === "active";
}
