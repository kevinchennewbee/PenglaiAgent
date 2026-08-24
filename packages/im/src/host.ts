import {
  PenglaiError,
  assertSha256,
  type BindingVoicePolicy,
  type PenglaiAsrClient,
  type PenglaiMossTtsClient,
  type VoiceReplyMode,
} from "@penglai/contracts";
import type { WeixinAdapter } from "@penglai/channel-weixin";
import type { FeishuAdapter } from "@penglai/channel-feishu";
import type { RoutingControlPlane } from "@penglai/routing-core";
import type { Store } from "@penglai/persistence";
import type { DshHost } from "@penglai/dsh-bridge";
import { FEISHU_SECRET_REF, WEIXIN_TOKEN_REF, type CredentialsServiceVault } from "./credentials-vault.js";
import type { AdapterSupervisor } from "./supervisor.js";
import { ImBotStore } from "./bots.js";
import { beginGuidedConnection, type GuidedConnectionState } from "./guided.js";
import {
  CHANNEL_IDS,
  getChannelManifest,
  isLiveChannel,
  listChannelManifests,
  type ChannelId,
  type ChannelManifestV1,
} from "./registry.js";
import {
  IM_OWNER_ACTIONS,
  consumeImOwnerProof,
  imBindingObjectId,
  imSourceDigest,
  requireImActionId,
  type ImOwnerBrokerPort,
} from "./owner.js";

export type ChannelName = "weixin" | "feishu";

export type ConnectionState =
  | "not_configured"
  | "ready"
  | "connecting"
  | "connected"
  | "degraded"
  | "expired"
  | "blocked"
  | "disabled"
  | "failed";

export interface ChannelState {
  channel: ChannelId;
  configured: boolean;
  connection: ConnectionState;
  boundRoutes: number;
  pendingInbox: number;
  pendingOutbox: number;
  revision: number;
  live: boolean;
  risk: ChannelManifestV1["risk"];
  connectionMethods: ChannelManifestV1["connectionMethods"];
  error?: { code: string; action: string };
}

export interface BindingDto {
  id: string;
  channel: ChannelName;
  accountId: string;
  peerId: string;
  workspaceId: string;
  sessionId: string;
  revision: number;
  state: "active" | "disabled";
  voice: BindingVoicePolicy;
}

export class PenglaiImHost {
  revision = 1;
  private qrActive = false;
  private feishuQrId = "";
  private feishuAppId = "";
  private owner: ImOwnerBrokerPort | undefined;
  readonly bots: ImBotStore;

  constructor(
    readonly store: Store,
    readonly plane: RoutingControlPlane,
    readonly weixin: WeixinAdapter,
    readonly feishu: FeishuAdapter,
    readonly vault: CredentialsServiceVault,
    readonly supervisor: AdapterSupervisor,
    readonly dsh: DshHost,
    readonly voice?: {
      readonly asr?: PenglaiAsrClient | undefined;
      readonly tts?: PenglaiMossTtsClient | undefined;
    },
  ) {
    const saved = this.store.getAdapterConfig("feishu-default");
    if (saved) {
      try {
        const parsed = JSON.parse(saved) as { appId?: string };
        if (parsed.appId) {
          this.feishuAppId = parsed.appId;
          this.feishu.appId = parsed.appId;
        }
      } catch {
        /* ignore corrupt adapter config */
      }
    }
    this.store.redactExpiredPayloads(this.plane.clock.now());
    this.bots = new ImBotStore(this.store.db);
  }

  attachOwner(owner: ImOwnerBrokerPort): void {
    this.owner = owner;
  }

  proposeBinding(input: {
    action: "im.bind" | "im.rebind" | "im.remove" | "im.enableGroup";
    objectId: string;
    workspaceId?: string;
    sessionId?: string;
  }): { actionId: string; action: string } {
    if (!this.owner) throw new PenglaiError("DSH_UNAVAILABLE", "owner broker required");
    const action = input.action;
    const sourceDigest = imSourceDigest({
      action,
      objectId: input.objectId,
      ...(input.workspaceId ? { workspaceId: input.workspaceId } : {}),
      ...(input.sessionId ? { sessionId: input.sessionId } : {}),
    });
    const proposal = this.owner.createProposal({
      action,
      pluginId: "@penglai/im",
      objectId: input.objectId,
      sourceDigest,
      ...(input.workspaceId ? { workspaceId: input.workspaceId } : {}),
      ...(input.sessionId ? { sessionId: input.sessionId } : {}),
    });
    return { actionId: proposal.actionId, action };
  }

  async getOverview(): Promise<{
    plugin: "active";
    channels: ChannelState[];
    manifests: ChannelManifestV1[];
    feishuAppId: string;
    feishuOwnerKnown: boolean;
    revision: number;
  }> {
    const channels: ChannelState[] = [];
    for (const id of CHANNEL_IDS) {
      channels.push(isLiveChannel(id) ? await this.channelState(id) : this.guidedChannelState(id));
    }
    return {
      plugin: "active",
      channels,
      manifests: listChannelManifests(),
      feishuAppId: this.feishuAppId,
      feishuOwnerKnown: this.feishuOwnerKnown(),
      revision: this.revision,
    };
  }

  async getOnboardingReadiness(): Promise<{ imActive: true; weixin: ConnectionState; feishu: ConnectionState }> {
    return {
      imActive: true,
      weixin: (await this.channelState("weixin")).connection,
      feishu: (await this.channelState("feishu")).connection,
    };
  }

  listWorkspacesAndSessions(): { workspaces: Array<{ id: string; title: string; sessions: string[] }> } {
    return {
      workspaces: this.dsh.listWorkspaces().map((w) => ({
        id: w.id,
        title: w.title,
        sessions: [...w.sessionIds],
      })),
    };
  }

  listBindings(): BindingDto[] {
    const out: BindingDto[] = [];
    for (const b of this.store.listActiveBindings()) {
      const route = this.store.getRoute(b.routeId);
      if (route?.adapter !== "weixin" && route?.adapter !== "feishu") continue;
      out.push({
        id: b.routeId,
        channel: route.adapter,
        accountId: route.accountRef,
        peerId: route.peerRef,
        workspaceId: b.workspaceIdentity,
        sessionId: b.sessionId,
        revision: b.revision,
        state: "active",
        voice: this.plane.getBindingVoicePolicy(b.routeId),
      });
    }
    return out;
  }

  getVoiceOptions(): {
    asr: string;
    tts: string;
    voices: Array<{ id: string; displayName: string; locale?: string }>;
    weixinNative: { enabled: boolean; pendingProbeId?: string; diagnostic?: string };
  } {
    const asr = this.voice?.asr?.describeCapability?.().model ?? "unavailable";
    const tts = this.voice?.tts?.describeCapability?.().model ?? "unavailable";
    const voices = this.voice?.tts?.listVoices?.() ?? [];
    return {
      asr,
      tts,
      voices: voices.map((row) => ({
        id: row.id,
        displayName: row.displayName?.trim() || row.id,
        ...(row.locale ? { locale: row.locale } : {}),
      })),
      weixinNative: this.weixin.nativeVoiceCapability(),
    };
  }

  async probeWeixinNativeVoice(input: { bindingId: string }) {
    const binding = this.listBindings().find((row) => row.id === input.bindingId);
    if (!binding || binding.channel !== "weixin") {
      throw new PenglaiError("BINDING_STALE", "Weixin binding unavailable for native voice probe");
    }
    return this.weixin.probeNativeVoiceBubble();
  }

  async probeWeixinText(input: { bindingId: string }) {
    const binding = this.listBindings().find((row) => row.id === input.bindingId);
    if (!binding || binding.channel !== "weixin") {
      throw new PenglaiError("BINDING_STALE", "Weixin binding unavailable for text probe");
    }
    return this.weixin.probeTextRoundTrip();
  }

  confirmWeixinNativeVoice(input: { bindingId: string; probeId: string; visible: boolean }) {
    const binding = this.listBindings().find((row) => row.id === input.bindingId);
    if (!binding || binding.channel !== "weixin") {
      throw new PenglaiError("BINDING_STALE", "Weixin binding unavailable for native voice confirmation");
    }
    return this.weixin.confirmNativeVoiceBubble({ probeId: input.probeId, visible: input.visible });
  }

  disableWeixinNativeVoice(input: { bindingId: string }) {
    const binding = this.listBindings().find((row) => row.id === input.bindingId);
    if (!binding || binding.channel !== "weixin") {
      throw new PenglaiError("BINDING_STALE", "Weixin binding unavailable for native voice disable");
    }
    return this.weixin.disableNativeVoiceBubble();
  }

  updateBindingVoicePolicy(input: {
    id: string;
    expectedRevision: number;
    inputMode: BindingVoicePolicy["inputMode"];
    replyMode: VoiceReplyMode;
    voiceId: string;
  }): BindingDto {
    const binding = this.listBindings().find((row) => row.id === input.id);
    if (!binding || binding.revision !== input.expectedRevision) {
      throw new PenglaiError("BINDING_STALE", "voice policy binding revision mismatch");
    }
    this.plane.setBindingVoiceInputMode(input.id, input.inputMode);
    this.plane.setBindingVoiceReplyMode(input.id, input.replyMode);
    this.plane.setBindingVoiceId(input.id, input.voiceId);
    this.revision += 1;
    return this.listBindings().find((row) => row.id === input.id)!;
  }

  /** Peers that have a durable vendor reply target but no active binding. */
  listBindableRoutes(): Array<{ channel: ChannelName; accountId: string; peerId: string }> {
    const bound = new Set(this.store.listActiveBindings().map((b) => b.routeId));
    const out: Array<{ channel: ChannelName; accountId: string; peerId: string }> = [];
    for (const route of this.store.listRoutes()) {
      if (bound.has(route.routeId)) continue;
      const target = this.store.getVendorReplyTarget(route.routeId);
      if (!target || target === route.peerRef) continue;
      if (route.adapter !== "weixin" && route.adapter !== "feishu") continue;
      out.push({
        channel: route.adapter,
        accountId: route.accountRef,
        peerId: route.peerRef,
      });
    }
    return out;
  }

  requireCompanionBinding(input: {
    bindingId: string;
    workspaceId: string;
    sessionId: string;
  }): BindingDto {
    const binding = this.listBindings().find(
      (row) => row.id === input.bindingId,
    );
    if (!binding || binding.state !== "active")
      throw new PenglaiError("BINDING_STALE", "companion binding unavailable");
    if (
      binding.workspaceId !== input.workspaceId ||
      binding.sessionId !== input.sessionId
    ) {
      throw new PenglaiError(
        "BINDING_STALE",
        "companion binding scope changed",
      );
    }
    this.plane.requireVendorTarget(binding.id);
    return binding;
  }

  recentUserActivity(bindingId: string): number | undefined {
    if (!this.listBindings().some((row) => row.id === bindingId)) {
      throw new PenglaiError("BINDING_STALE", "companion binding unavailable");
    }
    return this.store.latestUserInboundAt(bindingId);
  }

  sendProactive(input: {
    bindingId: string;
    workspaceId: string;
    boundSessionId: string;
    sourceSessionId: string;
    triggerId: string;
    turnId: string;
    text: string;
    deliveryMode: "text" | "voice" | "text-and-voice";
  }): { outboxIds: string[]; duplicate: boolean } {
    const binding = this.requireCompanionBinding({
      bindingId: input.bindingId,
      workspaceId: input.workspaceId,
      sessionId: input.boundSessionId,
    });
    const queued = this.plane.enqueueProactive({
      routeId: binding.id,
      expectedBindingRevision: binding.revision,
      sourceSessionId: input.sourceSessionId,
      triggerId: input.triggerId,
      turnId: input.turnId,
      text: input.text,
      deliveryMode: input.deliveryMode,
    });
    return { outboxIds: queued.outboxIds, duplicate: queued.duplicate };
  }

  async sendFileToBoundRoute(input: {
    routeId: string;
    sessionId: string;
    workspaceId?: string;
    filename: string;
    bytes: Buffer;
    digest: string;
  }): Promise<{ channel: "weixin" | "feishu"; delivered: true }> {
    const binding = this.store.activeBinding(input.routeId);
    if (
      !binding ||
      binding.sessionId !== input.sessionId ||
      (input.workspaceId !== undefined && binding.workspaceIdentity !== input.workspaceId)
    ) {
      throw new PenglaiError("BINDING_STALE", "office outbound route binding changed");
    }
    const route = this.store.getRoute(input.routeId);
    if (!route || route.status !== "active") throw new PenglaiError("BINDING_STALE", "office outbound route unavailable");
    const target = this.plane.requireVendorTarget(input.routeId);
    assertSha256(input.bytes, input.digest);
    const clientId = `penglai-office-${input.digest.replace(/^sha256:/, "").slice(0, 24)}`;
    const sent = route.adapter === "feishu"
      ? await this.feishu.sendFile(target, input.bytes, input.filename)
      : await this.weixin.sendFile(target, input.bytes, input.filename, clientId);
    if (!("ok" in sent && sent.ok)) {
      throw new PenglaiError(
        "error" in sent && sent.error === "auth" ? "AUTH_EXPIRED" : "DELIVERY_TRANSIENT",
        "office outbound file was not accepted by the channel",
      );
    }
    return { channel: route.adapter === "feishu" ? "feishu" : "weixin", delivered: true };
  }

  cancelProactive(input: { bindingId: string; triggerIds: string[] }): number {
    if (!this.listBindings().some((row) => row.id === input.bindingId))
      return 0;
    return this.plane.cancelProactive(input.bindingId, input.triggerIds);
  }

  createBinding(input: {
    channel: ChannelName;
    accountId: string;
    peerId: string;
    workspaceId: string;
    sessionId: string;
    expectedRevision?: number;
    ownerActionId: string;
    receipt?: string;
  }): BindingDto {
    if (!isLiveChannel(input.channel)) {
      throw new PenglaiError("SECURITY_POLICY", "CHANNEL_NOT_LIVE");
    }
    if (input.expectedRevision !== undefined && input.expectedRevision !== this.revision) {
      throw new PenglaiError("BINDING_STALE", "revision mismatch");
    }
    // A real peer is only known after an inbound message from the vendor; the
    // settings UI must never fabricate a route with placeholder identity.
    if (input.accountId === "default" || input.peerId === "pending-peer") {
      throw new PenglaiError(
        "INVALID_INPUT",
        "binding requires a real channel peer after scan",
      );
    }
    const workspaces = this.dsh.listWorkspaces();
    const ws = workspaces.find((w) => w.id === input.workspaceId);
    if (!ws) throw new PenglaiError("INVALID_INPUT", "workspace not found");
    if (!ws.sessionIds.includes(input.sessionId) && !this.dsh.getAgent(input.sessionId)) {
      throw new PenglaiError("INVALID_INPUT", "session not in official workspace");
    }
    const objectId = imBindingObjectId(input);
    const existing = this.store.findRoute(input.channel, input.accountId, input.peerId);
    consumeImOwnerProof(this.owner, {
      action: existing ? IM_OWNER_ACTIONS.rebind : IM_OWNER_ACTIONS.bind,
      actionId: input.ownerActionId,
      objectId,
      workspaceId: input.workspaceId,
      sessionId: input.sessionId,
      resultDigest: imSourceDigest({
        action: existing ? IM_OWNER_ACTIONS.rebind : IM_OWNER_ACTIONS.bind,
        objectId,
        workspaceId: input.workspaceId,
        sessionId: input.sessionId,
      }),
      ...(input.receipt ? { receipt: input.receipt } : {}),
    });
    const adapter = input.channel;
    const routeId = existing?.routeId ?? `route:${adapter}:${input.accountId}:${input.peerId}`;
    if (!existing) {
      this.store.upsertRoute({
        routeId,
        adapter,
        accountRef: input.accountId,
        peerRef: input.peerId,
        status: "active",
      });
    }
    const now = new Date().toISOString();
    const current = this.store.activeBinding(routeId);
    const revision = (current?.revision ?? 0) + 1;
    this.store.putBinding({
      routeId,
      workspaceIdentity: input.workspaceId,
      sessionId: input.sessionId,
      revision,
      status: "active",
      createdAt: current?.createdAt ?? now,
      updatedAt: now,
    });
    this.revision += 1;
    return this.listBindings().find((b) => b.id === routeId)!;
  }

  deleteBinding(input: { id: string; expectedRevision?: number; ownerActionId: string; receipt?: string }): { deleted: true } {
    if (input.expectedRevision !== undefined && input.expectedRevision !== this.revision) {
      throw new PenglaiError("BINDING_STALE", "revision mismatch");
    }
    consumeImOwnerProof(this.owner, {
      action: IM_OWNER_ACTIONS.remove,
      actionId: input.ownerActionId,
      objectId: input.id,
      resultDigest: imSourceDigest({ action: IM_OWNER_ACTIONS.remove, objectId: input.id }),
      ...(input.receipt ? { receipt: input.receipt } : {}),
    });
    this.store.revokeBinding(input.id, new Date().toISOString());
    this.revision += 1;
    return { deleted: true };
  }

  enableGroup(input: { routeId: string; groupId: string; ownerActionId: string }): never {
    requireImActionId(input.ownerActionId);
    throw new PenglaiError("SECURITY_POLICY", "IM_GROUP_NOT_LIVE");
  }

  async beginWeixinQr(): Promise<{ challengeId: string; ttlMs: number; status: "wait"; qrImageRef: string }> {
    if (this.qrActive) throw new PenglaiError("INVALID_INPUT", "qr challenge already active");
    const qr = await this.weixin.startQr();
    if (!qr.qrImageRef?.startsWith("data:image/png;base64,")) {
      throw new PenglaiError("INVALID_INPUT", "weixin qr image missing");
    }
    this.qrActive = true;
    this.revision += 1;
    return { challengeId: qr.qrRef, ttlMs: 300_000, status: "wait", qrImageRef: qr.qrImageRef };
  }

  async pollWeixinQr(input: { challengeId: string }): Promise<{ status: string }> {
    const status = await this.weixin.poll(input.challengeId);
    if (status === "connected" || status === "expired" || status === "error") this.qrActive = false;
    if (status === "connected") await this.startWeixinReceiveAfterScan();
    this.revision += 1;
    return { status };
  }

  async submitWeixinVerification(input: { challengeId: string; code: string }): Promise<{ status: string }> {
    if (!/^[0-9A-Za-z]{4,12}$/.test(input.code)) {
      throw new PenglaiError("INVALID_INPUT", "verification schema");
    }
    const status = await this.weixin.poll(input.challengeId, input.code);
    if (status === "connected") {
      this.qrActive = false;
      await this.startWeixinReceiveAfterScan();
    }
    this.revision += 1;
    return { status };
  }

  cancelWeixinQr(): { cancelled: true } {
    this.qrActive = false;
    this.weixin.cancelQr?.();
    this.revision += 1;
    return { cancelled: true };
  }

  async beginFeishuQr(): Promise<{
    challengeId: string;
    ttlMs: number;
    intervalMs: number;
    status: "wait";
    qrImageRef: string;
  }> {
    if (this.feishuQrId) this.cancelFeishuQr();
    const qr = await this.feishu.startQr();
    if (!qr.qrImageRef?.startsWith("data:image/png;base64,")) {
      throw new PenglaiError("INVALID_INPUT", "feishu qr image missing");
    }
    this.feishuQrId = qr.challengeId;
    this.revision += 1;
    return qr;
  }

  async pollFeishuQr(input: { challengeId: string }): Promise<{ status: string }> {
    const next = await this.feishu.pollQr(input.challengeId);
    if (next.status === "confirmed") {
      const creds = this.feishu.takeQrCredentials(input.challengeId);
      if (creds) {
        if (creds.ownerOpenId && typeof this.feishu.setOwner === "function") {
          this.feishu.setOwner(creds.ownerOpenId, "registration");
        }
        await this.configureFeishu({ appId: creds.appId, secret: creds.appSecret });
        await this.verifyAndConnectFeishu();
      }
      this.feishuQrId = "";
    } else if (next.status === "denied" || next.status === "expired" || next.status === "failed") {
      this.feishuQrId = "";
    }
    this.revision += 1;
    return { status: next.status };
  }

  cancelFeishuQr(): { cancelled: true } {
    this.feishu.cancelQr(this.feishuQrId);
    this.feishuQrId = "";
    this.revision += 1;
    return { cancelled: true };
  }

  async reconnectWeixin(): Promise<{ started: boolean }> {
    await this.supervisor.start();
    if (this.supervisor.running) await this.supervisor.restartWeixinReceive();
    this.revision += 1;
    return { started: this.supervisor.running };
  }

  async logoutWeixin(): Promise<{ loggedOut: true }> {
    this.qrActive = false;
    await this.weixin.logout();
    this.weixin.stopReceive();
    this.revision += 1;
    return { loggedOut: true };
  }

  resourceSnapshot(): {
    workers: number;
    timers: number;
    sockets: number;
    remotes: number;
    db: number;
    modelSessions: number;
    audioHandles: number;
  } {
    const resources = this.supervisor.resources();
    return {
      workers: resources.running ? 1 : 0,
      timers: resources.timers,
      sockets: resources.sockets,
      remotes: 0,
      db: this.store.isClosed() ? 0 : 1,
      modelSessions: 0,
      audioHandles: 0,
    };
  }

  releaseAll() {
    this.supervisor.stop();
    this.weixin.stopReceive();
    this.feishu.stop();
    this.store.close();
    return this.resourceSnapshot();
  }

  async configureFeishu(input: {
    appId: string;
    secret?: string;
    ownerOpenId?: string;
  }): Promise<{ configured: boolean }> {
    if (!input.appId.trim()) throw new PenglaiError("INVALID_INPUT", "app id required");
    this.feishuAppId = input.appId.trim();
    this.feishu.appId = this.feishuAppId;
    if (typeof this.feishu.setAppId === "function") this.feishu.setAppId(this.feishuAppId);
    if (input.ownerOpenId && typeof this.feishu.setOwner === "function") {
      this.feishu.setOwner(input.ownerOpenId, "explicit");
    }
    this.writeFeishuAdapterConfig();
    if (input.secret) await this.vault.write(FEISHU_SECRET_REF, input.secret);
    this.revision += 1;
    return { configured: (await this.vault.describe(FEISHU_SECRET_REF)).configured };
  }

  setFeishuOwner(input: { openId: string }): { ownerKnown: true } {
    const openId = input.openId.trim();
    if (openId.length < 3 || openId.length > 128 || !/^[A-Za-z0-9_-]+$/.test(openId)) {
      throw new PenglaiError("INVALID_INPUT", "feishu owner invalid");
    }
    if (typeof this.feishu.setOwner === "function") this.feishu.setOwner(openId, "explicit");
    this.writeFeishuAdapterConfig(openId);
    this.revision += 1;
    return { ownerKnown: true };
  }

  async verifyAndConnectFeishu(): Promise<{ connection: ConnectionState }> {
    const secret = await this.vault.read(FEISHU_SECRET_REF);
    if (!this.feishuAppId || !secret) {
      this.revision += 1;
      return { connection: "not_configured" };
    }
    await this.feishu.connect(this.feishuAppId, secret);
    this.revision += 1;
    return { connection: "connected" };
  }

  disconnectFeishu(): { disconnected: true } {
    this.feishu.stop();
    this.revision += 1;
    return { disconnected: true };
  }

  async logoutFeishu(): Promise<{ loggedOut: true }> {
    this.feishu.stop();
    await this.vault.delete(FEISHU_SECRET_REF);
    if (typeof this.feishu.clearIdentity === "function") this.feishu.clearIdentity();
    this.feishuAppId = "";
    this.feishu.appId = undefined;
    this.store.putAdapterConfig("feishu-default", "feishu", JSON.stringify({}));
    this.revision += 1;
    return { loggedOut: true };
  }

  getDiagnostics(): {
    plugin: "penglai-im";
    supervisor: boolean;
    weixin: string;
    feishu: string;
    bindings: number;
  } {
    return {
      plugin: "penglai-im",
      supervisor: this.supervisor.running,
      weixin: this.weixin.health().authState,
      feishu: this.feishu.status,
      bindings: this.store.listActiveBindings().length,
    };
  }

  private feishuOwnerKnown(): boolean {
    if (this.feishu.ownerKnown === true) return true;
    if (typeof this.feishu.getOwnerOpenId === "function" && this.feishu.getOwnerOpenId()) return true;
    return Boolean(this.readStoredFeishuOwner());
  }

  private readStoredFeishuOwner(): string | undefined {
    const raw = this.store.getAdapterConfig("feishu-default");
    if (!raw) return undefined;
    try {
      const parsed = JSON.parse(raw) as { ownerOpenId?: string };
      return typeof parsed.ownerOpenId === "string" && parsed.ownerOpenId.trim() ? parsed.ownerOpenId.trim() : undefined;
    } catch {
      return undefined;
    }
  }

  private writeFeishuAdapterConfig(ownerOpenId = this.feishu.getOwnerOpenId?.() ?? this.readStoredFeishuOwner()): void {
    this.store.putAdapterConfig(
      "feishu-default",
      "feishu",
      JSON.stringify({
        ...(this.feishuAppId ? { appId: this.feishuAppId } : {}),
        ...(ownerOpenId ? { ownerOpenId } : {}),
      }),
    );
  }

  private async startWeixinReceiveAfterScan(): Promise<void> {
    await this.supervisor.start();
    const restart = this.supervisor.restartWeixinReceive;
    if (typeof restart === "function") await restart.call(this.supervisor);
  }

  private async channelState(channel: ChannelName): Promise<ChannelState> {
    const ref = channel === "weixin" ? WEIXIN_TOKEN_REF : FEISHU_SECRET_REF;
    const configured = (await this.vault.describe(ref)).configured;
    const routes = this.store.listRoutes().filter((r) => (channel === "feishu" ? r.adapter === "feishu" : r.adapter === "weixin"));
    let pendingInbox = 0;
    let pendingOutbox = 0;
    for (const route of routes) {
      pendingInbox += this.store.queuedForRoute(route.routeId).length;
      pendingOutbox += this.store.pendingOutbox(route.routeId).length;
    }
    let connection: ConnectionState = "not_configured";
    if (channel === "weixin") {
      const auth = this.weixin.health().authState;
      if (!configured && auth === "idle") connection = "not_configured";
      else if (auth === "waiting" || auth === "scanned" || auth === "need_verify") connection = "connecting";
      else if (auth === "connected") connection = "connected";
      else if (auth === "expired") connection = "expired";
      else if (auth === "error") connection = "failed";
      else connection = configured ? "ready" : "not_configured";
    } else {
      const feishuStatus = this.feishu.status;
      if (feishuStatus === "connected") connection = "connected";
      else if (feishuStatus === "connecting" || feishuStatus === "reconnecting") connection = "connecting";
      else if (feishuStatus === "failed") connection = "failed";
      else connection = configured ? (this.feishu.setupRequired ? "blocked" : "ready") : "not_configured";
    }
    const manifest = getChannelManifest(channel);
    return {
      channel,
      configured,
      connection,
      boundRoutes: this.listBindings().filter((b) => b.channel === channel).length,
      pendingInbox,
      pendingOutbox,
      revision: this.revision,
      live: true,
      risk: manifest.risk,
      connectionMethods: manifest.connectionMethods,
    };
  }

  private guidedChannelState(channel: ChannelId): ChannelState {
    const manifest = getChannelManifest(channel);
    const bots = this.bots.list(channel);
    const connection: ConnectionState =
      manifest.risk === "community-protocol" && bots.every((bot) => !bot.riskAckAt)
        ? "disabled"
        : bots.some((bot) => bot.state === "online")
          ? "ready"
          : bots.length
            ? "not_configured"
            : "disabled";
    return {
      channel,
      configured: bots.length > 0,
      connection,
      boundRoutes: 0,
      pendingInbox: 0,
      pendingOutbox: 0,
      revision: this.revision,
      live: false,
      risk: manifest.risk,
      connectionMethods: manifest.connectionMethods,
    };
  }

  listChannelManifests(): ChannelManifestV1[] {
    return listChannelManifests();
  }

  beginGuidedConnection(input: { channel: string; method: string; riskAck?: boolean }): GuidedConnectionState {
    return beginGuidedConnection({
      channel: input.channel,
      method: input.method,
      ...(input.riskAck ? { riskAck: true } : {}),
    });
  }

  createBot(input: { channelId: string; displayName: string; riskAck?: boolean }) {
    return this.bots.create({
      channelId: input.channelId,
      displayName: input.displayName,
      ...(input.riskAck ? { riskAck: true } : {}),
    });
  }

  listBots(input: { channelId?: string } = {}) {
    return this.bots.list(input.channelId);
  }

  acknowledgeChannelRisk(input: { botId: string }) {
    return this.bots.acknowledgeRisk(input.botId);
  }

  removeBot(input: { botId: string }) {
    this.bots.remove(input.botId);
    return { removed: true };
  }
}
