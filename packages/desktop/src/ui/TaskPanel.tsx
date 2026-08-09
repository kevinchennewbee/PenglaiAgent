/**
 * Work-mode task surface: 目标与验收 · 进度与下一步 · 审批请求内联 ·
 * 项目信任开关 · 运行控制（启动/暂停/继续/取消）· steer 指令。所有事实
 * 来自 task.get bundle；执行中的活字由 useTaskStream 叠加。
 */

import { useState } from "react";
import type { Approval, ModelProfile, Project } from "@penglai/protocol";
import type { TaskStream } from "../hooks/useTaskStream.js";
import type { SubscriptionState } from "../bridge/types.js";
import {
  deriveProgress,
  runStatusLabel,
  taskStatusLabel,
  type TaskBundleLike,
} from "../state/workbench.js";
import { timeAgo } from "../state/format.js";
import { Icon } from "./Icon.js";

function ApprovalCard({
  approval,
  busy,
  onDecide,
}: {
  approval: Approval;
  busy: boolean;
  onDecide: (approval: Approval, verdict: "approve" | "reject", remember: boolean) => void;
}) {
  const [remember, setRemember] = useState(false);
  const isL2 = approval.capability.startsWith("l2:");
  return (
    <div className="approval-card">
      <div className="approval-head">
        <Icon name="seal" size={15} />
        <strong>{approval.action}</strong>
        <span className={`level-chip ${isL2 ? "l2" : "l3"}`}>{isL2 ? "L2 一键确认" : "L3 强制确认"}</span>
      </div>
      <p>{approval.reason}</p>
      <dl>
        <div><dt>能力</dt><dd>{approval.capability}</dd></div>
        <div><dt>请求方</dt><dd>{approval.requestedBy}</dd></div>
        <div><dt>时间</dt><dd>{timeAgo(approval.createdAt)}</dd></div>
      </dl>
      {isL2 && (
        <label className="remember-row">
          <input
            type="checkbox"
            checked={remember}
            onChange={(event) => setRemember(event.target.checked)}
          />
          <span>同类免问（本项目内此能力不再询问）</span>
        </label>
      )}
      <div className="approval-actions">
        <button
          className="primary-button"
          disabled={busy}
          onClick={() => onDecide(approval, "approve", remember)}
        >
          <Icon name="check" size={14} />批准
        </button>
        <button
          className="secondary-button danger"
          disabled={busy}
          onClick={() => onDecide(approval, "reject", false)}
        >
          <Icon name="x" size={14} />拒绝
        </button>
      </div>
    </div>
  );
}

export function TaskPanel({
  bundle,
  project,
  profiles,
  selectedProfileId,
  onProfileChange,
  busy,
  notice,
  taskStream,
  subState,
  onStart,
  onPause,
  onCancel,
  onSteer,
  onTrust,
  onUntrust,
  onDecideApproval,
}: {
  bundle: TaskBundleLike;
  project: Project | null;
  profiles: ModelProfile[];
  selectedProfileId: string;
  onProfileChange: (profileId: string) => void;
  busy: boolean;
  notice: string | null;
  taskStream: Pick<TaskStream, "liveOutput" | "liveTools">;
  subState: SubscriptionState | null;
  onStart: () => void;
  onPause: () => void;
  onCancel: () => void;
  onSteer: (text: string) => void;
  onTrust: () => void;
  onUntrust: () => void;
  onDecideApproval: (approval: Approval, verdict: "approve" | "reject", remember: boolean) => void;
}) {
  const [steerText, setSteerText] = useState("");
  const progress = deriveProgress(bundle);
  const { latestRun } = progress;
  const trusted = project?.trusted ?? false;

  return (
    <main className="task-surface">
      <header className="task-header">
        <div>
          <p>{project ? `${project.name} / 任务` : "任务"}</p>
          <h1>{bundle.task.title}</h1>
        </div>
        <div className="task-header-actions">
          <span className={`status-pill ${taskStatusLabel(bundle.task.status) === "执行中" ? "working" : ""}`}>
            <i />{taskStatusLabel(bundle.task.status)}
          </span>
          {subState === "reconnecting" && <span className="conn-chip reconnecting">重连中…</span>}
          <button
            className={trusted ? "trust-toggle trusted" : "trust-toggle"}
            onClick={trusted ? onUntrust : onTrust}
            disabled={busy}
            title={trusted ? "已信任 — 点击撤销信任" : "信任项目后才能执行"}
          >
            <Icon name="seal" size={14} />
            {trusted ? "已信任" : "未信任"}
          </button>
        </div>
      </header>

      <section className="task-content">
        <div className="panel-stack">
          <section className="info-card">
            <h3>目标与验收</h3>
            <p className="objective-text">{bundle.task.objective}</p>
            {bundle.task.acceptanceCriteria.length > 0 ? (
              <ul className="acceptance-list">
                {bundle.task.acceptanceCriteria.map((criterion, index) => (
                  <li key={index}><Icon name="check" size={13} /><span>{criterion}</span></li>
                ))}
              </ul>
            ) : (
              <small className="muted">未写验收标准 — 完成判定以目标与证据为准。</small>
            )}
            <div className="card-meta">
              <span>来源 {bundle.task.sourceChannel}</span>
              <span>创建于 {timeAgo(bundle.task.createdAt)}</span>
              {bundle.task.completedAt && <span>完成于 {timeAgo(bundle.task.completedAt)}</span>}
            </div>
          </section>

          <section className="info-card">
            <h3>进度与下一步</h3>
            <div className="progress-line">
              <span className={progress.live ? "pulse-ring" : "pulse-ring idle"}><i /></span>
              <strong>{progress.nextAction}</strong>
            </div>
            {latestRun && (
              <div className="run-summary">
                <span>运行 #{latestRun.sequence} · {runStatusLabel(latestRun.status)}</span>
                <span>{latestRun.kernel}</span>
                {latestRun.error && <span className="run-error">{latestRun.error}</span>}
              </div>
            )}
            {progress.latestSteps.length > 0 && (
              <ol className="step-list">
                {progress.latestSteps.map((step) => (
                  <li key={step.id} className={step.status}>
                    {step.status === "completed" ? (
                      <Icon name="check" size={13} />
                    ) : step.status === "running" ? (
                      <span className="mini-spinner" />
                    ) : (
                      <span className="step-dot" />
                    )}
                    <span>{step.title}</span>
                    <small>{step.summary || step.status}</small>
                  </li>
                ))}
              </ol>
            )}
            {taskStream.liveTools.length > 0 && (
              <ul className="tool-activity boxed">
                {taskStream.liveTools.map((tool, index) => (
                  <li key={tool.toolCallId ?? index} className={tool.ok === false ? "failed" : ""}>
                    {tool.ok === null ? (
                      <span className="mini-spinner" />
                    ) : tool.ok ? (
                      <Icon name="check" size={12} />
                    ) : (
                      <Icon name="x" size={12} />
                    )}
                    <span>{tool.toolName}</span>
                  </li>
                ))}
              </ul>
            )}
            <div className="run-controls">
              {!trusted && (
                <div className="trust-hint">
                  <Icon name="alert" size={14} />
                  <span>首次执行前需要信任项目：<code>{project?.rootPath}</code></span>
                  <button className="secondary-button" onClick={onTrust} disabled={busy}>
                    确认信任
                  </button>
                </div>
              )}
              {trusted && progress.canStart && (
                <div className="start-row">
                  <select value={selectedProfileId} onChange={(event) => onProfileChange(event.target.value)}>
                    {profiles.map((profile) => (
                      <option key={profile.id} value={profile.id}>{profile.label}</option>
                    ))}
                  </select>
                  <button className="secondary-button" onClick={onStart} disabled={busy || !selectedProfileId}>
                    <Icon name="play" size={14} />
                    {latestRun ? "重新跑任务 run" : "仅任务 run（高级）"}
                  </button>
                </div>
              )}
              <p className="muted" style={{ marginTop: 8 }}>
                日常请在<strong>对话</strong>里直接说需求；这里是遗留任务 run 面板，不是必经入口。
              </p>
              {progress.live && (
                <div className="live-row">
                  <button className="secondary-button" onClick={onPause} disabled={busy}>
                    <Icon name="pause" size={14} />暂停
                  </button>
                  <button className="secondary-button danger" onClick={onCancel} disabled={busy}>
                    <Icon name="stop" size={14} />取消
                  </button>
                </div>
              )}
            </div>
          </section>

          {progress.pendingApprovals.length > 0 && (
            <section className="info-card approvals">
              <h3>审批请求（{progress.pendingApprovals.length}）</h3>
              {progress.pendingApprovals.map((approval) => (
                <ApprovalCard
                  key={approval.id}
                  approval={approval}
                  busy={busy}
                  onDecide={onDecideApproval}
                />
              ))}
            </section>
          )}

          {taskStream.liveOutput && (
            <section className="info-card live-output">
              <h3>执行实况</h3>
              <pre>{taskStream.liveOutput}</pre>
            </section>
          )}

          {notice && <p className="panel-notice" role="status">{notice}</p>}
        </div>
      </section>

      <footer className="composer-wrap">
        <div className="composer">
          <textarea
            value={steerText}
            onChange={(event) => setSteerText(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                const text = steerText.trim();
                if (text) {
                  setSteerText("");
                  onSteer(text);
                }
              }
            }}
            placeholder={
              progress.live
                ? "给执行中的 run 追加指令（steer）…"
                : "启动后可以在这里给 run 追加指令"
            }
            rows={1}
            disabled={!progress.live}
          />
          <div className="composer-actions">
            <div />
            <button
              className="send-button"
              disabled={!progress.live || !steerText.trim()}
              onClick={() => {
                const text = steerText.trim();
                if (text) {
                  setSteerText("");
                  onSteer(text);
                }
              }}
              title="发送指令"
            >
              <Icon name="send" size={16} />
            </button>
          </div>
        </div>
        <p className="composer-note">变更文件、测试与产物在右侧证据轨 · 全部来自真实执行观测</p>
      </footer>
    </main>
  );
}
