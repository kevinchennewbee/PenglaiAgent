/**
 * Left navigation (ZCode-like):
 * - one conversation surface
 * - projects group workspaces; clicking a project/task opens the conversation
 *   anchored there — NOT a separate "start run" task universe
 */

import { useMemo, useState } from "react";
import type { Conversation, Project, Task } from "@penglai/protocol";
import {
  collectActiveTasks,
  conversationBadge,
  taskStateClass,
  taskStatusLabel,
  type ProjectNode,
} from "../state/workbench.js";
import { timeAgo } from "../state/format.js";
import { Icon } from "./Icon.js";

export type Selection =
  | { kind: "conversation"; id: string | null }
  | { kind: "task"; id: string }
  | { kind: "active" }
  | { kind: "approvals" }
  | { kind: "channels" }
  | { kind: "abilities" }
  | { kind: "settings" };

export function Sidebar({
  nodes,
  conversations,
  pendingCount,
  selection,
  expanded,
  connected,
  onSelect,
  onNewChat,
  onAddProject,
  onToggleProject,
  onOpenProjectWorkspace,
  onOpenTaskWorkspace,
  onRenameConversation,
  onArchiveConversation,
}: {
  nodes: ProjectNode[];
  conversations: Conversation[];
  pendingCount: number;
  selection: Selection;
  expanded: Set<string>;
  connected: boolean;
  onSelect: (selection: Selection) => void;
  onNewChat: () => void;
  onAddProject: () => void;
  onToggleProject: (projectId: string) => void;
  /** Open the conversation (or create) for this project workspace. */
  onOpenProjectWorkspace: (project: Project) => void;
  /** Open the conversation that owns this task anchor. */
  onOpenTaskWorkspace: (task: Task) => void;
  onRenameConversation: (conversation: Conversation) => void;
  onArchiveConversation: (conversation: Conversation) => void;
}) {
  const [conversationQuery, setConversationQuery] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const visibleConversations = useMemo(() => {
    const query = conversationQuery.trim().toLowerCase();
    return conversations.filter((conversation) => {
      if (showArchived ? conversation.status !== "archived" : conversation.status === "archived") return false;
      return !query || conversation.title.toLowerCase().includes(query) || conversation.id.toLowerCase().includes(query);
    });
  }, [conversationQuery, conversations, showArchived]);
  const activeTasks = collectActiveTasks(nodes);
  const navItem = (
    key: Selection["kind"],
    label: string,
    icon: React.ReactNode,
    badge?: number,
  ) => (
    <button
      className={selection.kind === key ? "active" : ""}
      onClick={() => onSelect({ kind: key } as Selection)}
      aria-label={label}
    >
      {icon}
      <span>{label}</span>
      {badge !== undefined && badge > 0 && <em className="nav-badge">{badge}</em>}
    </button>
  );
  return (
    <aside className="sidebar">
      <div className="brand-row">
        <div className="brand-seal">蓬</div>
        <div className="brand-copy">
          <strong>蓬莱</strong>
          <span>
            <i className={connected ? "online-dot" : "online-dot off"} />
            {connected ? "本机已连接" : "连接中断"}
          </span>
        </div>
      </div>

      <nav className="primary-nav" aria-label="主导航">
        <button className="new-task-button" onClick={onNewChat} aria-label="新对话">
          <Icon name="plus" size={17} />
          <span>新对话</span>
        </button>
        {navItem("active", "进行中", <Icon name="wave" size={16} />, activeTasks.length)}
        {navItem("approvals", "审批待办", <Icon name="seal" size={16} />, pendingCount)}
        {navItem("channels", "渠道", <Icon name="message" size={16} />)}
        {navItem("abilities", "能力", <Icon name="blocks" size={16} />)}
        {navItem("settings", "设置", <Icon name="settings" size={16} />)}
      </nav>

      {conversations.length > 0 && (
        <div className="sidebar-section">
          <div className="section-heading">
            <span>{showArchived ? "已归档" : "全部对话"}</span>
            <button className="link-button" onClick={() => setShowArchived((value) => !value)}>{showArchived ? "返回" : "归档"}</button>
          </div>
          <input
            className="conversation-search"
            value={conversationQuery}
            onChange={(event) => setConversationQuery(event.target.value)}
            placeholder="搜索对话"
            aria-label="搜索对话"
          />
          <div className="conversation-list">
            {visibleConversations.map((conversation) => (
              <div className="conversation-row-wrap" key={conversation.id}>
              <button
                className={
                  selection.kind === "conversation" && selection.id === conversation.id
                    ? "conversation-row selected"
                    : "conversation-row"
                }
                onClick={() => onSelect({ kind: "conversation", id: conversation.id })}
              >
                <span className={`mode-chip ${conversation.mode}`}>
                  {conversationBadge(conversation)}
                </span>
                <span className="conversation-title">{conversation.title || "未命名会话"}</span>
                <small>{timeAgo(conversation.updatedAt)}</small>
              </button>
              <div className="conversation-row-actions">
                <button title="重命名" onClick={() => onRenameConversation(conversation)}>✎</button>
                <button title={conversation.status === "archived" ? "恢复" : "归档"} onClick={() => onArchiveConversation(conversation)}>{conversation.status === "archived" ? "↩" : "–"}</button>
              </div>
              </div>
            ))}
            {visibleConversations.length === 0 && <p className="tree-empty">没有匹配的对话</p>}
          </div>
        </div>
      )}

      <div className="sidebar-section grow">
        <div className="section-heading">
          <span>项目 / 工作区</span>
          <button className="icon-button" title="添加项目文件夹" onClick={onAddProject}>
            <Icon name="plus" size={14} />
          </button>
        </div>
        <div className="project-list">
          {nodes.length === 0 && (
            <button className="empty-project" onClick={onAddProject}>
              <Icon name="folder" size={16} />
              <span>
                <strong>添加第一个项目</strong>
                <small>选本地文件夹 = 这个对话的工作区</small>
              </span>
            </button>
          )}
          {nodes.map((node) => {
            const isOpen = expanded.has(node.project.id);
            return (
              <div className="project-group" key={node.project.id}>
                <div className="project-row-wrap">
                  <button
                    className="project-row"
                    onClick={() => onOpenProjectWorkspace(node.project)}
                    title="在对话里打开这个工作区"
                  >
                    <span
                      className={isOpen ? "chevron open" : "chevron"}
                      onClick={(event) => {
                        event.stopPropagation();
                        onToggleProject(node.project.id);
                      }}
                    >
                      <Icon name="chevron" size={12} />
                    </span>
                    <Icon name="folder" size={15} />
                    <strong>{node.project.name}</strong>
                    {!node.project.trusted && <small className="trust-mark">未信任</small>}
                    <small>
                      {
                        conversations.filter(
                          (c) =>
                            c.activeTaskId &&
                            node.tasks.some((t) => t.id === c.activeTaskId),
                        ).length || node.tasks.length
                      }
                    </small>
                  </button>
                </div>
                {isOpen && (
                  <div className="task-tree">
                    {(() => {
                      const taskIds = new Set(node.tasks.map((t) => t.id));
                      const projectConvs = conversations.filter(
                        (c) => c.activeTaskId && taskIds.has(c.activeTaskId),
                      );
                      if (projectConvs.length === 0 && node.tasks.length === 0) {
                        return (
                          <p className="tree-empty">绑定后，在对话里直接干活即可</p>
                        );
                      }
                      return (
                        <>
                          {projectConvs.map((conversation) => (
                            <button
                              key={conversation.id}
                              className={
                                selection.kind === "conversation" &&
                                selection.id === conversation.id
                                  ? "task-row selected"
                                  : "task-row"
                              }
                              onClick={() =>
                                onSelect({ kind: "conversation", id: conversation.id })
                              }
                              title="打开此工作区会话"
                            >
                              <i className="task-state ready" />
                              <span>{conversation.title || "未命名会话"}</span>
                              <small>{timeAgo(conversation.updatedAt)}</small>
                            </button>
                          ))}
                          {/* Fallback: if a task exists but no conversation meta linked yet, still open via task anchor. */}
                          {projectConvs.length === 0 &&
                            node.tasks.map((task: Task) => (
                              <button
                                key={task.id}
                                className={
                                  selection.kind === "task" && selection.id === task.id
                                    ? "task-row selected"
                                    : "task-row"
                                }
                                onClick={() => onOpenTaskWorkspace(task)}
                                title="打开绑定该工作区的对话"
                              >
                                <i className={`task-state ${taskStateClass(task.status)}`} />
                                <span>{task.title}</span>
                                <small>{taskStatusLabel(task.status)}</small>
                              </button>
                            ))}
                        </>
                      );
                    })()}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      <div className="sidebar-footer">
        <span className="foot-seal">本地优先</span>
        <small>项目 = 工作区 · 同一对话直接干</small>
      </div>
    </aside>
  );
}
