/**
 * 蓬莱 0.4 桌面工作台 — 连 Host 的薄客户端（React/Tauri）。
 *
 * 信息架构（一个对话表面）：
 *   左导航  新对话 · 项目=工作区 · 进行中 · 审批 · 渠道 · 能力 · 设置
 *   主面板  对话流（完整工具 + 可选项目 jail + 权限拨盘 + 忙时队列）
 *   任务 run 面板仅作高级/遗留入口，不是日常必经路径
 *
 * 每条事实都来自 Host（RPC + WS 事件）；桌面不持有任何产品状态。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from "@tauri-apps/plugin-notification";
import type { Approval, Conversation, Project, Task, WorkProposal } from "@penglai/protocol";
import { createBridge, isTauriRuntime } from "./bridge/index.js";
import { useHostConnection } from "./hooks/useHostConnection.js";
import { useWorkbenchData } from "./hooks/useWorkbenchData.js";
import { useConversationStream } from "./hooks/useConversationStream.js";
import { useTaskStream } from "./hooks/useTaskStream.js";
import { usageForProject, type TaskBundleLike } from "./state/workbench.js";
import { firstLine, formatTokens } from "./state/format.js";
import { RuntimeGate } from "./ui/RuntimeGate.js";
import { Sidebar, type Selection } from "./ui/Sidebar.js";
import { ChatPanel } from "./ui/ChatPanel.js";
import { TaskPanel } from "./ui/TaskPanel.js";
import { EvidenceRail } from "./ui/EvidenceRail.js";
import { WorkbenchRail } from "./ui/WorkbenchRail.js";
import { ApprovalsPanel } from "./ui/ApprovalsPanel.js";
import { AbilitiesPanel, ActivePanel, ChannelsPanel, SettingsPanel } from "./ui/panels.js";
import { Icon } from "./ui/Icon.js";
import { AppDialogHost, askPrompt, type AppDialogRequest } from "./ui/AppDialog.js";
import { DoctorModal } from "./ui/DoctorModal.js";
import { SetupWizard } from "./wizard/SetupWizard.js";
import "./App.css";

interface UpdateInfo {
  has_update: boolean;
  version: string;
  body: string;
}

export default function App() {
  const bridge = useMemo(() => createBridge(), []);
  const host = useHostConnection(bridge);
  const online = host.phase === "online";
  const data = useWorkbenchData(bridge, online);

  const [selection, setSelection] = useState<Selection>({ kind: "conversation", id: null });
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [railOpen, setRailOpen] = useState(false);
  const [workbenchOpen, setWorkbenchOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [panelNotice, setPanelNotice] = useState<string | null>(null);
  const [selectedProfileId, setSelectedProfileId] = useState("");
  const [appDialog, setAppDialog] = useState<AppDialogRequest | null>(null);
  const [doctorOpen, setDoctorOpen] = useState(false);
  const [update, setUpdate] = useState<UpdateInfo | null>(null);
  const [installing, setInstalling] = useState(false);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [voiceInstalling, setVoiceInstalling] = useState(false);
  const [voiceInstallLog, setVoiceInstallLog] = useState<string | null>(null);
  const [usageStatsRange, setUsageStatsRange] = useState<"7d" | "30d" | "all">("30d");
  const [usageStats, setUsageStats] = useState<{
    range: string;
    totalTokens: number;
    totalRequests: number;
    activeDays: number;
    currentStreakDays: number;
    topModel: { model: string; tokens: number; share: number } | null;
    daily: Array<{ day: string; tokens: number; requests: number }>;
    byModel: Array<{ model: string; tokens: number; requests: number; share: number }>;
    activeDaySet: string[];
  } | null>(null);
  const completionBusyRef = useRef(false);

  const installVoice = useCallback(
    async (which: "asr" | "tts" | "all") => {
      if (voiceInstalling) return;
      setVoiceInstalling(true);
      setVoiceInstallLog(
        which === "all"
          ? "开始下载 SenseVoice（~230MB）与 MOSS-TTS（~728MB）…\n镜像优先 · 断点续传 · 数据不出机"
          : which === "asr"
            ? "开始下载 SenseVoice ASR（~230MB int8）…"
            : "开始下载 MOSS-TTS-Nano（~728MB）…",
      );
      try {
        // Progress events are broadcast on the voice channel; poll status as fallback.
        const unsub = await bridge.subscribe("voice", (event) => {
          const payload = event as { event?: string; file?: string; got?: number; total?: number };
          if (payload?.event !== "voice.download.progress") return;
          const got = payload.got ?? 0;
          const total = payload.total ?? 0;
          const pct = total > 0 ? `${Math.min(100, Math.round((got / total) * 100))}%` : `${got} B`;
          setVoiceInstallLog((prev) => `${prev ?? ""}\n↓ ${payload.file ?? "file"} ${pct}`.slice(-2000));
        });
        try {
          const result = await bridge.rpc<{ results: Array<{ id: string; ok: boolean; detail: string }> }>(
            "voice.install",
            { which },
          );
          const lines = (result.results ?? []).map(
            (r) => `${r.ok ? "✓" : "✗"} ${r.id}: ${r.detail}`,
          );
          setVoiceInstallLog((prev) => `${prev ?? ""}\n${lines.join("\n") || "完成"}`);
        } finally {
          unsub();
        }
        await data.reloadAll();
      } catch (error) {
        setVoiceInstallLog((prev) => `${prev ?? ""}\n失败：${String(error)}`);
      } finally {
        setVoiceInstalling(false);
      }
    },
    [bridge, data, voiceInstalling],
  );

  const conversationId = selection.kind === "conversation" ? selection.id : null;

  const controlCompanion = useCallback(
    async (
      action: "enable" | "disable" | "mode" | "trigger",
      input?: { mode?: "quiet" | "present" | "active"; conversationId?: string | null },
    ) => {
      try {
        if (action === "trigger") {
          await bridge.rpc("companion.trigger", { source: "free" });
        } else if (action === "disable") {
          await bridge.rpc("companion.disable", {});
        } else if (action === "mode") {
          await bridge.rpc("companion.mode", { mode: input?.mode ?? "present" });
        } else {
          await bridge.rpc("companion.enable", {
            mode: input?.mode ?? "present",
            conversationId: input?.conversationId ?? null,
          });
        }
        setPanelNotice(action === "trigger" ? "已提交一次主动陪伴测试。" : "主动陪伴设置已更新。");
        await data.reloadAll();
      } catch (error) {
        setPanelNotice(`主动陪伴操作失败：${String(error)}`);
      }
    },
    [bridge, data],
  );

  const stream = useConversationStream(bridge, conversationId, host.generation);
  useEffect(() => {
    if (stream.busy || stream.state.streaming) {
      completionBusyRef.current = true;
      return;
    }
    if (!completionBusyRef.current || !conversationId) return;
    completionBusyRef.current = false;
    if (!isTauriRuntime() || (document.visibilityState === "visible" && document.hasFocus())) return;
    void (async () => {
      try {
        let granted = await isPermissionGranted();
        if (!granted) granted = (await requestPermission()) === "granted";
        if (granted) {
          const conversation = data.conversations.find((row) => row.id === conversationId);
          sendNotification({
            title: "蓬莱已完成本轮工作",
            body: conversation?.title || "返回桌面查看结果与证据。",
          });
        }
      } catch {
        /* durable conversation remains the source of truth */
      }
    })();
  }, [conversationId, data.conversations, stream.busy, stream.state.streaming]);
  const taskId =
    selection.kind === "task"
      ? selection.id
      : selection.kind === "conversation"
        ? stream.state.activeTaskId
        : null;
  const onDurableChange = useCallback(() => {
    void data.reloadApprovals().catch(() => undefined);
    void data.reloadTasks().catch(() => undefined);
    void data.reloadBudgetAndUsage().catch(() => undefined);
  }, [data]);
  const taskStream = useTaskStream(bridge, taskId, onDurableChange, host.generation);

  // Host restart: reload the whole working set off the new instance.
  useEffect(() => {
    if (host.generation > 0 && online) void data.reloadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [host.generation, online]);

  useEffect(() => {
    if (!selectedProfileId && data.defaultProfileId) {
      setSelectedProfileId(data.defaultProfileId);
    }
  }, [data.defaultProfileId, selectedProfileId]);

  useEffect(() => {
    if (!online) return;
    let cancelled = false;
    void bridge
      .rpc<NonNullable<typeof usageStats>>("usage.stats", { range: usageStatsRange })
      .then((stats) => {
        if (!cancelled) setUsageStats(stats);
      })
      .catch(() => {
        if (!cancelled) setUsageStats(null);
      });
    return () => {
      cancelled = true;
    };
  }, [bridge, online, usageStatsRange, data.usage?.totalTokens, data.usage?.totalRequests]);

  // 首次启动：连接 Host 后没有任何 key 可解析的档案（CLI 裸跑 `penglai`
  // 同判据：config.resolveProfile → null）→ 首次启动向导（onboarding 主路径）。
  // 设置页「重新配置模型」经 onOpenWizard 手动打开同一向导。
  useEffect(() => {
    if (online && !data.loading && data.defaultProfileId === null) setWizardOpen(true);
  }, [online, data.loading, data.defaultProfileId]);

  // Auto-expand projects as they arrive.
  useEffect(() => {
    setExpanded((current) => {
      const next = new Set(current);
      for (const node of data.nodes) next.add(node.project.id);
      return next;
    });
  }, [data.nodes]);

  // Updater（托盘菜单 / 设置页同一条路径：原生 check_app_update →
  // tauri-plugin-updater 拉 latest.json；有更新 → 原生通知 + 界面卡）。
  const [updateChecking, setUpdateChecking] = useState(false);
  const [updateError, setUpdateError] = useState<string | null>(null);

  const checkForUpdates = useCallback(async () => {
    if (!isTauriRuntime() || updateChecking) return;
    setUpdateChecking(true);
    setUpdateError(null);
    try {
      const info = await invoke<UpdateInfo>("check_app_update");
      setUpdate(info);
      if (info.has_update) {
        try {
          let granted = await isPermissionGranted();
          if (!granted) granted = (await requestPermission()) === "granted";
          if (granted) {
            sendNotification({
              title: `蓬莱 ${info.version} 已准备好`,
              body: "打开设置页「应用更新」一键升级——更新前会备份并验证本地数据。",
            });
          }
        } catch {
          /* 通知失败不阻断界面卡 */
        }
      }
    } catch (error) {
      setUpdateError(`检查更新失败：${String(error instanceof Error ? error.message : error)}`);
    } finally {
      setUpdateChecking(false);
    }
  }, [updateChecking]);

  const installUpdate = useCallback(() => {
    setInstalling(true);
    setUpdateError(null);
    void invoke("install_app_update").catch((error) => {
      setUpdateError(`安全更新未完成：${String(error)}`);
      setInstalling(false);
    });
  }, []);

  // Updater (menu → check → toast → install), unchanged behavior.
  useEffect(() => {
    if (!isTauriRuntime()) return;
    const unlisten = listen("menu-check-update", () => {
      void checkForUpdates();
    });
    return () => void unlisten.then((stop) => stop());
  }, [checkForUpdates]);

  // ── conversation actions ─────────────────────────────────────

  const ensureConversation = useCallback(async (): Promise<string | null> => {
    if (conversationId) return conversationId;
    if (!data.defaultProfileId) {
      setPanelNotice("还没有可用的模型档案 — 在设置页点「重新配置模型」走向导，或在 CLI 跑 `penglai setup`。");
      return null;
    }
    const home = data.homeDir;
    if (!home) {
      setPanelNotice("无法确定会话锚定目录（桌面运行时未提供数据目录）。");
      return null;
    }
    try {
      const workspace = await bridge.rpc<{ id: string }>("workspace.open", {
        rootPath: home,
        name: "desktop",
      });
      const conversation = await bridge.rpc<Conversation>("conversation.create", {
        workspaceId: workspace.id,
        modelProfileId: selectedProfileId || data.defaultProfileId,
        title: "新对话",
      });
      await data.reloadConversations();
      setSelection({ kind: "conversation", id: conversation.id });
      return conversation.id;
    } catch (error) {
      setPanelNotice(`创建会话失败：${String(error)}`);
      return null;
    }
  }, [bridge, conversationId, data, selectedProfileId]);

  const onSend = useCallback(
    (
      text: string,
      options?: {
        delivery?: "queue" | "now";
        permissionMode?: "confirm" | "auto_edit" | "full" | "plan";
        thinkingLevel?: "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";
        images?: Array<{ data: string; mimeType: string; name?: string }>;
      },
    ) => {
      void (async () => {
        const id = await ensureConversation();
        if (!id) return;
        if (id === conversationId) {
          await stream.send(text, options);
        } else {
          // Fresh conversation: the stream hook subscribes on selection
          // change; send directly here so the first message is not lost.
          try {
            await bridge.rpc("conversation.prompt", {
              conversationId: id,
              text,
              permissionMode: options?.permissionMode ?? "auto_edit",
              thinkingLevel: options?.thinkingLevel ?? "medium",
              delivery: options?.delivery ?? "queue",
              images: options?.images,
            });
          } catch (error) {
            setPanelNotice(`发送失败：${String(error)}`);
          }
        }
        void data.reloadConversations().catch(() => undefined);
        void data.reloadBudgetAndUsage().catch(() => undefined);
      })();
    },
    [bridge, conversationId, data, ensureConversation, stream],
  );

  // ── project / task actions ───────────────────────────────────

  const pickFolder = useCallback(async (): Promise<string | null> => {
    if (isTauriRuntime()) {
      const selected = await open({
        directory: true,
        multiple: false,
        title: "选择要交给蓬莱管理的项目文件夹",
      });
      return typeof selected === "string" ? selected : null;
    }
    // Browser/dev fallback: in-app dialog (never window.prompt in Tauri path).
    const value = await askPrompt(setAppDialog, {
      title: "项目文件夹",
      message: "输入要交给蓬莱管理的绝对路径",
      placeholder: "/path/to/project",
    });
    return value?.trim() || null;
  }, []);

  const pickAttachment = useCallback(async (): Promise<string | null> => {
    if (!isTauriRuntime()) return null;
    const selected = await open({
      directory: false,
      multiple: false,
      title: "选择要交给蓬莱读取的文档或文件",
      filters: [{
        name: "常用文档与图片",
        extensions: ["pdf", "docx", "xlsx", "pptx", "txt", "md", "csv", "tsv", "json", "yaml", "yml", "xml", "html", "rtf", "png", "jpg", "jpeg", "gif", "webp"],
      }],
    });
    return typeof selected === "string" ? selected : null;
  }, []);

  /** New chat must NOT abort an in-flight episode (Grok App R6). */
  const startNewChat = useCallback(() => {
    setSelection({ kind: "conversation", id: null });
    setWorkbenchOpen(true);
  }, []);

  const addProject = useCallback(async () => {
    const rootPath = await pickFolder();
    if (!rootPath) return;
    try {
      await bridge.rpc<Project>("project.create", { rootPath });
      await data.reloadTasks();
      setPanelNotice("项目已连接。首次执行前需要单独确认信任。");
    } catch (error) {
      setPanelNotice(`连接项目失败：${String(error)}`);
    }
  }, [bridge, data, pickFolder]);

  const selectedProject: Project | null = useMemo(() => {
    const bundle = taskStream.bundle;
    if (!bundle) return null;
    return data.projects.find((p) => p.id === bundle.task.projectId) ?? null;
  }, [data.projects, taskStream.bundle]);

  const withBusy = useCallback(
    async (action: () => Promise<void>) => {
      if (busy) return;
      setBusy(true);
      setPanelNotice(null);
      try {
        await action();
      } catch (error) {
        setPanelNotice(String(error instanceof Error ? error.message : error));
      } finally {
        setBusy(false);
      }
    },
    [busy],
  );

  const trustProject = useCallback(
    (trust: boolean) =>
      withBusy(async () => {
        if (!selectedProject) return;
        await bridge.rpc(trust ? "project.trust" : "project.untrust", {
          projectId: selectedProject.id,
          ...(trust ? { confirmedRootPath: selectedProject.rootPath } : {}),
        });
        await data.reloadTasks();
      }),
    [bridge, data, selectedProject, withBusy],
  );

  const startTask = useCallback(
    () =>
      withBusy(async () => {
        if (!taskId || !selectedProfileId) return;
        await bridge.rpc("task.start", {
          taskId,
          modelProfileId: selectedProfileId,
          source: "desktop",
        });
        await taskStream.reload();
        await data.reloadTasks();
      }),
    [bridge, data, selectedProfileId, taskId, taskStream, withBusy],
  );

  const pauseTask = useCallback(
    () =>
      withBusy(async () => {
        if (!taskId) return;
        await bridge.rpc("task.pause", { taskId });
        await taskStream.reload();
        await data.reloadTasks();
      }),
    [bridge, data, taskId, taskStream, withBusy],
  );

  const cancelTask = useCallback(
    () =>
      withBusy(async () => {
        if (!taskId) return;
        await bridge.rpc("task.cancel", { taskId });
        await taskStream.reload();
        await data.reloadTasks();
      }),
    [bridge, data, taskId, taskStream, withBusy],
  );

  const steerTask = useCallback(
    (text: string) => {
      void withBusy(async () => {
        const run = taskStream.bundle?.runs.at(-1);
        if (!run) throw new Error("没有可接收指令的 run");
        await bridge.rpc("task.steer", { runId: run.id, text });
      });
    },
    [bridge, taskStream, withBusy],
  );

  const decideApproval = useCallback(
    (approval: Approval, verdict: "approve" | "reject", remember: boolean) => {
      void withBusy(async () => {
        await bridge.rpc(verdict === "approve" ? "approval.approve" : "approval.reject", {
          approvalId: approval.id,
          decidedBy: "desktop:owner",
          ...(verdict === "approve" ? { remember } : {}),
        });
        await data.reloadApprovals();
        await taskStream.reload();
        await data.reloadTasks();
      });
    },
    [bridge, data, taskStream, withBusy],
  );

  // ── mode / panels ────────────────────────────────────────────

  /** ZCode-like: a task under a project is just a handle — open its conversation. */
  const openTaskWorkspace = useCallback(
    (task: { id: string; projectId: string; title: string }) => {
      const anchored = data.conversations.find((c) => c.activeTaskId === task.id);
      if (anchored) {
        setSelection({ kind: "conversation", id: anchored.id });
        return;
      }
      // Prefer any conversation already in work mode for the same project tree.
      const taskIds = new Set(
        (data.tasksByProject.get(task.projectId) ?? []).map((row) => row.id),
      );
      const sameProject = data.conversations.find(
        (c) => c.activeTaskId && taskIds.has(c.activeTaskId),
      );
      if (sameProject) {
        setSelection({ kind: "conversation", id: sameProject.id });
        setPanelNotice(`已打开工作区对话「${sameProject.title || "未命名"}」`);
        return;
      }
      setSelection({ kind: "conversation", id: null });
      setPanelNotice("没有找到绑定该工作区的对话 — 在对话里点「选项目」重新进入即可。");
    },
    [data.conversations, data.tasksByProject],
  );

  const openTask = useCallback(
    (id: string) => {
      // Prefer conversation surface over legacy task/run panel.
      const task =
        [...data.tasksByProject.values()].flat().find((row) => row.id === id) ??
        null;
      if (task) {
        openTaskWorkspace(task);
        return;
      }
      setSelection({ kind: "task", id });
      setRailOpen(true);
      void data.reloadTasks().catch(() => undefined);
      void data.reloadConversations().catch(() => undefined);
    },
    [data, openTaskWorkspace],
  );

  const openProjectWorkspace = useCallback(
    (project: { id: string; name: string; rootPath: string }) => {
      // Prefer a conversation already anchored on a task of this project.
      const taskIds = new Set((data.tasksByProject.get(project.id) ?? []).map((row) => row.id));
      const anchored = data.conversations.find(
        (c) => c.activeTaskId && taskIds.has(c.activeTaskId),
      );
      if (anchored) {
        setSelection({ kind: "conversation", id: anchored.id });
        setExpanded((current) => new Set(current).add(project.id));
        return;
      }
      // Fresh conversation then enter project (avoids mode_conflict on active work chat).
      void (async () => {
        setExpanded((current) => new Set(current).add(project.id));
        try {
          setSelection({ kind: "conversation", id: null });
          // Force a brand-new conversation id even if one is selected.
          const workspace = await bridge.rpc<{ id: string }>("workspace.open", {
            rootPath: project.rootPath,
            name: project.name,
          });
          const profileId =
            selectedProfileId ||
            data.defaultProfileId ||
            data.profiles[0]?.id ||
            "";
          if (!profileId) {
            setPanelNotice("还没有模型档案 — 先在设置里配置模型。");
            return;
          }
          const conversation = await bridge.rpc<Conversation>("conversation.create", {
            workspaceId: workspace.id,
            modelProfileId: profileId,
            title: "新对话",
            mode: "chat",
          });
          const result = await bridge.rpc<{
            conversation: { id: string };
            proposal: WorkProposal;
            project: Project | null;
            task: null;
          }>("mode.proposeWork", {
            conversationId: conversation.id,
            projectId: project.id,
            objective: "",
            sourceChannel: "desktop",
          });
          const confirmed = await bridge.rpc<{
            conversation: { id: string };
            project: Project;
            task: Task;
          }>("mode.confirmWork", {
            proposalId: result.proposal.id,
            conversationId: conversation.id,
            confirmedRootPath: result.proposal.canonicalRootPath,
            confirmedBy: "desktop:owner",
          });
          setSelection({ kind: "conversation", id: result.conversation.id });
          await data.reloadTasks();
          await data.reloadConversations();
          setPanelNotice(`已进入工作区「${confirmed.project.name}」— 直接在对话里说需求即可。`);
        } catch (error) {
          setPanelNotice(`进入工作区失败：${String(error)}`);
        }
      })();
    },
    [bridge, data, selectedProfileId],
  );

  const setBudgetLimits = useCallback(
    (daily: number | null, perProject: number | null) => {
      void withBusy(async () => {
        await bridge.rpc("budget.set", {
          dailyTokenLimit: daily,
          projectDailyTokenLimit: perProject,
          updatedBy: "desktop:owner",
        });
        await data.reloadBudgetAndUsage();
        setPanelNotice("预算已保存。");
      });
    },
    [bridge, data, withBusy],
  );

  const liftBudget = useCallback(
    (dimension: string) => {
      void withBusy(async () => {
        await bridge.rpc("budget.lift", { dimension, liftedBy: "desktop:owner" });
        await data.reloadBudgetAndUsage();
        setPanelNotice("已放行（今日）。");
      });
    },
    [bridge, data, withBusy],
  );

  // ── render ───────────────────────────────────────────────────

  if (!online) {
    return (
      <RuntimeGate
        phase={host.phase}
        error={host.error}
        protocol={
          host.handshake
            ? `Host 协议 v${host.handshake.protocolSchemaVersion} · 数据库 v${host.handshake.databaseSchemaVersion}`
            : null
        }
        onRetry={host.retry}
      />
    );
  }

  // 首次启动向导：接管整屏，档案落 Host 后回到工作台（重新拉取工作集）。
  // 判据是「无 key 可解析的档案」而非「无档案」——内置目录档案永在；
  // 首启也留「稍后再配」出口（GUI 进程没有 shell 环境变量时不困住 owner）。
  if (wizardOpen) {
    return (
      <SetupWizard
        bridge={bridge}
        manual={data.defaultProfileId !== null}
        onCancel={() => setWizardOpen(false)}
        onDone={() => {
          setWizardOpen(false);
          void data.reloadAll();
        }}
      />
    );
  }

  const activeConversation: Conversation | null =
    data.conversations.find((c) => c.id === conversationId) ?? null;
  const selectedBundle: TaskBundleLike | null = taskStream.bundle;
  const showTaskRail =
    (selection.kind === "task" || selection.kind === "conversation") &&
    railOpen &&
    selectedBundle !== null;
  const showWorkbenchRail =
    selection.kind === "conversation" && workbenchOpen && conversationId !== null;
  const showRail = showTaskRail || showWorkbenchRail;

  return (
    <div className="app-shell">
      <header className="titlebar" data-tauri-drag-region>
        <div className="traffic-space" data-tauri-drag-region />
        <div className="titlebar-center" data-tauri-drag-region>
          蓬莱<span>·</span>{host.handshake?.runtimeVersion ?? "0.4"}
        </div>
        <button
          className="icon-button title-action"
          title="设置"
          onClick={() => setSelection({ kind: "settings" })}
        >
          <Icon name="settings" size={15} />
        </button>
      </header>
      {panelNotice && (
        <div className="global-notice" role="status">
          <span>{panelNotice}</span>
          <button type="button" className="link-button" onClick={() => setPanelNotice(null)}>
            关闭
          </button>
        </div>
      )}

      <div className={showRail ? "workbench with-rail" : "workbench"}>
        <Sidebar
          nodes={data.nodes}
          conversations={data.conversations}
          pendingCount={data.pendingApprovals.length}
          selection={selection}
          expanded={expanded}
          connected={online}
          onSelect={setSelection}
          onNewChat={startNewChat}
          onAddProject={() => void addProject()}
          onToggleProject={(projectId) =>
            setExpanded((current) => {
              const next = new Set(current);
              if (next.has(projectId)) next.delete(projectId);
              else next.add(projectId);
              return next;
            })
          }
          onOpenProjectWorkspace={openProjectWorkspace}
          onOpenTaskWorkspace={openTaskWorkspace}
          onRenameConversation={(conversation) => {
            void askPrompt(setAppDialog, {
              title: "重命名对话",
              initial: conversation.title,
              placeholder: "对话标题",
            }).then(async (title) => {
              if (!title?.trim()) return;
              await bridge.rpc("conversation.update", { conversationId: conversation.id, title: title.trim() });
              await data.reloadConversations();
            });
          }}
          onArchiveConversation={(conversation) => {
            void bridge.rpc("conversation.update", {
              conversationId: conversation.id,
              status: conversation.status === "archived" ? "idle" : "archived",
            }).then(() => data.reloadConversations());
          }}
        />

        {selection.kind === "conversation" && (
          <ChatPanel
            conversationId={conversationId}
            title={activeConversation?.title ?? null}
            stream={stream}
            projects={data.projects}
            onSend={onSend}
            onPickFolder={pickFolder}
            onPickFile={pickAttachment}
            onEnsureConversation={ensureConversation}
            onProjectsChanged={() => {
              void data.reloadTasks().catch(() => undefined);
              void data.reloadConversations().catch(() => undefined);
            }}
            goal={activeConversation?.goal ?? null}
            contextPins={activeConversation?.contextPins ?? []}
            recentConversations={data.conversations.map((c) => ({
              id: c.id,
              title: c.title,
            }))}
            workbenchOpen={workbenchOpen}
            onToggleWorkbench={() => {
              setWorkbenchOpen((v) => !v);
              setRailOpen(false);
            }}
            evidenceOpen={showTaskRail}
            evidenceAvailable={stream.state.activeTaskId !== null}
            onToggleEvidence={() => {
              setRailOpen((v) => !v);
              setWorkbenchOpen(false);
            }}
            onMetaChanged={() => {
              void data.reloadConversations().catch(() => undefined);
            }}
            onOpenTask={openTask}
            onNewChat={startNewChat}
            onOpenDoctor={() => setDoctorOpen(true)}
            askAppPrompt={(options) => askPrompt(setAppDialog, options)}
            sops={data.sops.map((s) => ({ name: s.name, title: s.title || s.name }))}
            asrReady={data.voice?.asr?.ready === true}
            ttsReady={data.voice?.tts?.ready === true}
            onTranscribeVoice={(input) => bridge.rpc("voice.transcribe", input)}
            onSpeakText={(text) => {
              void bridge
                .rpc<{ ok: boolean; wavBase64?: string; error?: string }>("voice.synthesize", { text })
                .then(async (result) => {
                  if (!result.ok || !result.wavBase64) throw new Error(result.error ?? "TTS 未返回音频");
                  const audio = new Audio(`data:audio/wav;base64,${result.wavBase64}`);
                  await audio.play();
                })
                .catch((error) => setPanelNotice(`MOSS-TTS 朗读失败：${String(error)}`));
            }}
            onCompleteFiles={async (query) => {
              const root =
                (() => {
                  if (stream.state.activeTaskId) {
                    for (const tasks of data.tasksByProject.values()) {
                      const task = tasks.find((row) => row.id === stream.state.activeTaskId);
                      if (!task) continue;
                      return data.projects.find((p) => p.id === task.projectId)?.rootPath ?? null;
                    }
                  }
                  return data.homeDir;
                })() ?? ".";
              try {
                return await bridge.rpc<Array<{ path: string; name: string; isDir: boolean }>>(
                  "files.complete",
                  { rootPath: root, query, limit: 30 },
                );
              } catch {
                return [];
              }
            }}
            profiles={data.profiles.map((profile) => ({
              id: profile.id,
              label: profile.label,
              model: profile.model,
              vision: profile.capabilities?.vision === true,
            }))}
            activeProfileId={
              activeConversation?.modelProfileId ||
              selectedProfileId ||
              data.defaultProfileId
            }
            onProfileChange={(profileId) => {
              setSelectedProfileId(profileId);
              if (conversationId) {
                void bridge
                  .rpc("conversation.update", {
                    conversationId,
                    modelProfileId: profileId,
                  })
                  .then(() => data.reloadConversations())
                  .catch((error) => setPanelNotice(`切换模型失败：${String(error)}`));
              }
            }}
            usageLabel={(() => {
              const used = data.usage?.totalTokens ?? 0;
              const day = data.budget?.dimensions?.find((d) => d.dimension === "day");
              const profileId =
                activeConversation?.modelProfileId ||
                selectedProfileId ||
                data.defaultProfileId;
              const profile = data.profiles.find((p) => p.id === profileId);
              const windowTokens =
                typeof profile?.contextWindowTokens === "number" &&
                profile.contextWindowTokens > 0
                  ? profile.contextWindowTokens
                  : null;
              const windowLabel = windowTokens
                ? windowTokens % 1000 === 0
                  ? `${windowTokens / 1000}k`
                  : formatTokens(windowTokens)
                : "未知";
              if (day?.limitTokens != null) {
                return `今日 ${formatTokens(day.usedTokens)} / ${formatTokens(day.limitTokens)} · 窗口 ${windowLabel}`;
              }
              if (used > 0) return `累计 ${formatTokens(used)} · 窗口 ${windowLabel}`;
              return `窗口 ${windowLabel}`;
            })()}
            pendingApprovals={data.pendingApprovals.length}
            bridge={bridge}
            onConversationApprovalDecided={() => {
              void data.reloadApprovals().catch(() => undefined);
            }}
            activeProject={(() => {
              if (!stream.state.activeTaskId) return null;
              for (const tasks of data.tasksByProject.values()) {
                const task = tasks.find((row) => row.id === stream.state.activeTaskId);
                if (!task) continue;
                return data.projects.find((project) => project.id === task.projectId) ?? null;
              }
              return null;
            })()}
            trustedProject={(() => {
              if (!stream.state.activeTaskId) return null;
              for (const tasks of data.tasksByProject.values()) {
                const task = tasks.find((row) => row.id === stream.state.activeTaskId);
                if (!task) continue;
                return data.projects.find((project) => project.id === task.projectId)?.trusted ?? null;
              }
              return null;
            })()}
          />
        )}

        {selection.kind === "task" && selectedBundle && (
          <TaskPanel
            bundle={selectedBundle}
            project={selectedProject}
            profiles={data.profiles}
            selectedProfileId={selectedProfileId}
            onProfileChange={setSelectedProfileId}
            busy={busy}
            notice={panelNotice}
            taskStream={taskStream}
            subState={taskStream.subState}
            onStart={() => void startTask()}
            onPause={() => void pauseTask()}
            onCancel={() => void cancelTask()}
            onSteer={steerTask}
            onTrust={() => void trustProject(true)}
            onUntrust={() => void trustProject(false)}
            onDecideApproval={decideApproval}
          />
        )}

        {selection.kind === "task" && !selectedBundle && (
          <main className="task-surface">
            <div className="new-task-intro">
              <div className="brand-seal intro">蓬</div>
              <h2>{taskStream.loading ? "正在读取任务…" : "任务不存在或已被归档"}</h2>
              {panelNotice && <p>{panelNotice}</p>}
            </div>
          </main>
        )}

        {selection.kind === "active" && (
          <ActivePanel
            nodes={data.nodes}
            conversations={data.conversations}
            onOpenTask={openTask}
            onOpenConversation={(id) => setSelection({ kind: "conversation", id })}
          />
        )}

        {selection.kind === "approvals" && (
          <ApprovalsPanel
            approvals={data.pendingApprovals}
            projects={data.projects}
            tasksByProject={data.tasksByProject}
            busy={busy}
            onDecide={decideApproval}
            onOpenTask={openTask}
          />
        )}

        {selection.kind === "channels" && (
          <ChannelsPanel
            channels={data.channels}
            bridge={bridge}
            onChanged={() => void data.reloadAll()}
          />
        )}

        {selection.kind === "abilities" && (
          <AbilitiesPanel
            voice={data.voice}
            companion={data.companion}
            budget={data.budget}
            sops={data.sops}
            onInstallVoice={(which) => void installVoice(which)}
            voiceInstallLog={voiceInstallLog}
            voiceInstalling={voiceInstalling}
            activeConversationId={conversationId}
            onCompanion={(action, input) => void controlCompanion(action, input)}
          />
        )}

        {selection.kind === "settings" && (
          <SettingsPanel
            profiles={data.profiles}
            profileKeyMap={data.profileKeyMap}
            defaultProfileId={data.defaultProfileId}
            budget={data.budget}
            usage={data.usage}
            usageStats={usageStats}
            usageStatsRange={usageStatsRange}
            onUsageRange={setUsageStatsRange}
            handshake={host.handshake}
            homeDir={data.homeDir}
            projects={data.projects}
            busy={busy}
            onSetBudget={setBudgetLimits}
            onLiftBudget={liftBudget}
            onOpenWizard={() => setWizardOpen(true)}
            update={update}
            updateChecking={updateChecking}
            updateError={updateError}
            installingUpdate={installing}
            onCheckUpdate={() => void checkForUpdates()}
            onInstallUpdate={installUpdate}
            bridge={bridge}
            sops={data.sops}
            onProfilesChanged={() => void data.reloadAll()}
          />
        )}

        {showTaskRail && selectedBundle && (
          <EvidenceRail
            bridge={bridge}
            evidence={selectedBundle.evidence}
            projects={data.projects}
            usageRows={usageForProject(data.usage, selectedBundle.task.projectId)}
            budgetDimensions={
              data.budget?.dimensions.filter(
                (d) =>
                  d.dimension === "day" ||
                  d.dimension === `project:${selectedBundle.task.projectId}`,
              ) ?? []
            }
            onClose={() => setRailOpen(false)}
          />
        )}
        {showWorkbenchRail && (
          <WorkbenchRail
            conversationId={conversationId}
            bridge={bridge}
            open={workbenchOpen}
            onClose={() => setWorkbenchOpen(false)}
          />
        )}
      </div>

      {update?.has_update && (
        <div className="update-toast">
          <div className="update-icon"><Icon name="refresh" size={17} /></div>
          <div>
            <strong>蓬莱 {update.version} 已准备好</strong>
            <span>更新前会备份并验证本地数据</span>
          </div>
          <button disabled={installing} onClick={installUpdate}>
            {installing ? "正在安装…" : "安全更新"}
          </button>
        </div>
      )}
      <AppDialogHost dialog={appDialog} />
      <DoctorModal open={doctorOpen} bridge={bridge} onClose={() => setDoctorOpen(false)} />
    </div>
  );
}
