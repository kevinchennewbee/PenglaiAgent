import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { PenglaiError } from "@penglai/contracts";
import { AUTO_PRUNE_DEFAULT } from "../engine/protocol.js";

const SECRET =
  /api[_-]?key|app[_-]?secret|password\s*[:=]|private[_-]?key|-----BEGIN [A-Z ]*PRIVATE KEY-----|\bsk-[A-Za-z0-9_-]{8,}\b/i;

export function assertNotSecret(text: string): void {
  if (SECRET.test(text)) throw new PenglaiError("SECURITY_POLICY", "memory secret rejection");
}

export function assertNotPrivilegeClaim(text: string): boolean {
  return /设为\s*Owner|make me (an )?owner|grant (me )?admin/i.test(text);
}

export function digestText(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

export class GovernanceLedger {
  readonly db: DatabaseSync;

  constructor(path: string) {
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(path);
    this.db.exec(
      "CREATE TABLE IF NOT EXISTS ledger (id INTEGER PRIMARY KEY AUTOINCREMENT, action TEXT NOT NULL, record_id TEXT, detail TEXT NOT NULL, at TEXT NOT NULL)",
    );
  }

  append(action: string, recordId: string | null, detail: string): void {
    this.db
      .prepare("INSERT INTO ledger (action, record_id, detail, at) VALUES (?, ?, ?, ?)")
      .run(action, recordId, detail, new Date().toISOString());
  }

  autoPruneEnabled(): boolean {
    return AUTO_PRUNE_DEFAULT;
  }

  close(): void {
    this.db.close();
  }
}
