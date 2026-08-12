/**
 * R4: Host verified context reference collector for one Episode.
 * Only refs actually returned by auto-retrieve or context tools are admitted.
 * Model text is never trusted as a source of structured references.
 */

import type { ContextReference } from "@penglai/protocol";
import type { ContextHit, ContextReadResult, ContextRefStatus } from "./types.js";

function toProtocolStatus(
  status: ContextRefStatus | undefined,
  stale?: boolean,
): ContextReference["status"] {
  if (status === "current" || status === "stale" || status === "revoked" || status === "unavailable") {
    return status;
  }
  return stale ? "stale" : "current";
}

export class EpisodeVerifiedRefCollector {
  private readonly byRef = new Map<string, ContextReference>();

  observeHits(hits: ContextHit[]): void {
    for (const hit of hits) {
      this.admit({
        ref: hit.contextRef,
        sourceId: hit.sourceId,
        title: hit.title,
        relativePath: hit.relativePath,
        location: hit.location ?? (hit.headingPath ? { headingPath: hit.headingPath } : null),
        documentSha256: hit.documentSha256,
        chunkSha256: hit.chunkSha256,
        status: "current",
      });
    }
  }

  observeRead(read: ContextReadResult): void {
    this.admit({
      ref: read.contextRef,
      sourceId: read.sourceId,
      title: read.title,
      relativePath: read.relativePath,
      location: read.location ?? (read.headingPath ? { headingPath: read.headingPath } : null),
      documentSha256: read.documentSha256,
      chunkSha256: read.chunkSha256,
      status: toProtocolStatus(read.status, read.stale),
    });
  }

  /**
   * Reject fabricated refs: only previously observed Host refs can appear.
   * Returns ordered list with Host-assigned ordinals (1-based).
   */
  snapshot(): ContextReference[] {
    const list = [...this.byRef.values()].sort((a, b) => a.ordinal - b.ordinal);
    return list.map((item, index) => ({ ...item, ordinal: index + 1 }));
  }

  has(ref: string): boolean {
    return this.byRef.has(ref);
  }

  clear(): void {
    this.byRef.clear();
  }

  private admit(input: Omit<ContextReference, "ordinal">): void {
    if (!input.ref || this.byRef.has(input.ref)) {
      // Keep first observation; status may be upgraded on read.
      if (this.byRef.has(input.ref)) {
        const prev = this.byRef.get(input.ref)!;
        this.byRef.set(input.ref, {
          ...prev,
          status: input.status,
          documentSha256: input.documentSha256 || prev.documentSha256,
          chunkSha256: input.chunkSha256 || prev.chunkSha256,
          location: input.location ?? prev.location,
        });
      }
      return;
    }
    this.byRef.set(input.ref, {
      ...input,
      ordinal: this.byRef.size + 1,
    });
  }
}
