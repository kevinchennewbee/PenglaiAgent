import { CredentialProvider, credentialRef, type CredentialInfo, type CredentialRef, type ResolvedCredential } from "@deepseek-ai/dsh-credentials";
import type { Context } from "@deepseek-ai/cordis";

export class MemoryCredentialProvider extends CredentialProvider {
  private readonly values = new Map<string, string>();

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
}

export { credentialRef };
