import {
  PenglaiError,
  assertSha256,
  type BindingVoicePolicy,
  type PenglaiAsrClient,
  type PenglaiMossTtsClient,
  type VoiceReplyMode,
} from "@penglai/contracts";
import type { ArtifactService } from "@penglai/artifacts";
import { renderQrPngDataUrl, type WeixinAdapter } from "@penglai/channel-weixin";
import type { FeishuAdapter } from "@penglai/channel-feishu";
import type { RoutingControlPlane } from "@penglai/routing-core";
import type { Store } from "@penglai/persistence";
import type { DshHost } from "@penglai/dsh-bridge";
import {
  CHANNEL_CREDENTIAL_REFS,
  FEISHU_SECRET_REF,
  WEIXIN_TOKEN_REF,
  assertOfficialCredentialRef,
  type CredentialsServiceVault,
} from "./credentials-vault.js";
import { serializeChannelSecret } from "./channel-secrets.js";
import type { AdapterSupervisor } from "./supervisor.js";
import { ImBotStore } from "./bots.js";
import { beginGuidedConnection, type GuidedConnectionState } from "./guided.js";
import {
  CHANNEL_IDS,
  getChannelManifest,
  isNativeChannel,
  listChannelManifests,
  requireChannelId,
  type ChannelId,
  type ChannelManifestV1,
} from "./registry.js";
import { guidedAdapter, requireAdapter, type ChannelAdapter, type ConnectionResult, type ConnectionState, type InboundChannelEvent } from "./channel-adapter.js";
import { refuseUnavailableSend } from "./guided.js";
import { channelConfigAccountId, isForbiddenDefaultAccount, legacyDefaultAccountId } from "./inbound-envelope.js";
import { beginStatusReaction, CHANNEL_STATUS_REACTIONS, type StatusReactionHandle } from "./reactions.js";
import {
  classifyMessageFailure,
  classifySendOutcome,
  publicMessageFailure,
  RECOVERY_ACTION_BY_CODE,
  type MessageFailure,
} from "./message-failure.js";
import {
  IM_OWNER_ACTIONS,
  consumeImOwnerProof,
  imBindingObjectId,
  imSourceDigest,
  requireImActionId,
  type ImOwnerAction,
  type ImOwnerBrokerPort,
} from "./owner.js";

export type ChannelName = ChannelId;
export type { ConnectionState };

export interface ChannelState {
  channel: ChannelId;
  enabled: boolean;
  configured: boolean;
  connection: ConnectionState;
  boundRoutes: number;
  pendingInbox: number;
  pendingOutbox: number;
  revision: number;
  entryAvailable: true;
  adapterMode: ChannelManifestV1["adapterMode"];
  runtimeBundled: true;
  releaseEvidence: ChannelManifestV1["releaseEvidence"];
  capabilityEvidence: ChannelManifestV1["capabilityEvidence"];
  connectionMethods: ChannelManifestV1["connectionMethods"];
  error?: {
    code: string;
    action: string;
    message: { zh: string; en: string };
    referenceId: string;
    at: number;
  };
  accountRedacted?: string;
  lastCheckAt?: number;
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
  private artifacts: ArtifactService | undefined;
  private secretHydrator?: (id: ChannelId, serialized: string) => void;
  private readonly adapters = new Map<ChannelId, ChannelAdapter>();
  startupFailure: MessageFailure | undefined;
  private sidecarReady = true;
  private sidecarReadyWait: Promise<void> = Promise.resolve();
  private resolveSidecarReady: (() => void) | undefined;
  private readonly statusReactions = new Map<string, StatusReactionHandle>();
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
    for (const id of CHANNEL_IDS) {
      if (!isNativeChannel(id)) this.adapters.set(id, guidedAdapter(id));
    }
  }

  attachOwner(owner: ImOwnerBrokerPort): void {
    this.owner = owner;
  }

  attachSecretHydrator(hydrate: (id: ChannelId, serialized: string) => void): void {
    this.secretHydrator = hydrate;
  }

  attachArtifacts(artifacts: ArtifactService): void {
    this.artifacts = artifacts;
  }

  attachChannelAdapter(adapter: ChannelAdapter): void {
    this.adapters.set(adapter.id, adapter);
    this.attachInboundFanIn(adapter);
  }

  snapshotAdapter(channel: ChannelId): void {
    const adapter = this.adapters.get(channel);
    if (adapter) this.persistAdapterState(channel, adapter);
  }

  async sendOutboundText(input: { channel: ChannelId; text: string }): Promise<{ delivered: true }> {
    if (!isNativeChannel(input.channel)) {
      const adapter = this.adapters.get(input.channel);
      if (adapter) return adapter.sendText({ text: input.text });
      refuseUnavailableSend(input.channel);
    }
    throw new PenglaiError("INVALID_INPUT", "NATIVE_CHANNEL_USES_NATIVE_OUTBOX");
  }

  proposeBinding(input: {
    action: ImOwnerAction;
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
      channels.push(isNativeChannel(id) ? await this.channelState(id) : await this.guidedChannelState(id));
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
      if (!route || !(CHANNEL_IDS as readonly string[]).includes(route.adapter)) continue;
      out.push({
        id: b.routeId,
        channel: route.adapter as ChannelId,
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
    let bytes = input.bytes;
    let digest = input.digest;
    if (this.artifacts) {
      const ref = this.artifacts.ingestBytes(input.bytes, {
        name: input.filename,
        source: "im",
        scope: "turn",
        ...(input.workspaceId ? { workspaceId: input.workspaceId } : {}),
        sessionId: input.sessionId,
      });
      const read = this.artifacts.readControlled(ref.id, {
        ...(input.workspaceId ? { workspaceId: input.workspaceId } : {}),
        sessionId: input.sessionId,
      });
      bytes = read.bytes;
      digest = ref.sha256.replace(/^sha256:/, "");
    }
    assertSha256(bytes, digest);
    const clientId = `penglai-office-${digest.replace(/^sha256:/, "").slice(0, 24)}`;
    const sent = route.adapter === "feishu"
      ? await this.feishu.sendFile(target, bytes, input.filename)
      : await this.weixin.sendFile(target, bytes, input.filename, clientId);
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
    if (!isNativeChannel(input.channel)) {
      throw new PenglaiError("SECURITY_POLICY", "CHANNEL_BINDING_UNAVAILABLE");
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
    const finishOwnerAction = consumeImOwnerProof(this.owner, {
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
    finishOwnerAction();
    return this.listBindings().find((b) => b.id === routeId)!;
  }

  deleteBinding(input: { id: string; expectedRevision?: number; ownerActionId: string; receipt?: string }): { deleted: true } {
    if (input.expectedRevision !== undefined && input.expectedRevision !== this.revision) {
      throw new PenglaiError("BINDING_STALE", "revision mismatch");
    }
    const finishOwnerAction = consumeImOwnerProof(this.owner, {
      action: IM_OWNER_ACTIONS.remove,
      actionId: input.ownerActionId,
      objectId: input.id,
      resultDigest: imSourceDigest({ action: IM_OWNER_ACTIONS.remove, objectId: input.id }),
      ...(input.receipt ? { receipt: input.receipt } : {}),
    });
    this.store.revokeBinding(input.id, new Date().toISOString());
    this.revision += 1;
    finishOwnerAction();
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
    for (const adapter of this.adapters.values()) {
      void adapter.disconnect().catch(() => undefined);
    }
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
      else connection = configured ? "not_configured" : "not_configured";
    } else {
      const feishuStatus = this.feishu.status;
      if (feishuStatus === "connected") connection = "connected";
      else if (feishuStatus === "connecting" || feishuStatus === "reconnecting") connection = "connecting";
      else if (feishuStatus === "failed") connection = "failed";
      else connection = configured ? (this.feishu.setupRequired ? "blocked" : "not_configured") : "not_configured";
    }
    const manifest = getChannelManifest(channel);
    return {
      channel,
      enabled: configured,
      configured,
      connection,
      boundRoutes: this.listBindings().filter((b) => b.channel === channel).length,
      pendingInbox,
      pendingOutbox,
      revision: this.revision,
      entryAvailable: manifest.entryAvailable,
      adapterMode: manifest.adapterMode,
      runtimeBundled: manifest.runtimeBundled,
      releaseEvidence: manifest.releaseEvidence,
      capabilityEvidence: manifest.capabilityEvidence,
      connectionMethods: manifest.connectionMethods,
    };
  }

  private async guidedChannelState(channel: ChannelId): Promise<ChannelState> {
    const manifest = getChannelManifest(channel);
    const adapter = this.adapters.get(channel);
    const health = adapter ? await adapter.health() : { enabled: false, connection: "disabled" as ConnectionState };
    const failure = this.bots.getChannelFailure(channel, channelConfigAccountId(channel));
    return {
      channel,
      enabled: health.enabled,
      configured: health.connection !== "disabled" && health.connection !== "not_configured",
      connection: health.connection,
      boundRoutes: this.listBindings().filter((row) => row.channel === channel).length,
      pendingInbox: 0,
      pendingOutbox: 0,
      revision: this.revision,
      entryAvailable: manifest.entryAvailable,
      adapterMode: manifest.adapterMode,
      runtimeBundled: manifest.runtimeBundled,
      releaseEvidence: manifest.releaseEvidence,
      capabilityEvidence: manifest.capabilityEvidence,
      connectionMethods: manifest.connectionMethods,
      ...(failure
        ? {
            error: {
              code: failure.code,
              action: failure.action,
              message: { zh: failure.messageZh, en: failure.messageEn },
              referenceId: failure.referenceId,
              at: failure.at,
            },
          }
        : {}),
    };
  }

  listChannelManifests(): ChannelManifestV1[] {
    return listChannelManifests();
  }

  beginGuidedConnection(input: { channel: string; method: string }): GuidedConnectionState {
    return beginGuidedConnection({
      channel: input.channel,
      method: input.method,
    });
  }

  createBot(input: { channelId: string; displayName: string }) {
    const id = requireChannelId(input.channelId);
    if (!getChannelManifest(id).runtimeBundled) {
      throw new PenglaiError("DSH_UNAVAILABLE", `CHANNEL_RUNTIME_NOT_BUNDLED:${id}`);
    }
    return this.bots.create({
      channelId: id,
      displayName: input.displayName,
    });
  }

  listBots(input: { channelId?: string } = {}) {
    return this.bots.list(input.channelId);
  }

  removeBot(input: { botId: string }) {
    this.bots.remove(input.botId);
    return { removed: true };
  }

  attachInboundFanIn(adapter: ChannelAdapter): void {
    adapter.onInbound(async (event) => {
      try {
        await this.handleChannelInbound(event);
      } catch (error) {
        this.recordChannelFailure(event.channel, event.accountRef, error);
        throw error;
      }
    });
  }

  async storeChannelSecret(input: {
    channel: string;
    secret: string;
    ownerActionId?: string;
    receipt?: string;
  }): Promise<{ stored: true }> {
    const id = requireChannelId(input.channel);
    if (isNativeChannel(id)) throw new PenglaiError("INVALID_INPUT", "NATIVE_CHANNEL_USES_NATIVE_CONNECT");
    if (!getChannelManifest(id).runtimeBundled) {
      throw new PenglaiError("DSH_UNAVAILABLE", `CHANNEL_RUNTIME_NOT_BUNDLED:${id}`);
    }
    const secret = input.secret.trim();
    if (!secret || secret.length > 8_192) throw new PenglaiError("INVALID_INPUT", "CHANNEL_SECRET");
    const finishOwnerAction = this.consumeChannelOwner({
      action: IM_OWNER_ACTIONS.saveCredentials,
      channel: id,
      ...(input.ownerActionId ? { ownerActionId: input.ownerActionId } : {}),
      ...(input.receipt ? { receipt: input.receipt } : {}),
    });
    const ref = CHANNEL_CREDENTIAL_REFS[id];
    assertOfficialCredentialRef(ref);
    const serialized = serializeChannelSecret(id, secret);
    await this.vault.write(ref, serialized);
    this.secretHydrator?.(id, serialized);
    this.revision += 1;
    finishOwnerAction();
    return { stored: true };
  }

  async beginChannelConnection(input: {
    channel: string;
    method: string;
    secret?: string;
    ownerActionId?: string;
    receipt?: string;
  }): Promise<ConnectionResult & { steps: { en: string[]; zh: string[] }; docsUrl: string; qrImageRef?: string }> {
    const id = requireChannelId(input.channel);
    if (isNativeChannel(id)) throw new PenglaiError("INVALID_INPUT", "NATIVE_CHANNEL_USES_NATIVE_CONNECT");
    if (!getChannelManifest(id).runtimeBundled) {
      throw new PenglaiError("DSH_UNAVAILABLE", `CHANNEL_RUNTIME_NOT_BUNDLED:${id}`);
    }
    await this.waitForSidecars();
    if (input.secret) {
      await this.storeChannelSecret({
        channel: id,
        secret: input.secret,
        ...(input.ownerActionId ? { ownerActionId: input.ownerActionId } : {}),
        ...(input.receipt ? { receipt: input.receipt } : {}),
      });
    }
    const guided = beginGuidedConnection({
      channel: id,
      method: input.method,
    });
    const adapter = requireAdapter(this.adapters, id);
    let result: ConnectionResult;
    try {
      result = await adapter.beginConnection({
        method: input.method,
        credentialRef: CHANNEL_CREDENTIAL_REFS[id],
      });
    } catch (error) {
      this.recordChannelFailure(id, channelConfigAccountId(id), error);
      throw error;
    }
    this.persistChannelFlag(id, true);
    this.revision += 1;
    const qrImageRef = await encodePeekedQr(adapter.peekQr?.(result.operationId));
    return {
      ...result,
      steps: guided.steps,
      docsUrl: guided.docsUrl,
      ...(qrImageRef ? { qrImageRef } : {}),
    };
  }

  async pollChannelConnection(input: { channel: string; operationId: string }): Promise<{ status: ConnectionState; qrImageRef?: string }> {
    const id = requireChannelId(input.channel);
    const adapter = requireAdapter(this.adapters, id);
    let polled: { status: ConnectionState; accountRedacted?: string };
    try {
      polled = await adapter.pollConnection(input.operationId);
    } catch (error) {
      this.recordChannelFailure(id, channelConfigAccountId(id), error);
      throw error;
    }
    if (polled.status === "failed") {
      this.recordChannelFailure(
        id,
        channelConfigAccountId(id),
        new PenglaiError("DELIVERY_TRANSIENT", `${id} connection failed`),
      );
    }
    const qrImageRef = await encodePeekedQr(adapter.peekQr?.(input.operationId));
    this.revision += 1;
    return {
      status: polled.status,
      ...(qrImageRef ? { qrImageRef } : {}),
    };
  }

  async cancelChannelConnection(input: { channel: string; operationId?: string }): Promise<{ cancelled: true }> {
    const id = requireChannelId(input.channel);
    const adapter = requireAdapter(this.adapters, id);
    await adapter.cancelConnection(input.operationId ?? `${id}:cancel`);
    this.revision += 1;
    return { cancelled: true };
  }

  async peekChannelQr(input: { channel: string; operationId: string }): Promise<{ qrImageRef?: string; expiresAt?: number }> {
    const id = requireChannelId(input.channel);
    const adapter = requireAdapter(this.adapters, id);
    const peeked = adapter.peekQr?.(input.operationId);
    const qrImageRef = await encodePeekedQr(peeked);
    return {
      ...(qrImageRef ? { qrImageRef } : {}),
      ...(peeked?.expiresAt ? { expiresAt: peeked.expiresAt } : {}),
    };
  }

  async disconnectChannel(input: { channel: string }): Promise<{ disconnected: true }> {
    const id = requireChannelId(input.channel);
    if (isNativeChannel(id)) throw new PenglaiError("INVALID_INPUT", "NATIVE_CHANNEL_USES_NATIVE_CONNECT");
    await requireAdapter(this.adapters, id).disconnect();
    this.persistChannelFlag(id, true);
    this.revision += 1;
    return { disconnected: true };
  }

  async logoutChannel(input: {
    channel: string;
    ownerActionId?: string;
    receipt?: string;
  }): Promise<{ loggedOut: true }> {
    const id = requireChannelId(input.channel);
    if (isNativeChannel(id)) throw new PenglaiError("INVALID_INPUT", "NATIVE_CHANNEL_USES_NATIVE_CONNECT");
    const finishOwnerAction = this.consumeChannelOwner({
      action: IM_OWNER_ACTIONS.logout,
      channel: id,
      ...(input.ownerActionId ? { ownerActionId: input.ownerActionId } : {}),
      ...(input.receipt ? { receipt: input.receipt } : {}),
    });
    const adapter = requireAdapter(this.adapters, id);
    // deleteCredentials owns the adapter-specific logout/wipe operation.
    await adapter.deleteCredentials();
    await this.vault.delete(CHANNEL_CREDENTIAL_REFS[id]);
    this.persistChannelFlag(id, false);
    this.revision += 1;
    finishOwnerAction();
    return { loggedOut: true };
  }

  noteStartupFailure(error: unknown): void {
    this.startupFailure = publicMessageFailure(classifyMessageFailure(error));
  }

  deferSidecarOutbox(): void {
    if (!this.sidecarReady) return;
    this.sidecarReady = false;
    this.sidecarReadyWait = new Promise<void>((resolveReady) => {
      this.resolveSidecarReady = resolveReady;
    });
  }

  markSidecarReady(): void {
    this.sidecarReady = true;
    this.resolveSidecarReady?.();
    this.resolveSidecarReady = undefined;
  }

  private async waitForSidecars(): Promise<void> {
    await this.sidecarReadyWait;
    if (this.startupFailure) {
      throw new PenglaiError("DSH_UNAVAILABLE", "Messaging connections could not be prepared");
    }
  }

  recordChannelFailure(channel: ChannelId, accountRef: string, error: unknown): void {
    const failure = publicMessageFailure(classifyMessageFailure(error));
    this.bots.putChannelFailure({
      channelId: channel,
      accountRef,
      code: failure.code,
      messageZh: failure.message.zh,
      messageEn: failure.message.en,
      referenceId: failure.referenceId,
      action: RECOVERY_ACTION_BY_CODE[failure.code],
      at: failure.at,
    });
  }

  async restoreChannelAdapters(): Promise<void> {
    for (const id of CHANNEL_IDS) {
      if (isNativeChannel(id)) continue;
      const adapter = this.adapters.get(id);
      if (!adapter) continue;
      this.attachInboundFanIn(adapter);
      const accountId = channelConfigAccountId(id);
      try {
        this.store.migrateLegacyAdapterAccount(id, accountId);
      } catch (error) {
        this.recordChannelFailure(id, accountId, error);
        continue;
      }
      const raw = this.store.getAdapterConfig(accountId) ?? this.store.getAdapterConfig(legacyDefaultAccountId(id));
      let parsed: { enabled?: boolean } = {};
      try {
        parsed = raw ? (JSON.parse(raw) as { enabled?: boolean }) : {};
      } catch (error) {
        this.recordChannelFailure(id, accountId, error);
        parsed = {};
      }
      if (!parsed.enabled) continue;
      try {
        adapter.restorePersistedState?.(parsed);
        await adapter.beginConnection({
          method: restoreMethod(id),
          credentialRef: CHANNEL_CREDENTIAL_REFS[id],
        });
      } catch (error) {
        this.recordChannelFailure(id, accountId, error);
      }
    }
  }

  async pumpChannelOutbox(routeId: string): Promise<void> {
    if (!this.sidecarReady) return;
    const route = this.store.getRoute(routeId);
    if (!route || isNativeChannel(route.adapter) || !(CHANNEL_IDS as readonly string[]).includes(route.adapter)) return;
    const adapter = this.adapters.get(route.adapter as ChannelId);
    if (!adapter) return;
    const target = this.plane.requireVendorTarget(routeId);
    for (const item of this.plane.dueOutbox(routeId)) {
      const claimToken = this.plane.markSending(item.outboxId, route.adapter);
      if (!claimToken) continue;
      const delivery = this.plane.resolveVoiceDelivery(item.outboxId);
      try {
        await adapter.sendText({
          text: delivery.finalText,
          peerRef: delivery.vendorTarget || target,
        });
        this.plane.markDelivered(item.outboxId, claimToken);
        this.finishStatusReaction(route.adapter, route.accountRef, item.inboundId, "success");
        this.persistAdapterState(route.adapter as ChannelId, adapter);
      } catch (error) {
        this.recordChannelFailure(route.adapter as ChannelId, route.accountRef, error);
        this.finishStatusReaction(route.adapter, route.accountRef, item.inboundId, "error");
        const failure = classifyMessageFailure(error);
        if (classifySendOutcome(error) === "uncertain" || failure.code === "CHANNEL_DELIVERY_UNCERTAIN") {
          this.plane.markSendResult(item.outboxId, "uncertain", claimToken);
        } else if (failure.code === "CHANNEL_AUTH") {
          this.plane.markSendResult(item.outboxId, "auth", claimToken);
        } else if (failure.code === "CHANNEL_RATE_LIMIT") {
          this.plane.markSendResult(item.outboxId, "transient", claimToken);
        } else {
          this.plane.markSendResult(item.outboxId, "permanent", claimToken);
        }
      }
    }
  }

  private persistAdapterState(channel: ChannelId, adapter: ChannelAdapter): void {
    if (!adapter.exportPersistedState) return;
    this.persistChannelFlag(channel, true, adapter.exportPersistedState());
  }

  private startStatusReaction(adapter: ChannelAdapter, event: InboundChannelEvent): void {
    if (typeof adapter.react !== "function") return;
    const emojis = CHANNEL_STATUS_REACTIONS[event.channel];
    if (!emojis) return;
    const existing = this.statusReactions.get(event.idempotencyKey);
    if (existing) return;
    const handle = beginStatusReaction({
      key: event.idempotencyKey,
      emojis,
      add: (emoji, signal) =>
        adapter.react!({
          vendorTarget: event.vendorTarget,
          vendorMessageId: event.vendorMessageId,
          emoji,
          action: "add",
          signal,
        }),
      remove: (emoji, signal) =>
        adapter.react!({
          vendorTarget: event.vendorTarget,
          vendorMessageId: event.vendorMessageId,
          emoji,
          action: "remove",
          signal,
        }),
    });
    this.statusReactions.set(event.idempotencyKey, handle);
    if (this.statusReactions.size > 256) {
      const first = this.statusReactions.keys().next().value;
      if (first) this.statusReactions.delete(first);
    }
  }

  private finishStatusReaction(_adapter: string, _accountRef: string, inboundId: string, kind: "success" | "error"): void {
    const inbound = this.store.getInbound(inboundId);
    if (!inbound) return;
    const handle = this.statusReactions.get(inbound.adapterMessageKey);
    if (!handle) return;
    if (kind === "success") handle.success();
    else handle.error();
    this.statusReactions.delete(inbound.adapterMessageKey);
  }

  private consumeChannelOwner(input: {
    action: ImOwnerAction;
    channel: ChannelId;
    ownerActionId?: string;
    receipt?: string;
  }): () => void {
    if (!this.owner) return () => undefined;
    if (!input.ownerActionId) throw new PenglaiError("SECURITY_POLICY", "IM_OWNER_ACTION");
    return consumeImOwnerProof(this.owner, {
      action: input.action,
      actionId: input.ownerActionId,
      objectId: input.channel,
      resultDigest: imSourceDigest({ action: input.action, objectId: input.channel }),
      ...(input.receipt ? { receipt: input.receipt } : {}),
    });
  }

  private persistChannelFlag(channel: ChannelId, enabled: boolean, extra?: Record<string, unknown>): void {
    const accountId = channelConfigAccountId(channel);
    try {
      this.store.migrateLegacyAdapterAccount(channel, accountId);
    } catch {
      /* keep writing the canonical key; restore still fails closed on leftover legacy rows */
    }
    let previous: Record<string, unknown> = {};
    try {
      const raw = this.store.getAdapterConfig(accountId) ?? this.store.getAdapterConfig(legacyDefaultAccountId(channel));
      if (raw) previous = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      previous = {};
    }
    this.store.putAdapterConfig(accountId, channel, JSON.stringify({ ...previous, enabled, ...extra }));
  }

  private async handleChannelInbound(event: InboundChannelEvent): Promise<void> {
    if (
      event.chatType !== "private" ||
      event.provenPrivate !== true ||
      !event.text?.trim() ||
      !event.vendorMessageId ||
      !event.peerRef ||
      !event.vendorTarget ||
      !event.accountRef ||
      isForbiddenDefaultAccount(event.channel, event.accountRef)
    ) {
      return;
    }
    const receivedAt = event.vendorTime ?? Date.now();
    const routeId = this.plane.ensureRoute({
      adapter: event.channel,
      adapterMessageKey: event.idempotencyKey,
      accountRef: event.accountRef,
      peerRef: event.peerRef,
      vendorTarget: event.vendorTarget,
      chatKind: "private",
      bodyKind: "text",
      text: event.text,
      receivedAt,
    });
    const claim = this.store.claimInboundOperation({
      operationId: `op:${event.idempotencyKey}`,
      vendorMessageKey: event.idempotencyKey,
      routeId,
    });
    if (!claim.created && claim.turnId) return;
    const adapter = this.adapters.get(event.channel);
    if (adapter) this.startStatusReaction(adapter, event);
    try {
      await this.plane.submitInbound({
        adapter: event.channel,
        adapterMessageKey: event.idempotencyKey,
        accountRef: event.accountRef,
        peerRef: event.peerRef,
        vendorTarget: event.vendorTarget,
        chatKind: "private",
        bodyKind: "text",
        text: event.text,
        receivedAt,
      });
      if (adapter) this.persistAdapterState(event.channel, adapter);
    } catch (error) {
      this.statusReactions.get(event.idempotencyKey)?.error();
      this.statusReactions.delete(event.idempotencyKey);
      this.recordChannelFailure(event.channel, event.accountRef, error);
    }
  }
}

function restoreMethod(id: ChannelId): string {
  const methods = getChannelManifest(id).connectionMethods;
  if (methods.includes("token")) return "token";
  if (methods.includes("oauth")) return "oauth";
  if (methods.includes("manifest")) return "manifest";
  if (methods.includes("device-link")) return "device-link";
  return methods[0] ?? "token";
}

async function encodePeekedQr(
  peeked: { verificationUrl?: string; qrPayload?: string; qrImageRef?: string } | undefined,
): Promise<string | undefined> {
  const payload = peeked?.qrImageRef || peeked?.verificationUrl || peeked?.qrPayload;
  if (!payload) return undefined;
  try {
    return await renderQrPngDataUrl(payload);
  } catch {
    return undefined;
  }
}
