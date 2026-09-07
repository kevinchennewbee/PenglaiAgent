import { PenglaiError } from "@penglai/contracts";
import { readPluginTransactionDiagnostic } from "./profile-tx.js";

const SECRET = /api[_-]?key|token|password|secret|authorization|private key/i;
const PATH = /(?:\/(?:Users|home|var|tmp|private)|[A-Za-z]:\\)/;
const QR = /data:image\/|otpauth:|\bqr\b/i;

export interface RedactedCenterDiagnostics {
  schema: 1;
  generatedAt: string;
  plugins: Array<{
    id: string;
    desired: string;
    installed: string;
    loaded: boolean;
    healthy: boolean;
    actual: string;
    recovery?: string;
  }>;
  transaction: ReturnType<typeof readPluginTransactionDiagnostic>;
}

export function exportRedactedCenterDiagnostics(input: {
  catalog: Array<{
    id: string;
    desired?: string;
    installed?: string;
    loaded?: boolean;
    healthy?: boolean;
    actual?: string;
    error?: string;
  }>;
  txDir?: string;
  now?: () => number;
}): RedactedCenterDiagnostics {
  const plugins = input.catalog.map((row) => {
    if (looksPrivate(row.id) || looksPrivate(row.error)) {
      throw new PenglaiError("SECURITY_POLICY", "CENTER_DIAGNOSTIC_REDACTION");
    }
    return {
      id: row.id,
      desired: String(row.desired ?? ""),
      installed: String(row.installed ?? ""),
      loaded: row.loaded === true,
      healthy: row.healthy === true,
      actual: String(row.actual ?? "unknown"),
      ...(row.healthy === false
        ? { recovery: row.loaded ? "restart-runtime" : "reinstall-signed-catalog" }
        : {}),
    };
  });
  const transaction = input.txDir ? readPluginTransactionDiagnostic(input.txDir) : null;
  const json = JSON.stringify({ plugins, transaction });
  if (SECRET.test(json) || PATH.test(json) || QR.test(json)) {
    throw new PenglaiError("SECURITY_POLICY", "CENTER_DIAGNOSTIC_REDACTION");
  }
  return {
    schema: 1,
    generatedAt: new Date(input.now?.() ?? Date.now()).toISOString(),
    plugins,
    transaction,
  };
}

function looksPrivate(value: unknown): boolean {
  if (typeof value !== "string" || !value) return false;
  return SECRET.test(value) || PATH.test(value) || QR.test(value);
}
