/**
 * Desktop Doctor — structured health checks (Host doctor.run).
 */

import { useCallback, useEffect, useState } from "react";
import type { PenglaiBridge } from "../bridge/types.js";
import { Icon } from "./Icon.js";
import { revealItemInDir } from "@tauri-apps/plugin-opener";

export type DoctorCheck = {
  check: string;
  status: "ok" | "warn" | "fail";
  message: string;
  fix?: string;
};

export function DoctorModal({
  open,
  bridge,
  onClose,
}: {
  open: boolean;
  bridge: PenglaiBridge | null;
  onClose: () => void;
}) {
  const [checks, setChecks] = useState<DoctorCheck[]>([]);
  const [summary, setSummary] = useState<{ ok: boolean; fail: number; warn: number; total: number } | null>(
    null,
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [exportPath, setExportPath] = useState<string | null>(null);

  const run = useCallback(async () => {
    if (!bridge) {
      setError("未连接 Host");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await bridge.rpc<{
        checks: DoctorCheck[];
        summary: { ok: boolean; fail: number; warn: number; total: number };
      }>("doctor.run", {});
      setChecks(result.checks ?? []);
      setSummary(result.summary ?? null);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }, [bridge]);

  const exportBundle = useCallback(async () => {
    if (!bridge) {
      setError("未连接 Host");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await bridge.rpc<{ path: string }>("doctor.export", {});
      setExportPath(result.path);
      await revealItemInDir(result.path);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }, [bridge]);

  useEffect(() => {
    if (open) void run();
  }, [open, run]);

  if (!open) return null;

  return (
    <div className="app-dialog-overlay" role="presentation" onMouseDown={onClose}>
      <div
        className="app-dialog modal doctor-modal"
        role="dialog"
        aria-modal="true"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <header className="app-dialog-head">
          <h2>Doctor · 环境自检</h2>
          <button type="button" className="icon-button" onClick={onClose} title="关闭">
            <Icon name="x" size={14} />
          </button>
        </header>
        <div className="app-dialog-body">
          {summary && (
            <p className="doctor-summary">
              {summary.ok ? "全部通过" : `失败 ${summary.fail} · 警告 ${summary.warn}`}
              <span className="muted"> / 共 {summary.total} 项</span>
            </p>
          )}
          {error && <p className="sub-error">{error}</p>}
          {exportPath && (
            <p className="doctor-exported">
              脱敏诊断包已导出：<code>{exportPath}</code>
            </p>
          )}
          <ul className="doctor-list">
            {checks.map((row) => (
              <li key={row.check} className={`doctor-row ${row.status}`}>
                <span className={`status-chip ${row.status}`}>{row.status}</span>
                <div>
                  <strong>{row.check}</strong>
                  <p>{row.message}</p>
                  {row.fix && <code className="doctor-fix">{row.fix}</code>}
                </div>
              </li>
            ))}
          </ul>
        </div>
        <footer className="app-dialog-actions">
          <button type="button" className="secondary-button" onClick={onClose}>
            关闭
          </button>
          <button type="button" className="secondary-button" disabled={busy} onClick={() => void exportBundle()}>
            {busy ? "处理中…" : "导出脱敏诊断包"}
          </button>
          <button type="button" className="primary-button" disabled={busy} onClick={() => void run()}>
            {busy ? "检查中…" : "重新检查"}
          </button>
        </footer>
      </div>
    </div>
  );
}
