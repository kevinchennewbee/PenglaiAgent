/**
 * Workbench data loading: every fact lives in the Host; this hook pulls the
 * workbench's working set (projects + tasks, conversations, pending
 * approvals, budget, usage, profiles, channels, voice, SOP tree) and offers
 * targeted reloads driven by WS events plus a slow approval poll.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type {
  Approval,
  BudgetStatus,
  Conversation,
  ModelProfile,
  Project,
  SopMeta,
  Task,
  UsageReport,
} from "@penglai/protocol";
import type { PenglaiBridge } from "../bridge/types.js";
import { buildProjectTree, type ProjectNode } from "../state/workbench.js";

export interface ChannelInfo {
  channel: string;
  configured: boolean;
  enabled: boolean;
  state: string;
  appId: string | null;
  domain: string | null;
  whitelist: number;
  routes: number;
}

export interface VoiceComponentStatus {
  ready: boolean;
  detail: string;
}

export interface VoiceStatus {
  state: string;
  components?: Record<string, VoiceComponentStatus>;
  asr?: VoiceComponentStatus;
  tts?: VoiceComponentStatus;
  ffmpeg?: VoiceComponentStatus;
}

export interface CompanionStatus {
  enabled: boolean;
  mode: "quiet" | "present" | "active";
  conversationId: string | null;
  lastFire: number | null;
  lastSource: "weather" | "morning" | "evening" | "emotion" | "free" | null;
}

export interface WorkbenchData {
  loading: boolean;
  error: string | null;
  projects: Project[];
  tasksByProject: Map<string, Task[]>;
  nodes: ProjectNode[];
  conversations: Conversation[];
  pendingApprovals: Approval[];
  budget: BudgetStatus | null;
  usage: UsageReport | null;
  profiles: ModelProfile[];
  /** First profile whose key resolves host-side (default choice). */
  defaultProfileId: string | null;
  /** profileId → hasKey (display only; key material never leaves the Host). */
  profileKeyMap: Map<string, boolean>;
  channels: ChannelInfo[];
  voice: VoiceStatus | null;
  companion: CompanionStatus | null;
  sops: SopMeta[];
  /** The desktop chat ground (assistant data dir); null on http bridge. */
  homeDir: string | null;
  reloadAll: () => Promise<void>;
  reloadTasks: () => Promise<void>;
  reloadApprovals: () => Promise<void>;
  reloadConversations: () => Promise<void>;
  reloadBudgetAndUsage: () => Promise<void>;
}

const APPROVAL_POLL_MS = 8000;

export function useWorkbenchData(bridge: PenglaiBridge, online: boolean): WorkbenchData {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [tasksByProject, setTasksByProject] = useState<Map<string, Task[]>>(new Map());
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [pendingApprovals, setPendingApprovals] = useState<Approval[]>([]);
  const [budget, setBudget] = useState<BudgetStatus | null>(null);
  const [usage, setUsage] = useState<UsageReport | null>(null);
  const [profiles, setProfiles] = useState<ModelProfile[]>([]);
  const [defaultProfileId, setDefaultProfileId] = useState<string | null>(null);
  const [profileKeyMap, setProfileKeyMap] = useState<Map<string, boolean>>(new Map());
  const [channels, setChannels] = useState<ChannelInfo[]>([]);
  const [voice, setVoice] = useState<VoiceStatus | null>(null);
  const [companion, setCompanion] = useState<CompanionStatus | null>(null);
  const [sops, setSops] = useState<SopMeta[]>([]);
  const [homeDir, setHomeDir] = useState<string | null>(null);
  const loadingRef = useRef(false);

  const reloadTasks = useCallback(async () => {
    const list = await bridge.rpc<Project[]>("project.list", { includeArchived: false });
    const taskLists = await Promise.all(
      list.map((project) => bridge.rpc<Task[]>("task.list", { projectId: project.id })),
    );
    const map = new Map<string, Task[]>();
    list.forEach((project, index) => map.set(project.id, taskLists[index]));
    setProjects(list);
    setTasksByProject(map);
  }, [bridge]);

  const reloadApprovals = useCallback(async () => {
    const pending = await bridge.rpc<Approval[]>("approval.list", { status: "pending" });
    setPendingApprovals(pending);
  }, [bridge]);

  const reloadConversations = useCallback(async () => {
    const list = await bridge.rpc<Conversation[]>("conversation.list");
    setConversations(list);
  }, [bridge]);

  const reloadBudgetAndUsage = useCallback(async () => {
    const [budgetStatus, usageReport] = await Promise.all([
      bridge.rpc<BudgetStatus>("budget.status"),
      bridge.rpc<UsageReport>("usage.get"),
    ]);
    setBudget(budgetStatus);
    setUsage(usageReport);
  }, [bridge]);

  const reloadAll = useCallback(async () => {
    if (loadingRef.current) return;
    loadingRef.current = true;
    setError(null);
    try {
      await reloadTasks();
      const settled = await Promise.allSettled([
        reloadConversations(),
        reloadApprovals(),
        reloadBudgetAndUsage(),
        bridge.rpc<ModelProfile[]>("config.listProfiles").then(setProfiles),
        bridge
          .rpc<{ profile: ModelProfile | null; hasKey: boolean }>("config.resolveProfile")
          .then((resolved) => setDefaultProfileId(resolved.profile?.id ?? null)),
        bridge.rpc<ChannelInfo[]>("channel.list").then(setChannels),
        bridge.rpc<VoiceStatus>("voice.status").then(setVoice),
        bridge.rpc<CompanionStatus>("companion.status").then(setCompanion),
        bridge.rpc<SopMeta[]>("memory.sopList").then(setSops),
        bridge.home().then(setHomeDir),
      ]);
      const firstFailure = settled.find(
        (result): result is PromiseRejectedResult => result.status === "rejected",
      );
      if (firstFailure) {
        setError(`部分数据加载失败：${String(firstFailure.reason)}`);
      }
    } catch (loadError) {
      setError(`无法读取本地数据：${String(loadError)}`);
    } finally {
      loadingRef.current = false;
      setLoading(false);
    }
  }, [bridge, reloadApprovals, reloadBudgetAndUsage, reloadConversations, reloadTasks]);

  // Per-profile key resolution for the settings table (few profiles; the
  // Host answers from memory without leaking key material).
  useEffect(() => {
    if (!online || profiles.length === 0) return;
    let active = true;
    void Promise.all(
      profiles.map((profile) =>
        bridge
          .rpc<{ hasKey: boolean }>("config.resolveProfile", { profileId: profile.id })
          .then((resolved) => [profile.id, resolved.hasKey] as const)
          .catch(() => [profile.id, false] as const),
      ),
    ).then((entries) => {
      if (active) setProfileKeyMap(new Map(entries));
    });
    return () => {
      active = false;
    };
  }, [bridge, online, profiles]);

  useEffect(() => {
    if (!online) return;
    setLoading(true);
    void reloadAll();
  }, [online, reloadAll]);

  useEffect(() => {
    if (!online) return;
    const timer = window.setInterval(() => {
      void reloadApprovals().catch(() => undefined);
    }, APPROVAL_POLL_MS);
    return () => window.clearInterval(timer);
  }, [online, reloadApprovals]);

  return {
    loading,
    error,
    projects,
    tasksByProject,
    nodes: buildProjectTree(projects, tasksByProject),
    conversations,
    pendingApprovals,
    budget,
    usage,
    profiles,
    defaultProfileId,
    profileKeyMap,
    channels,
    voice,
    companion,
    sops,
    homeDir,
    reloadAll,
    reloadTasks,
    reloadApprovals,
    reloadConversations,
    reloadBudgetAndUsage,
  };
}
