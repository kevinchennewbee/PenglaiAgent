import {
  CredentialProvider,
  credentialRef,
  type CredentialInfo,
  type CredentialKey,
  type CredentialRecord,
  type CredentialRecordEntry,
  type CredentialRecordInfo,
  type CredentialRef,
  type ResolvedCredential,
} from "@deepseek-ai/dsh-credentials";
import type { Context } from "@deepseek-ai/cordis";

export class MemoryCredentialProvider extends CredentialProvider {
  private readonly values = new Map<string, string>();
  private readonly records = new Map<CredentialKey, CredentialRecord>();

  constructor(ctx: Context) {
    super(ctx);
  }

  async resolve(ref: CredentialRef): Promise<ResolvedCredential | undefined> {
    const value = this.values.get(ref);
    if (!value) return undefined;
    return { value, source: "memory" };
  }

  async describe(ref: CredentialRef): Promise<CredentialInfo> {
    const configured = this.values.has(ref);
    if (configured) return { configured: true, source: "memory", writable: true };
    return { configured: false, writable: true };
  }

  async set(ref: CredentialRef, value: string): Promise<void> {
    if (!value.trim()) throw new TypeError("empty credential");
    this.values.set(ref, value);
    this.notifyUpdated(ref);
  }

  async unset(ref: CredentialRef): Promise<void> {
    this.values.delete(ref);
    this.notifyUpdated(ref);
  }

  async readRecord(key: CredentialKey): Promise<CredentialRecord | undefined> {
    return this.records.get(key);
  }

  async describeRecord(key: CredentialKey): Promise<CredentialRecordInfo> {
    const record = this.records.get(key);
    if (!record) return { configured: false, writable: true };
    return { configured: true, kind: record.kind, writable: true };
  }

  async listRecords(): Promise<readonly CredentialRecordEntry[]> {
    return [...this.records.entries()].map(([key, record]) => ({ key, kind: record.kind }));
  }

  async modifyRecord(
    key: CredentialKey,
    mutate: (current: CredentialRecord | undefined) => Promise<CredentialRecord | undefined>,
  ): Promise<CredentialRecord | undefined> {
    const next = await mutate(this.records.get(key));
    if (next === undefined) return this.records.get(key);
    this.records.set(key, next);
    this.notifyRecordUpdated(key);
    return next;
  }

  async deleteRecord(key: CredentialKey): Promise<void> {
    if (!this.records.delete(key)) return;
    this.notifyRecordUpdated(key);
  }
}

export { credentialRef };
