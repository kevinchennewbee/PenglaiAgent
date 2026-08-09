/**
 * Right evidence rail (证据轨): 当前输出 · 变更文件（真实 diff）·
 * 测试/检查 · 产物 · token/成本用量。每一行都来自 Host 的观测记录 —
 * 工具自带的 diff、磁盘重读的文件、命令捕获的输出 — 零 LLM 自述。
 */

import { useState } from "react";
import type { BudgetDimensionStatus, Evidence, Project, UsageRow } from "@penglai/protocol";
import {
  dimensionLabel,
  dimensionSeverity,
  groupEvidence,
} from "../state/workbench.js";
import { formatRatio, formatTokens, timeAgo } from "../state/format.js";
import { Icon } from "./Icon.js";
import type { PenglaiBridge } from "../bridge/types.js";
import { openPath, revealItemInDir } from "@tauri-apps/plugin-opener";

function EvidenceText({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  const long = text.length > 240;
  return (
    <div className={open ? "evidence-detail open" : "evidence-detail"}>
      <pre>{open ? text : text.slice(0, 240)}</pre>
      {long && (
        <button className="detail-toggle" onClick={() => setOpen((value) => !value)}>
          {open ? "收起" : "展开"}
        </button>
      )}
    </div>
  );
}

function DiffItem({ item }: { item: Evidence }) {
  const path = typeof item.metadata.path === "string" ? item.metadata.path : item.title;
  const provenance =
    item.metadata.provenance === "disk-observed"
      ? "磁盘观测"
      : item.metadata.provenance === "tool-observed"
        ? "工具观测"
        : null;
  return (
    <div className="evidence-item diff">
      <div className="evidence-item-head">
        <Icon name="git" size={14} />
        <strong>{path}</strong>
        {provenance && <span className="provenance-chip">{provenance}</span>}
      </div>
      <EvidenceText text={item.summary} />
      <small>{timeAgo(item.createdAt)}</small>
    </div>
  );
}

function CheckItem({ item }: { item: Evidence }) {
  const ok = item.metadata.exitOk !== false;
  return (
    <div className={`evidence-item check ${ok ? "ok" : "failed"}`}>
      <div className="evidence-item-head">
        {ok ? <Icon name="check" size={14} /> : <Icon name="x" size={14} />}
        <strong>{item.title}</strong>
      </div>
      <EvidenceText text={item.summary} />
      <small>{ok ? "通过" : "失败"} · {timeAgo(item.createdAt)}</small>
    </div>
  );
}

function LogItem({ item }: { item: Evidence }) {
  return (
    <div className="evidence-item log">
      <div className="evidence-item-head">
        <Icon name="file" size={14} />
        <strong>{item.title}</strong>
      </div>
      <EvidenceText text={item.summary} />
      <small>{timeAgo(item.createdAt)}</small>
    </div>
  );
}

type ArtifactPreview = {
  path: string;
  name: string;
  format: string;
  text: string;
  truncated: boolean;
};

const PREVIEW_EXTENSIONS = new Set([
  "pdf", "docx", "xlsx", "pptx", "txt", "md", "csv", "tsv", "json", "yaml", "yml",
  "xml", "html", "htm", "rtf", "c", "cc", "cpp", "css", "go", "h", "hpp", "ini",
  "java", "js", "jsx", "kt", "log", "mjs", "php", "properties", "py", "rb", "rs", "sh",
  "sql", "swift", "toml", "ts", "tsx", "vue", "zsh",
]);

function canPreview(uri: string | null): boolean {
  if (!uri) return false;
  const clean = uri.split(/[?#]/, 1)[0] ?? "";
  const extension = clean.includes(".") ? clean.split(".").pop()?.toLowerCase() : null;
  return extension ? PREVIEW_EXTENSIONS.has(extension) : false;
}

function ArtifactItem({
  item,
  bridge,
  previewing,
  onPreview,
}: {
  item: Evidence;
  bridge: PenglaiBridge;
  previewing: boolean;
  onPreview: (item: Evidence) => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const resolve = async (): Promise<string> => {
    const row = await bridge.rpc<{ path: string }>("artifact.resolve", {
      taskId: item.taskId,
      evidenceId: item.id,
    });
    return row.path;
  };
  return (
    <div className="evidence-item artifact">
      <div className="evidence-item-head">
        <Icon name="file" size={14} />
        <strong>{item.title}</strong>
      </div>
      {item.uri && <small className="artifact-uri">{item.uri}</small>}
      {item.summary && <EvidenceText text={item.summary} />}
      {item.uri && (
        <div className="wizard-reentry" style={{ gap: 6 }}>
          {canPreview(item.uri) && (
            <button className="link-button" disabled={previewing} onClick={() => onPreview(item)}>
              {previewing ? "读取中…" : "预览"}
            </button>
          )}
          <button className="link-button" onClick={() => void resolve().then(openPath).catch((reason) => setError(String(reason)))}>打开</button>
          <button className="link-button" onClick={() => void resolve().then(revealItemInDir).catch((reason) => setError(String(reason)))}>在文件管理器中显示</button>
        </div>
      )}
      {error && <small className="wizard-warn">{error}</small>}
      <small>{timeAgo(item.createdAt)}</small>
    </div>
  );
}

function BudgetBar({ dimension, projects }: { dimension: BudgetDimensionStatus; projects: Project[] }) {
  const severity = dimensionSeverity(dimension);
  const percent = dimension.ratio === null ? 0 : Math.min(100, Math.round(dimension.ratio * 100));
  return (
    <div className={`budget-row ${severity}`}>
      <div className="budget-row-head">
        <span>{dimensionLabel(dimension.dimension, projects)}</span>
        <span>{formatTokens(dimension.usedTokens)} / {dimension.limitTokens === null ? "∞" : formatTokens(dimension.limitTokens)}</span>
      </div>
      <div className="budget-track">
        <div className="budget-fill" style={{ width: `${percent}%` }} />
      </div>
      <small>
        {dimension.tripped && !dimension.lifted
          ? "已熔断 — 新工作会降级为审批模式"
          : dimension.warned
            ? `已达 ${formatRatio(dimension.ratio)}（80% 预警线）`
            : dimension.limitTokens === null
              ? "未设上限"
              : `已用 ${formatRatio(dimension.ratio)}`}
      </small>
    </div>
  );
}

export function EvidenceRail({
  evidence,
  projects,
  usageRows,
  budgetDimensions,
  onClose,
  bridge,
}: {
  evidence: Evidence[];
  projects: Project[];
  usageRows: UsageRow[];
  budgetDimensions: BudgetDimensionStatus[];
  onClose: () => void;
  bridge: PenglaiBridge;
}) {
  const groups = groupEvidence(evidence);
  const [preview, setPreview] = useState<ArtifactPreview | null>(null);
  const [previewingId, setPreviewingId] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const requestPreview = async (item: Evidence): Promise<void> => {
    setPreviewingId(item.id);
    setPreviewError(null);
    try {
      const result = await bridge.rpc<ArtifactPreview>("artifact.preview", {
        taskId: item.taskId,
        evidenceId: item.id,
        maxChars: 80_000,
      });
      setPreview(result);
    } catch (error) {
      setPreviewError(error instanceof Error ? error.message : String(error));
    } finally {
      setPreviewingId(null);
    }
  };
  const todayUsage = usageRows.reduce((sum, row) => sum + row.inputTokens + row.outputTokens, 0);
  return (
    <aside className="evidence-rail">
      <header>
        <div><p>证据轨</p><h2>执行现场</h2></div>
        <button className="icon-button" onClick={onClose} title="收起证据轨">
          <Icon name="x" size={15} />
        </button>
      </header>
      <div className="evidence-scroll">
        <section className="evidence-section">
          <div className="evidence-heading"><span>当前输出</span><em>{groups.outputs.length}</em></div>
          {groups.outputs.slice(0, 6).map((item) => <LogItem key={item.id} item={item} />)}
          {groups.outputs.length === 0 && <p className="evidence-empty-copy">运行后这里出现回复与日志</p>}
        </section>

        <section className="evidence-section">
          <div className="evidence-heading"><span>变更文件</span><em>{groups.diffs.length}</em></div>
          {groups.diffs.slice(0, 8).map((item) => <DiffItem key={item.id} item={item} />)}
          {groups.diffs.length === 0 && <p className="evidence-empty-copy">暂无已观测变更 — 出现的 diff 都来自真实工具执行</p>}
        </section>

        <section className="evidence-section">
          <div className="evidence-heading"><span>测试 / 检查</span><em>{groups.tests.length + groups.commands.length}</em></div>
          {groups.tests.slice(0, 6).map((item) => <CheckItem key={item.id} item={item} />)}
          {groups.commands.slice(0, 4).map((item) => <CheckItem key={item.id} item={item} />)}
          {groups.tests.length + groups.commands.length === 0 && (
            <p className="evidence-empty-copy">暂无检查记录</p>
          )}
        </section>

        <section className="evidence-section">
          <div className="evidence-heading"><span>产物</span><em>{groups.artifacts.length}</em></div>
          {groups.artifacts.slice(0, 6).map((item) => (
            <ArtifactItem
              key={item.id}
              item={item}
              bridge={bridge}
              previewing={previewingId === item.id}
              onPreview={(row) => void requestPreview(row)}
            />
          ))}
          {previewError && <p className="sub-error">预览失败：{previewError}</p>}
          {groups.artifacts.length === 0 && <p className="evidence-empty-copy">暂无产物</p>}
        </section>

        <section className="evidence-section">
          <div className="evidence-heading"><span>token / 成本用量</span></div>
          {usageRows.length > 0 ? (
            <div className="usage-rows">
              <div className="usage-total">
                <span>本任务累计</span>
                <strong>{formatTokens(todayUsage)}</strong>
              </div>
              {usageRows.slice(0, 5).map((row) => (
                <div className="usage-row" key={`${row.day}-${row.mode}-${row.projectId}`}>
                  <span>{row.day} · {row.mode === "work" ? "工作" : "对话"}</span>
                  <span>{formatTokens(row.inputTokens + row.outputTokens)}（{row.requests} 次）</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="evidence-empty-copy">还没有用量记录</p>
          )}
          {budgetDimensions.map((dimension) => (
            <BudgetBar key={dimension.dimension} dimension={dimension} projects={projects} />
          ))}
        </section>
      </div>
      {preview && (
        <div className="app-dialog-overlay artifact-preview-overlay" role="presentation" onMouseDown={() => setPreview(null)}>
          <div
            className="app-dialog modal artifact-preview-modal"
            role="dialog"
            aria-modal="true"
            aria-label={`${preview.name} 预览`}
            onMouseDown={(event) => event.stopPropagation()}
          >
            <header className="app-dialog-head">
              <div>
                <h2>{preview.name}</h2>
                <p>{preview.format.toUpperCase()} · 应用内只读预览</p>
              </div>
              <button type="button" className="icon-button" onClick={() => setPreview(null)} title="关闭预览">
                <Icon name="x" size={14} />
              </button>
            </header>
            <div className="artifact-preview-body">
              <pre>{preview.text || "（文档中没有可提取的文本）"}</pre>
            </div>
            <footer className="app-dialog-actions">
              {preview.truncated && <span className="wizard-warn">内容较长，仅显示前 80,000 个字符</span>}
              <button type="button" className="secondary-button" onClick={() => setPreview(null)}>关闭</button>
              <button type="button" className="primary-button" onClick={() => void openPath(preview.path)}>用系统应用打开</button>
            </footer>
          </div>
        </div>
      )}
    </aside>
  );
}
