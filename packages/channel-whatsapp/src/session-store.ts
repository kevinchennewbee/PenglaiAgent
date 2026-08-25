import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export interface WhatsAppSessionStore {
  read(): Promise<Uint8Array | undefined>;
  write(bytes: Uint8Array): Promise<void>;
  wipe(): Promise<void>;
}

const MAGIC = Buffer.from("PLWA1");

/**
 * AES-256-GCM private session store. The key stays in Vault; the file is not
 * a Baileys plaintext auth directory.
 */
export class EncryptedWhatsAppSessionStore implements WhatsAppSessionStore {
  constructor(
    private readonly filePath: string,
    private readonly key: Buffer,
  ) {
    if (this.key.length !== 32) throw new Error("whatsapp session key must be 32 bytes");
  }

  async read(): Promise<Uint8Array | undefined> {
    let raw: Buffer;
    try {
      raw = readFileSync(this.filePath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw error;
    }
    if (raw.length < MAGIC.length + 12 + 16 || !raw.subarray(0, MAGIC.length).equals(MAGIC)) return undefined;
    const iv = raw.subarray(MAGIC.length, MAGIC.length + 12);
    const tag = raw.subarray(raw.length - 16);
    const ciphertext = raw.subarray(MAGIC.length + 12, raw.length - 16);
    const decipher = createDecipheriv("aes-256-gcm", this.key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  }

  async write(bytes: Uint8Array): Promise<void> {
    mkdirSync(dirname(this.filePath), { recursive: true, mode: 0o700 });
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.key, iv);
    const encrypted = Buffer.concat([cipher.update(bytes), cipher.final()]);
    const tag = cipher.getAuthTag();
    writeFileSync(this.filePath, Buffer.concat([MAGIC, iv, encrypted, tag]), { mode: 0o600 });
  }

  async wipe(): Promise<void> {
    try {
      rmSync(this.filePath, { force: true });
    } catch {
      /* already gone */
    }
  }
}
