/**
 * 审批待办（全局）：所有项目的 pending 审批集中处理。批准/拒绝走
 * approval.approve / approval.reject RPC；L2 可选同类免问（落项目级 grant）。
 */

import { useState } from "react";
import type { Approval, Project, Task } from "@penglai/protocol";
import { timeAgo } from "../state/format.js";
import { Icon } from "./Icon.js";

export function ApprovalsPanel({
  approvals,
  projects,
  tasksByProject,
  busy,
  onDecide,
  onOpenTask,
}: {
  approvals: Approval[];
  projects: Project[];
  tasksByProject: Map<string, Task[]>;
  busy: boolean;
  onDecide: (approval: Approval, verdict: "approve" | "reject", remember: boolean) => void;
  onOpenTask: (taskId: string) => void;
}) {
  const [rememberMap, setRememberMap] = useState<Map<string, boolean>>(new Map());
  const taskOf = (approval: Approval): Task | null => {
    for (const project of projects) {
      const task = (tasksByProject.get(project.id) ?? []).find(
        (candidate) => candidate.id === approval.taskId,
      );
      if (task) return task;
    }
    return null;
  };
  const projectOf = (approval: Approval): Project | null => {
    const task = taskOf(approval);
    return task ? (projects.find((project) => project.id === task.projectId) ?? null) : null;
  };

  return (
    <main className="task-surface">
      <header className="task-header">
        <div>
          <p>审批四级制 · L2 一键确认 / L3 强制确认</p>
          <h1>审批待办</h1>
        </div>
        <div className="task-header-actions">
          <span className="status-pill"><i />{approvals.length} 项待决</span>
        </div>
      </header>
      <section className="task-content">
        <div className="panel-stack">
          {approvals.length === 0 && (
            <div className="new-task-intro">
              <div className="brand-seal intro">蓬</div>
              <h2>没有待审批的请求</h2>
              <p>越狱、外发、不可逆操作会先停在这里等你决定；全部留痕可回放。</p>
            </div>
          )}
          {approvals.map((approval) => {
            const task = taskOf(approval);
            const project = projectOf(approval);
            const isL2 = approval.capability.startsWith("l2:");
            const remember = rememberMap.get(approval.id) ?? false;
            return (
              <section className="info-card" key={approval.id}>
                <div className="approval-head">
                  <Icon name="seal" size={15} />
                  <strong>{approval.action}</strong>
                  <span className={`level-chip ${isL2 ? "l2" : "l3"}`}>
                    {isL2 ? "L2" : "L3"}
                  </span>
                </div>
                <p>{approval.reason}</p>
                <dl>
                  <div><dt>能力</dt><dd>{approval.capability}</dd></div>
                  <div><dt>项目</dt><dd>{project?.name ?? "—"}</dd></div>
                  <div>
                    <dt>任务</dt>
                    <dd>
                      {task ? (
                        <button className="link-button" onClick={() => onOpenTask(task.id)}>
                          {task.title}
                        </button>
                      ) : (
                        approval.taskId.slice(0, 8)
                      )}
                    </dd>
                  </div>
                  <div><dt>请求方</dt><dd>{approval.requestedBy}</dd></div>
                  <div><dt>时间</dt><dd>{timeAgo(approval.createdAt)}</dd></div>
                </dl>
                {isL2 && (
                  <label className="remember-row">
                    <input
                      type="checkbox"
                      checked={remember}
                      onChange={(event) =>
                        setRememberMap((current) => {
                          const next = new Map(current);
                          next.set(approval.id, event.target.checked);
                          return next;
                        })
                      }
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
              </section>
            );
          })}
        </div>
      </section>
    </main>
  );
}
