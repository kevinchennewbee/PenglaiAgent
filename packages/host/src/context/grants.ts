/**
 * R1: Opaque single-use short-TTL directory grants for Desktop → Host.
 *
 * Preferred flow (native):
 *   Tauri picks directory → Host-authenticated native register OR grant mint
 *   → Host redeems grant once → source metadata only returns to renderer.
 *
 * Grants never travel as trusted path from the renderer: redemption requires
 * the grant id + matching session/scope/project binding, and is single-use.
 */

import crypto from "node:crypto";

export interface ContextPathGrant {
  grantId: string;
  rootPath: string;
  scopeType: "global" | "project";
  projectId: string | null;
  sessionId: string;
  nonce: string;
  createdAt: number;
  expiresAt: number;
  used: boolean;
}

export interface MintGrantInput {
  rootPath: string;
  scopeType: "global" | "project";
  projectId?: string | null;
  sessionId: string;
  /** TTL ms; default 60s. */
  ttlMs?: number;
}

export class ContextGrantTable {
  private readonly grants = new Map<string, ContextPathGrant>();
  private readonly defaultTtlMs: number;

  constructor(options?: { defaultTtlMs?: number }) {
    this.defaultTtlMs = options?.defaultTtlMs ?? 60_000;
  }

  mint(input: MintGrantInput): ContextPathGrant {
    const now = Date.now();
    const grant: ContextPathGrant = {
      grantId: `ctxgrant_${now.toString(36)}_${crypto.randomBytes(12).toString("hex")}`,
      rootPath: input.rootPath,
      scopeType: input.scopeType,
      projectId: input.scopeType === "project" ? input.projectId ?? null : null,
      sessionId: input.sessionId,
      nonce: crypto.randomBytes(16).toString("hex"),
      createdAt: now,
      expiresAt: now + Math.max(1, input.ttlMs ?? this.defaultTtlMs),
      used: false,
    };
    this.grants.set(grant.grantId, grant);
    return grant;
  }

  /**
   * Redeem a grant. Single-use: successful redemption marks used and removes
   * the live entry. Failures for unknown/expired/mismatched grants throw
   * stable errors without leaking other grants' paths.
   */
  redeem(input: {
    grantId: string;
    sessionId: string;
    scopeType: "global" | "project";
    projectId?: string | null;
    nonce?: string | null;
  }): { rootPath: string; scopeType: "global" | "project"; projectId: string | null } {
    const grant = this.grants.get(input.grantId);
    if (!grant || grant.used) {
      throw Object.assign(new Error("invalid or already used context grant"), {
        code: "context_grant_invalid",
      });
    }
    if (Date.now() > grant.expiresAt) {
      this.grants.delete(input.grantId);
      throw Object.assign(new Error("context grant expired"), {
        code: "context_grant_expired",
      });
    }
    if (grant.sessionId !== input.sessionId) {
      throw Object.assign(new Error("context grant session mismatch"), {
        code: "context_grant_session",
      });
    }
    if (grant.scopeType !== input.scopeType) {
      throw Object.assign(new Error("context grant scope mismatch"), {
        code: "context_grant_scope",
      });
    }
    if (grant.scopeType === "project") {
      if ((grant.projectId ?? null) !== (input.projectId ?? null)) {
        throw Object.assign(new Error("context grant project mismatch"), {
          code: "context_grant_project",
        });
      }
    }
    if (input.nonce && input.nonce !== grant.nonce) {
      throw Object.assign(new Error("context grant nonce mismatch"), {
        code: "context_grant_nonce",
      });
    }
    grant.used = true;
    this.grants.delete(input.grantId);
    return {
      rootPath: grant.rootPath,
      scopeType: grant.scopeType,
      projectId: grant.projectId,
    };
  }

  /** Test helper */
  peek(grantId: string): ContextPathGrant | null {
    return this.grants.get(grantId) ?? null;
  }

  size(): number {
    return this.grants.size;
  }

  clear(): void {
    this.grants.clear();
  }
}
