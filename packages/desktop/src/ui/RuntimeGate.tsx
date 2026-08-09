/**
 * Startup gate: connecting / error / incompatible / reconnecting states.
 * 空、加载、错误、重启各态可恢复 — retry always re-probes the handshake.
 */

import type { ConnectionPhase } from "../hooks/useHostConnection.js";
import { Icon } from "./Icon.js";

export function RuntimeGate({
  phase,
  error,
  protocol,
  onRetry,
}: {
  phase: ConnectionPhase;
  error: string | null;
  protocol: string | null;
  onRetry: () => void;
}) {
  const failed = phase === "error" || phase === "incompatible";
  const recovering = phase === "reconnecting";
  return (
    <main className="runtime-gate">
      <section className="runtime-card">
        <div className="brand-seal large">蓬</div>
        <p className="eyebrow">
          {failed ? "启动检查" : recovering ? "连接恢复中" : "安全启动"}
        </p>
        <h1>
          {failed
            ? phase === "incompatible"
              ? "桌面与 Host 版本不兼容"
              : "蓬莱 Host 暂未就绪"
            : recovering
              ? "正在重新连接本机 Host"
              : "正在准备你的工作台"}
        </h1>
        <p className="runtime-lead">
          {failed
            ? (error ?? "桌面端与本机 Host 暂时无法建立兼容连接。")
            : recovering
              ? "Host 可能重启了；恢复后所有面板会自动重新加载，数据都在本机。"
              : "正在验证本机 Host 运行时、协议版本与本地数据。"}
        </p>
        <div className="startup-checks">
          <div className="startup-row complete">
            <span><Icon name="check" size={14} /></span>
            <div><strong>桌面应用</strong><small>签名与资源已加载</small></div>
          </div>
          <div className={`startup-row ${failed ? "error" : recovering ? "active" : "active"}`}>
            <span>{failed ? "!" : <i className="mini-spinner" />}</span>
            <div>
              <strong>Host 运行时</strong>
              <small>{failed ? (protocol ?? "握手未通过") : "验证版本与协议兼容"}</small>
            </div>
          </div>
          <div className={`startup-row ${phase === "online" ? "complete" : "pending"}`}>
            <span>{phase === "online" ? <Icon name="check" size={14} /> : null}</span>
            <div><strong>本地数据</strong><small>项目、会话、证据与预算</small></div>
          </div>
        </div>
        {failed && (
          <button className="primary-button recovery" onClick={onRetry}>
            <Icon name="refresh" size={15} />重新检查
          </button>
        )}
        <p className="runtime-footnote">蓬莱 0.4 · 本地优先 · 数据留在你的设备</p>
      </section>
    </main>
  );
}
