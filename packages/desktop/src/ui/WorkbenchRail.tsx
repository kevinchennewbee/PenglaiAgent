/** Conversation TODO rail. */

import { useCallback, useEffect, useState } from "react";
import type { ConversationTodo, ConversationWorkbench } from "@penglai/protocol";
import type { PenglaiBridge } from "../bridge/types.js";
import { Icon } from "./Icon.js";

export function WorkbenchRail({
  conversationId,
  bridge,
  open,
  onClose,
}: {
  conversationId: string | null;
  bridge: PenglaiBridge | null;
  open: boolean;
  onClose: () => void;
}) {
  const [workbench, setWorkbench] = useState<ConversationWorkbench | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [todoDraft, setTodoDraft] = useState("");

  const reload = useCallback(async () => {
    if (!bridge || !conversationId) {
      setWorkbench(null);
      return;
    }
    try {
      const next = await bridge.rpc<ConversationWorkbench>("conversation.workbench.get", {
        conversationId,
      });
      setWorkbench(next);
    } catch (error) {
      setNotice(`待办加载失败：${String(error)}`);
    }
  }, [bridge, conversationId]);

  useEffect(() => {
    void reload();
    if (!open || !conversationId) return;
    const timer = window.setInterval(() => void reload(), 2_500);
    return () => window.clearInterval(timer);
  }, [open, conversationId, reload]);

  if (!open) return null;

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setNotice(null);
    try {
      await action();
      await reload();
    } catch (error) {
      setNotice(String(error));
    } finally {
      setBusy(false);
    }
  };

  const todos = workbench?.todos ?? [];

  return (
    <aside className="workbench-rail" aria-label="会话待办">
      <header className="workbench-rail-head">
        <div>
          <strong>待办</strong>
          <small>记录并更新当前会话的任务</small>
        </div>
        <button type="button" className="icon-button" onClick={onClose} title="关闭">
          <Icon name="x" size={14} />
        </button>
      </header>

      {!conversationId && (
        <p className="workbench-empty">先发一条消息或选项目，创建会话后再添加待办。</p>
      )}

      {conversationId && (
        <section className="workbench-section">
          <form
            className="workbench-add"
            onSubmit={(event) => {
              event.preventDefault();
              const content = todoDraft.trim();
              if (!content || !bridge) return;
              void run(async () => {
                await bridge.rpc("conversation.todo.upsert", {
                  conversationId,
                  content,
                  status: "pending",
                });
                setTodoDraft("");
              });
            }}
          >
            <input
              value={todoDraft}
              onChange={(event) => setTodoDraft(event.target.value)}
              placeholder="添加待办…"
              disabled={busy}
            />
            <button type="submit" className="primary-button" disabled={busy || !todoDraft.trim()}>
              添加
            </button>
          </form>
          <ul className="workbench-list">
            {todos.length === 0 && <li className="workbench-empty">暂无待办</li>}
            {todos.map((todo: ConversationTodo) => (
              <li key={todo.id} className={`todo-row ${todo.status}`}>
                <select
                  value={todo.status}
                  disabled={busy}
                  onChange={(event) =>
                    void run(async () => {
                      await bridge!.rpc("conversation.todo.upsert", {
                        conversationId,
                        id: todo.id,
                        content: todo.content,
                        status: event.target.value,
                      });
                    })
                  }
                >
                  <option value="pending">待办</option>
                  <option value="in_progress">进行中</option>
                  <option value="completed">完成</option>
                  <option value="cancelled">取消</option>
                </select>
                <span>{todo.content}</span>
                <button
                  type="button"
                  className="link-button"
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      await bridge!.rpc("conversation.todo.remove", {
                        conversationId,
                        todoId: todo.id,
                      });
                    })
                  }
                >
                  删
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {notice && <p className="workbench-notice">{notice}</p>}
    </aside>
  );
}
