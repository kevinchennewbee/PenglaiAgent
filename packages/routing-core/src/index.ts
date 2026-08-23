import { createHash, timingSafeEqual } from "node:crypto";
import {
  CONFIG,
  DEFAULT_BINDING_VOICE_POLICY,
  PenglaiError,
  digestText,
  splitFragments,
  utf8Bytes,
  type AdapterName,
  type AssistantFinal,
  type Binding,
  type BindingVoicePolicy,
  type ClaimedFact,
  type ControlCommand,
  type InboundEnvelope,
  type ModelInput,
  type VoiceReplyMode,
  type PenglaiAsrEmotion,
  type PenglaiAsrLanguage,
  type PenglaiImSource,
  type PenglaiVoiceMetadata,
  type OfficialImageRef,
  type ObjectBind,
  isDiagnosticMediaCaption,
  userFacingMediaPrompt,
} from "@penglai/contracts";
import { PENDING_MENU_TTL_MS, Store, type StoredPendingMenu, type VoiceJob } from "@penglai/persistence";
import { helpText, parseCommand, welcomeMenuText } from "./commands.js";
import {
  commandLocale,
  formatProjectMenu,
  formatSessionMenu,
  menuMissingItem,
  menuSwitched,
  parseMenuPick,
  pickFromMenu,
  type MenuLocale,
  type PendingMenu,
} from "./menu.js";

export interface Clock {
  now(): number;
  iso(): string;
}

export interface Ids {
  id(prefix: string): string;
  token(): string;
}

export interface DirectoryPort {
  listWorkspaces(): Promise<{ id: string; title: string; group?: string; sessionIds?: readonly string[] }[]>;
  listSessions(workspaceIdentity: string): Promise<{ id: string; title?: string }[]>;
  createSession?(workspaceIdentity: string, title: string): Promise<{ id: string }>;
  describeSessionModels?(sessionId: string): Promise<{
    current: { provider: string; model: string; reasoningEffort?: string };
    routable: boolean;
    groups: Array<{ id: string; name: string; models: Array<{ id: string; name: string }> }>;
  }>;
  selectSessionModel?(
    sessionId: string,
    selection: { provider: string; model: string; reasoningEffort?: string },
  ): Promise<{ provider: string; model: string; reasoningEffort?: string }>;
}

export interface AgentPort {
  followup(input: ModelInput): Promise<{ dshMessageId: string }>;
  steer(input: ModelInput): Promise<{ dshMessageId: string }>;
  cancelCurrent(sessionId: string): Promise<void>;
  removeInbox(sessionId: string, dshMessageId: string): Promise<void>;
}

export interface ObjectBinder {
  bind(handle: string, bind: ObjectBind): void;
}

export interface ControlReply {
  kind: "control" | "accepted" | "rejected";
  text: string;
  errorClass?: string;
}

export interface VoiceInboundClaim {
  kind: "voice_claim";
  routeId: string;
  inboundId: string;
  bindingRevision: number;
  adapter: "weixin" | "feishu";
  adapterMessageKey: string;
  duplicate: boolean;
  state: "claimed" | "processing" | "transcribed" | "retryable" | "failed";
}

export interface CompletedVoiceTranscript {
  text: string;
  language?: string;
  emotion?: string;
}

const ASR_LANGUAGES = new Set<PenglaiAsrLanguage>(["zh", "en", "ja", "ko", "yue", "auto"]);
const ASR_EMOTIONS = new Set<PenglaiAsrEmotion>([
  "HAPPY",
  "SAD",
  "ANGRY",
  "NEUTRAL",
  "FEARFUL",
  "DISGUSTED",
  "SURPRISED",
]);

function voiceMetadata(language?: string, emotion?: string, durationMs?: number): PenglaiVoiceMetadata {
  const normalizedLanguage = (language ?? "auto").toLowerCase() as PenglaiAsrLanguage;
  const normalizedEmotion = (emotion ?? "NEUTRAL").toUpperCase() as PenglaiAsrEmotion;
  if (!ASR_LANGUAGES.has(normalizedLanguage) || !ASR_EMOTIONS.has(normalizedEmotion)) {
    throw new PenglaiError("INVALID_INPUT", "ASR metadata rejected");
  }
  if (durationMs !== undefined && (!Number.isSafeInteger(durationMs) || durationMs <= 0 || durationMs > 180_000)) {
    throw new PenglaiError("INVALID_INPUT", "ASR duration metadata rejected");
  }
  return {
    language: normalizedLanguage,
    emotion: normalizedEmotion,
    ...(durationMs === undefined ? {} : { durationMs }),
  };
}

function recoveredVoiceMetadata(job: VoiceJob | undefined): PenglaiVoiceMetadata | undefined {
  if (!job || (job.asrLanguage === undefined && job.asrEmotion === undefined)) return undefined;
  if (job.asrLanguage === undefined || job.asrEmotion === undefined) {
    throw new PenglaiError("STORE_CORRUPT", "incomplete durable ASR metadata");
  }
    return voiceMetadata(job.asrLanguage, job.asrEmotion, job.durationMs);
}

export interface ResolvedVoiceDelivery {
  routeId: string;
  outboxId: string;
  bindingRevision: number;
  vendorTarget: string;
  sourceFinalId: string;
  operationId: string;
  mode: "text" | "voice" | "text-and-voice";
  voiceId: string;
  failureFallback: "text";
  finalText: string;
}

export class RoutingControlPlane {
  constructor(
    readonly store: Store,
    readonly clock: Clock,
    readonly ids: Ids,
    readonly directory: DirectoryPort,
    readonly agent: AgentPort,
    readonly objects?: ObjectBinder,
  ) {
    this.store.expirePendingMenus(this.clock.now(), PENDING_MENU_TTL_MS);
  }

  private bindInboundObjects(env: InboundEnvelope, binding: Binding, routeId: string): void {
    if (!this.objects) return;
    const bind = { sessionId: binding.sessionId, workspaceId: binding.workspaceIdentity, routeId };
    if (env.media?.officeHandle) this.objects.bind(env.media.officeHandle, bind);
    if (env.media?.audioHandle) this.objects.bind(env.media.audioHandle, bind);
  }

  private modelInputFromInbound(
    env: InboundEnvelope,
    binding: Binding,
    inboundId: string,
    routeId: string,
    source: PenglaiImSource,
    text: string,
  ): ModelInput {
    const images: OfficialImageRef[] = env.media?.officialImage ? [env.media.officialImage] : [];
    return {
      sessionId: binding.sessionId,
      inboundId,
      routeId,
      text,
      source,
      mode: "followup",
      ...(images.length ? { images } : {}),
      ...(env.media?.officeHandle ? { officeHandle: env.media.officeHandle } : {}),
      ...(env.media?.audioHandle ? { audioHandle: env.media.audioHandle } : {}),
    };
  }

  private inboundModelText(env: InboundEnvelope): string {
    const raw = (env.text ?? "").trim();
    if (raw && !isDiagnosticMediaCaption(raw)) return raw;
    if (env.bodyKind === "media" && env.media) return userFacingMediaPrompt(env.media);
    return raw && isDiagnosticMediaCaption(raw) ? "" : raw;
  }

  recoverAfterCrash(): { sendingRecovered: number; uncertainQueued: number } {
    const sendingRecovered = this.store.recoverSendingToRetryable();
    const uncertain = this.store.queuedWithoutDshId();
    this.store.audit(
      "recover_after_crash",
      { sendingRecovered, uncertainQueued: uncertain.length },
      this.clock.now(),
    );
    return { sendingRecovered, uncertainQueued: uncertain.length };
  }

  async recoverQueuedInbounds(): Promise<{ dispatched: number; observed: number; rejected: number; failed: number }> {
    const result = { dispatched: 0, observed: 0, rejected: 0, failed: 0 };
    for (const inbound of this.store.queuedWithoutDshId()) {
      const route = this.store.getRoute(inbound.routeId);
      const binding = this.store.activeBinding(inbound.routeId);
      const text = this.store.getInboundPayloadText(inbound.inboundId);
      if (
        !route ||
        route.status !== "active" ||
        !binding ||
        binding.revision !== inbound.bindingRevision ||
        !text ||
        digestText(text) !== inbound.redactedDigest
      ) {
        this.store.setInboundState(inbound.inboundId, "no_delivery");
        this.store.audit(
          "inbound_recovery_rejected",
          { inboundId: inbound.inboundId, routeId: inbound.routeId },
          this.clock.now(),
        );
        result.rejected += 1;
        continue;
      }
      let recoveredVoice: PenglaiVoiceMetadata | undefined;
      try {
        recoveredVoice = recoveredVoiceMetadata(
          inbound.bodyKind === "voice" ? this.store.getVoiceJob(inbound.inboundId) : undefined,
        );
      } catch {
        this.store.setInboundState(inbound.inboundId, "no_delivery");
        this.store.audit(
          "inbound_recovery_rejected",
          { inboundId: inbound.inboundId, routeId: inbound.routeId },
          this.clock.now(),
        );
        result.rejected += 1;
        continue;
      }
      const source: PenglaiImSource = {
        kind: "user",
        schema: 1,
        routeId: inbound.routeId,
        inboundId: inbound.inboundId,
        adapter: route.adapter,
        ...(recoveredVoice ? { voice: recoveredVoice } : {}),
      };
      try {
        const dispatched = await (inbound.dispatchMode === "steer" ? this.agent.steer : this.agent.followup).call(
          this.agent,
          {
            sessionId: binding.sessionId,
            inboundId: inbound.inboundId,
            routeId: inbound.routeId,
            text,
            source,
            mode: inbound.dispatchMode === "steer" ? "steer" : "followup",
            recovery: true,
          },
        );
        const current = this.store.getInbound(inbound.inboundId);
        if (current?.dshMessageId) {
          result.observed += 1;
        } else if (current?.state === "queued") {
          this.store.setInboundState(inbound.inboundId, "queued", dispatched.dshMessageId);
          result.dispatched += 1;
        }
        this.store.audit(
          "inbound_recovered",
          { inboundId: inbound.inboundId, routeId: inbound.routeId, mode: inbound.dispatchMode ?? "followup" },
          this.clock.now(),
        );
      } catch {
        this.store.audit(
          "inbound_recovery_deferred",
          { inboundId: inbound.inboundId, routeId: inbound.routeId },
          this.clock.now(),
        );
        result.failed += 1;
      }
    }
    return result;
  }

  hashToken(token: string): string {
    return createHash("sha256").update(token, "utf8").digest("hex");
  }

  createPairing(input: { workspaceIdentity: string; sessionId: string; adapter: AdapterName }): { token: string; expiresAt: number } {
    const token = this.ids.token();
    if (Buffer.byteLength(token, "utf8") < 32) {
      throw new PenglaiError("SECURITY_POLICY", "pairing token too short");
    }
    const expiresAt = this.clock.now() + CONFIG.pairingTtlMs;
    this.store.putPairing(this.hashToken(token), input.workspaceIdentity, input.sessionId, input.adapter, expiresAt);
    this.store.audit("pairing_created", { sessionId: input.sessionId }, this.clock.now());
    return { token, expiresAt };
  }

  ensureRoute(env: InboundEnvelope): string {
    const existing = this.store.findRoute(env.adapter, env.accountRef, env.peerRef);
    if (existing) {
      if (env.vendorTarget) this.store.putVendorReplyTarget(existing.routeId, env.vendorTarget);
      return existing.routeId;
    }
    const routeId = this.ids.id("route");
    this.store.upsertRoute({
      routeId,
      adapter: env.adapter,
      accountRef: env.accountRef,
      peerRef: env.peerRef,
      status: "pending",
    });
    if (env.vendorTarget) this.store.putVendorReplyTarget(routeId, env.vendorTarget);
    return routeId;
  }

  async submitInbound(env: InboundEnvelope): Promise<ControlReply> {
    return this.submitInboundLocked(env);
  }

  async claimVoiceInbound(
    env: InboundEnvelope,
    media: { mediaRefJson: string; durationMs: number; expectedBytes?: number },
  ): Promise<VoiceInboundClaim | ControlReply> {
    if (env.adapter !== "weixin" && env.adapter !== "feishu") {
      return this.reject("INVALID_INPUT", "voice adapter rejected");
    }
    const adapter = env.adapter;
    if (env.chatKind !== "private" || env.bodyKind !== "voice") {
      return this.reject("INVALID_INPUT", "only private voice is accepted");
    }
    if (!env.vendorTarget || env.vendorTarget === env.peerRef) {
      return this.reject("SECURITY_POLICY", "voice vendor target required");
    }
    if (
      !Number.isSafeInteger(media.durationMs) ||
      media.durationMs <= 0 ||
      media.durationMs > 180_000
    ) {
      return this.reject("INVALID_INPUT", "voice duration rejected");
    }
    if (
      media.expectedBytes !== undefined &&
      (!Number.isSafeInteger(media.expectedBytes) || media.expectedBytes <= 0 || media.expectedBytes > 8 * 1024 * 1024)
    ) {
      return this.reject("INVALID_INPUT", "voice size rejected");
    }
    if (!media.mediaRefJson || utf8Bytes(media.mediaRefJson) > 16_384) {
      return this.reject("INVALID_INPUT", "voice media reference rejected");
    }
    try {
      const parsed = JSON.parse(media.mediaRefJson) as unknown;
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        return this.reject("INVALID_INPUT", "voice media reference shape rejected");
      }
    } catch {
      return this.reject("INVALID_INPUT", "voice media reference JSON rejected");
    }
    const routeId = this.ensureRoute(env);
    const existing = this.store.findInboundByKey(routeId, env.adapterMessageKey);
    if (existing) {
      const job = this.store.getVoiceJob(existing.inboundId);
      if (!job || job.mediaRefJson !== media.mediaRefJson || job.durationMs !== media.durationMs) {
        return this.reject("SECURITY_POLICY", "voice replay payload mismatch");
      }
      return {
        kind: "voice_claim",
        routeId,
        inboundId: existing.inboundId,
        bindingRevision: existing.bindingRevision,
        adapter,
        adapterMessageKey: env.adapterMessageKey,
        duplicate: true,
        state: job.state,
      };
    }
    if (!this.allowRouteRate(routeId)) return this.reject("INVALID_INPUT", "rate limited");
    const binding = (await this.ensureOfficialBinding(routeId))?.binding;
    if (!binding) {
      this.recordInbound(routeId, env, 0, "voice", "rejected", "");
      return this.reject("UNAUTHORIZED", "official workspace not ready");
    }
    const policy = this.store.getBindingVoicePolicy(routeId);
    if (policy.inputMode !== "text-and-voice") {
      this.recordInbound(routeId, env, binding.revision, "voice", "rejected", "");
      return this.reject("INVALID_INPUT", "voice input disabled for binding");
    }
    if (this.store.queuedForRoute(routeId).length >= CONFIG.maxQueueDepthPerRoute) {
      return this.reject("INVALID_INPUT", "queue full");
    }
    const inboundId = this.ids.id("voice");
    this.store.tx(() => {
      this.store.insertInbound(
        {
          inboundId,
          adapterMessageKey: env.adapterMessageKey,
          routeId,
          bindingRevision: binding.revision,
          bodyKind: "voice",
          redactedDigest: digestText(media.mediaRefJson),
          state: "received",
        },
        "",
        this.clock.now(),
      );
      this.store.putVoiceJob({
        inboundId,
        adapter,
        mediaRefJson: media.mediaRefJson,
        durationMs: media.durationMs,
        ...(media.expectedBytes === undefined ? {} : { expectedBytes: media.expectedBytes }),
        state: "claimed",
        updatedAt: this.clock.now(),
      });
      this.store.audit("voice_claimed", { inboundId, routeId, adapter: env.adapter }, this.clock.now());
    });
    return {
      kind: "voice_claim",
      routeId,
      inboundId,
      bindingRevision: binding.revision,
        adapter,
      adapterMessageKey: env.adapterMessageKey,
      duplicate: false,
      state: "claimed",
    };
  }

  async completeVoiceInbound(
    claim: VoiceInboundClaim,
    transcript: CompletedVoiceTranscript,
    audioDigest: string,
  ): Promise<ControlReply> {
    const text = transcript.text.trim();
    if (!text || utf8Bytes(text) > CONFIG.maxInboundUtf8Bytes || !/^[a-f0-9]{64}$/.test(audioDigest)) {
      return this.reject("INVALID_INPUT", "voice transcript or digest rejected");
    }
    const inbound = this.store.getInbound(claim.inboundId);
    const job = this.store.getVoiceJob(claim.inboundId);
    const binding = this.store.activeBinding(claim.routeId);
    if (!inbound || !job || inbound.routeId !== claim.routeId || job.adapter !== claim.adapter) {
      return this.reject("SECURITY_POLICY", "voice claim identity mismatch");
    }
    if (!binding || binding.revision !== claim.bindingRevision || inbound.bindingRevision !== claim.bindingRevision) {
      this.failVoiceInbound(claim, "BINDING_STALE", false);
      return this.reject("BINDING_STALE", "voice binding changed before transcription");
    }
    if (inbound.dshMessageId) return { kind: "accepted", text: "duplicate ignored" };
    if (!new Set(["claimed", "processing", "retryable"]).has(job.state)) {
      return this.reject("INVALID_INPUT", "voice job is not completable");
    }
    let voice: PenglaiVoiceMetadata;
    try {
      voice = voiceMetadata(transcript.language, transcript.emotion, job.durationMs);
    } catch {
      return this.reject("INVALID_INPUT", "ASR metadata rejected");
    }
    const source: PenglaiImSource = {
      kind: "user",
      schema: 1,
      routeId: claim.routeId,
      inboundId: claim.inboundId,
      adapter: claim.adapter,
      voice,
    };
    this.store.tx(() => {
      this.store.setVoiceJobState(claim.inboundId, "transcribed", this.clock.now(), {
        audioDigest,
        asrLanguage: voice.language,
        asrEmotion: voice.emotion,
      });
      this.store.setInboundPayloadAndState(claim.inboundId, text, digestText(text), "queued");
    });
    try {
      const result = await this.agent.followup({
        sessionId: binding.sessionId,
        inboundId: claim.inboundId,
        routeId: claim.routeId,
        text,
        source,
        mode: "followup",
      });
      this.store.setInboundPayloadAndState(claim.inboundId, text, digestText(text), "queued", result.dshMessageId);
      this.store.audit("voice_inbound_queued", { inboundId: claim.inboundId, routeId: claim.routeId }, this.clock.now());
      return { kind: "accepted", text: "queued" };
    } catch (err: unknown) {
      this.store.audit("voice_inbound_write_uncertain", { inboundId: claim.inboundId, routeId: claim.routeId }, this.clock.now());
      return this.reject("DSH_UNAVAILABLE", err instanceof Error ? err.message : "dsh voice write failed");
    }
  }

  markVoiceProcessing(claim: VoiceInboundClaim): void {
    this.store.setVoiceJobState(claim.inboundId, "processing", this.clock.now());
  }

  failVoiceInbound(claim: VoiceInboundClaim, errorClass: string, retryable: boolean): void {
    this.store.setVoiceJobState(
      claim.inboundId,
      retryable ? "retryable" : "failed",
      this.clock.now(),
      { errorClass },
    );
    if (!retryable) this.store.setInboundState(claim.inboundId, "rejected");
    this.store.audit("voice_processing_failed", {
      inboundId: claim.inboundId,
      routeId: claim.routeId,
      errorClass,
      retryable,
    }, this.clock.now());
  }

  pendingVoiceClaims(adapter: "weixin" | "feishu"): VoiceInboundClaim[] {
    return this.store.pendingVoiceJobs(adapter).flatMap((job) => {
      const inbound = this.store.getInbound(job.inboundId);
      if (!inbound) return [];
      return [{
        kind: "voice_claim" as const,
        routeId: inbound.routeId,
        inboundId: inbound.inboundId,
        bindingRevision: inbound.bindingRevision,
        adapter,
        adapterMessageKey: inbound.adapterMessageKey,
        duplicate: true,
        state: job.state,
      }];
    });
  }

  resolveVoiceDelivery(outboxId: string): ResolvedVoiceDelivery {
    const item = this.store.getOutbox(outboxId);
    if (!item) throw new PenglaiError("INVALID_INPUT", "outbox item missing");
    const inbound = this.store.getInbound(item.inboundId);
    if (!inbound) throw new PenglaiError("STORE_CORRUPT", "outbox inbound missing");
    const route = this.store.getRoute(item.routeId);
    const binding = this.store.activeBinding(item.routeId);
    const policy = this.store.getBindingVoicePolicy(item.routeId);
    const isControl = inbound.bodyKind === "control";
    const isCompanion = isControl && inbound.adapterMessageKey.startsWith("penglai-companion:");
    if (
      !route ||
      route.status !== "active" ||
      inbound.routeId !== item.routeId ||
      (!isControl && (!binding || binding.revision !== inbound.bindingRevision))
    ) {
      this.failClosedDelivery(item.outboxId, item.inboundId, "binding_stale");
    }
    let vendorTarget: string;
    try {
      vendorTarget = this.requireVendorTarget(item.routeId);
    } catch {
      this.failClosedDelivery(item.outboxId, item.inboundId, "vendor_target_missing");
    }
    const mode = isCompanion
      ? item.payloadKind
      : isControl
        ? "text"
      : policy.replyMode === "mirror-input"
        ? inbound.bodyKind === "voice" ? "voice" : "text"
        : policy.replyMode;
    return {
      routeId: item.routeId,
      outboxId: item.outboxId,
      bindingRevision: inbound.bindingRevision,
      vendorTarget,
      sourceFinalId: `${item.turnId}:${item.fragmentIndex}`,
      operationId: `tts_${createHash("sha256").update(item.outboxId).digest("hex").slice(0, 32)}`,
      mode,
      voiceId: policy.voiceId,
      failureFallback: policy.failureFallback,
      finalText: item.payloadText,
    };
  }

  getBindingVoicePolicy(routeId: string): BindingVoicePolicy {
    return this.store.getBindingVoicePolicy(routeId);
  }

  setBindingVoiceReplyMode(routeId: string, mode: VoiceReplyMode): BindingVoicePolicy {
    const current = this.store.getBindingVoicePolicy(routeId);
    const next = { ...current, replyMode: mode, updatedAt: this.clock.iso() };
    this.store.putBindingVoicePolicy(routeId, next);
    return next;
  }

  setBindingVoiceInputMode(routeId: string, mode: BindingVoicePolicy["inputMode"]): BindingVoicePolicy {
    if (mode !== "text-only" && mode !== "text-and-voice") {
      throw new PenglaiError("INVALID_INPUT", "voice input mode rejected");
    }
    const current = this.store.getBindingVoicePolicy(routeId);
    const next = { ...current, inputMode: mode, updatedAt: this.clock.iso() };
    this.store.putBindingVoicePolicy(routeId, next);
    return next;
  }

  setBindingVoiceId(routeId: string, voiceId: string): BindingVoicePolicy {
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(voiceId)) {
      throw new PenglaiError("INVALID_INPUT", "voice id rejected");
    }
    const current = this.store.getBindingVoicePolicy(routeId);
    const next = { ...current, voiceId, updatedAt: this.clock.iso() };
    this.store.putBindingVoicePolicy(routeId, next);
    return next;
  }

  private async submitInboundLocked(env: InboundEnvelope): Promise<ControlReply> {
    if (env.chatKind !== "private") {
      return this.reject("INVALID_INPUT", "only private text is accepted");
    }
    if (env.bodyKind === "voice" && !(env.text ?? "").trim()) {
      return this.reject("INVALID_INPUT", "voice requires ASR transcript");
    }
    if (env.bodyKind !== "text" && env.bodyKind !== "voice" && env.bodyKind !== "media") {
      return this.reject("INVALID_INPUT", "media is not accepted");
    }
    if (env.bodyKind === "media" && !env.media?.opaqueHandle) {
      return this.reject("INVALID_INPUT", "media requires a downloaded opaque handle");
    }
    if (env.bodyKind === "media" && env.media?.kind === "image" && !env.media.officialImage) {
      return this.reject("DSH_UNAVAILABLE", "image requires official DSH attachments.saveImage");
    }
    if (
      env.bodyKind === "media" &&
      (env.media?.kind === "office" || env.media?.kind === "pdf") &&
      !env.media.officeHandle
    ) {
      return this.reject("INVALID_INPUT", "office/pdf inbound requires a bound opaque office handle");
    }
    const text = this.inboundModelText(env);
    if (utf8Bytes(text) > CONFIG.maxInboundUtf8Bytes) {
      return this.reject("INVALID_INPUT", "message too large");
    }
    const routeId = this.ensureRoute(env);
    const dup = this.store.findInboundByKey(routeId, env.adapterMessageKey);
    if (dup) {
      return { kind: "accepted", text: "duplicate ignored" };
    }
    if (!this.allowRouteRate(routeId)) {
      return this.reject("INVALID_INPUT", "rate limited");
    }
    let command: ControlCommand | undefined;
    try {
      command = parseCommand(text);
    } catch (err: unknown) {
      if (err instanceof PenglaiError) return this.reject(err.errorClass, err.message);
      throw err;
    }
    // Exclusive /绑定 tokens must not auto-attach the official default first;
    // that would collide with consumeToken replay/owner checks.
    const ensured = command?.type === "bind" ? undefined : await this.ensureOfficialBinding(routeId);
    const binding = command?.type === "bind" ? this.store.activeBinding(routeId) : ensured?.binding;
    if (command) {
      const reply = await this.handleCommand(routeId, env, binding, command);
      if (reply.text) {
        const cmd = this.store.findInboundByKey(routeId, env.adapterMessageKey);
        if (cmd) this.enqueueControlReply(routeId, cmd.inboundId, reply.text);
      }
      return reply;
    }
    const menuPick = parseMenuPick(text);
    if (menuPick !== undefined && this.getMenu(routeId)) {
      const reply = await this.handleMenuPick(routeId, env, binding, menuPick);
      if (reply.text) {
        const cmd = this.store.findInboundByKey(routeId, env.adapterMessageKey);
        if (cmd) this.enqueueControlReply(routeId, cmd.inboundId, reply.text);
      }
      return reply;
    }
    if (!binding) {
      this.recordInbound(routeId, env, 0, "text", "rejected", text);
      return this.reject("UNAUTHORIZED", "official workspace not ready");
    }
    if (ensured?.created) this.enqueueWelcomeMenu(routeId, env, binding.revision);
    const queued = this.store.queuedForRoute(routeId);
    if (queued.length >= CONFIG.maxQueueDepthPerRoute) {
      return this.reject("INVALID_INPUT", "queue full");
    }
    const inboundId = this.ids.id("in");
    const source: PenglaiImSource = {
      kind: "user",
      schema: 1,
      routeId,
      inboundId,
      adapter: env.adapter,
    };
    this.store.insertInbound(
      {
        inboundId,
        adapterMessageKey: env.adapterMessageKey,
        routeId,
        bindingRevision: binding.revision,
        bodyKind: "text",
        redactedDigest: digestText(text),
        state: "queued",
      },
      text,
      this.clock.now(),
    );
    try {
      this.bindInboundObjects(env, binding, routeId);
      const result = await this.agent.followup(
        this.modelInputFromInbound(env, binding, inboundId, routeId, source, text),
      );
      const current = this.store.getInbound(inboundId);
      if (current?.state === "queued") {
        this.store.setInboundState(inboundId, "queued", result.dshMessageId);
      }
      this.store.audit("inbound_queued", { inboundId, routeId }, this.clock.now());
      return { kind: "accepted", text: "queued" };
    } catch (err: unknown) {
      this.store.audit("inbound_write_uncertain", { inboundId, routeId }, this.clock.now());
      return this.reject("DSH_UNAVAILABLE", err instanceof Error ? err.message : "dsh write failed");
    }
  }

  private async handleCommand(
    routeId: string,
    env: InboundEnvelope,
    binding: Binding | undefined,
    command: ControlCommand,
  ): Promise<ControlReply> {
    const inboundId = this.ids.id("cmd");
    this.store.insertInbound(
      {
        inboundId,
        adapterMessageKey: env.adapterMessageKey,
        routeId,
        bindingRevision: binding?.revision ?? 0,
        bodyKind: "control",
        redactedDigest: digestText(env.text ?? ""),
        state: "control_handled",
      },
      env.text ?? "",
      this.clock.now(),
    );
    if (command.type === "help") {
      this.clearMenu(routeId);
      return { kind: "control", text: helpText(Boolean(binding), commandLocale(env.text ?? "")) };
    }
    if (command.type === "bind") {
      return this.consumeToken(routeId, env.adapter, command.token);
    }
    if (!binding) {
      return this.reject("UNAUTHORIZED", "not bound");
    }
    switch (command.type) {
      case "unbind":
        this.store.revokeBinding(routeId, this.clock.iso());
        this.store.upsertRoute({ ...this.store.getRoute(routeId)!, status: "pending" });
        return { kind: "control", text: "unbound" };
      case "status": {
        const voice = this.store.getBindingVoicePolicy(routeId);
        return {
          kind: "control",
          text: `route=${routeId} session=${binding.sessionId} rev=${binding.revision} queued=${this.store.queuedForRoute(routeId).length} voice=${voice.replyMode} voiceId=${voice.voiceId}`,
        };
      }
      case "models": {
        const locale = commandLocale(env.text ?? "");
        if (!this.directory.describeSessionModels) {
          return this.reject("DSH_UNAVAILABLE", "official session model directory unavailable");
        }
        try {
          const directory = await this.directory.describeSessionModels(binding.sessionId);
          if (command.pick) {
            if (!this.directory.selectSessionModel) {
              return this.reject("DSH_UNAVAILABLE", "official session model selection unavailable");
            }
            const choices = directory.groups.flatMap((group) =>
              group.models.map((model) => ({ provider: group.id, model: model.id })),
            );
            const numeric = /^\d+$/.test(command.pick) ? Number(command.pick) : undefined;
            const chosen = numeric !== undefined
              ? choices[numeric - 1]
              : (() => {
                  const slash = command.pick.indexOf("/");
                  if (slash <= 0 || slash === command.pick.length - 1) return undefined;
                  return { provider: command.pick.slice(0, slash), model: command.pick.slice(slash + 1) };
                })();
            if (!chosen || !choices.some((row) => row.provider === chosen.provider && row.model === chosen.model)) {
              return this.reject("INVALID_INPUT", locale === "en" ? "model is not in the official session directory" : "该模型不在官方会话模型列表中");
            }
            const selected = await this.directory.selectSessionModel(binding.sessionId, chosen);
            return {
              kind: "control",
              text: locale === "en"
                ? `Model switched to ${selected.provider}/${selected.model}`
                : `模型已切换为 ${selected.provider}/${selected.model}`,
            };
          }
          const rows = directory.groups.flatMap((group) =>
            group.models.map((model) => `${group.id}/${model.id}${model.name && model.name !== model.id ? ` · ${model.name}` : ""}`),
          );
          const title = locale === "en" ? "Models" : "模型";
          const current = locale === "en" ? "Current" : "当前";
          const routeState = directory.routable ? "" : locale === "en" ? " (route unavailable)" : "（路由不可用）";
          const usage = locale === "en" ? "Send /model <number> or /model <provider/model> to switch." : "发送 /模型 <序号> 或 /模型 <供应商/模型> 切换。";
          return {
            kind: "control",
            text: [`${title}：`, `${current}：${directory.current.provider}/${directory.current.model}${routeState}`, "", ...rows.map((row, index) => `${index + 1}. ${row}`), "", usage].join("\n"),
          };
        } catch (error) {
          return this.reject("DSH_UNAVAILABLE", error instanceof Error ? error.message : "official session model operation failed");
        }
      }
      case "projects": {
        const locale = commandLocale(env.text ?? "");
        if (command.pick) {
          const n = parseMenuPick(command.pick);
          if (n !== undefined) {
            const built = await this.buildProjectMenu(binding, locale);
            this.putMenu(routeId, built.menu);
            return this.applyMenuChoice(routeId, binding, built.menu, n);
          }
        }
        const built = await this.buildProjectMenu(binding, locale);
        this.putMenu(routeId, built.menu);
        return { kind: "control", text: built.text };
      }
      case "sessions": {
        const locale = commandLocale(env.text ?? "");
        if (command.pick) {
          const n = parseMenuPick(command.pick);
          if (n !== undefined) {
            const built = await this.buildSessionMenu(binding, locale);
            this.putMenu(routeId, built.menu);
            return this.applyMenuChoice(routeId, binding, built.menu, n);
          }
        }
        const built = await this.buildSessionMenu(binding, locale);
        this.putMenu(routeId, built.menu);
        return { kind: "control", text: built.text };
      }
      case "new_session": {
        if (!this.directory.createSession) return this.reject("DSH_UNAVAILABLE", "create session unsupported");
        try {
          const created = await this.directory.createSession(binding.workspaceIdentity, command.title);
          this.rebind(routeId, binding.workspaceIdentity, created.id);
          return { kind: "control", text: `created ${created.id}` };
        } catch (error) {
          return this.reject(
            "DSH_UNAVAILABLE",
            error instanceof Error ? error.message : "official session.create failed",
          );
        }
      }
      case "steer": {
        const inboundId2 = this.ids.id("in");
        const source: PenglaiImSource = {
          kind: "user",
          schema: 1,
          routeId,
          inboundId: inboundId2,
          adapter: env.adapter,
        };
        this.store.insertInbound(
          {
            inboundId: inboundId2,
            adapterMessageKey: `${env.adapterMessageKey}:steer`,
            routeId,
            bindingRevision: binding.revision,
            bodyKind: "text",
            redactedDigest: digestText(command.text),
            state: "queued",
            dispatchMode: "steer",
          },
          command.text,
          this.clock.now(),
        );
        const r = await this.agent.steer({
          sessionId: binding.sessionId,
          inboundId: inboundId2,
          routeId,
          text: command.text,
          source,
          mode: "steer",
        });
        this.store.setInboundState(inboundId2, "queued", r.dshMessageId);
        return { kind: "control", text: "steered" };
      }
      case "stop_current": {
        await this.agent.cancelCurrent(binding.sessionId);
        const remain = this.store.queuedUnclaimed(routeId).length;
        return { kind: "control", text: `stopped current turn; queued remaining=${remain}` };
      }
      case "clear_queue": {
        const pending = this.store.queuedUnclaimed(routeId);
        for (const item of pending) {
          if (item.dshMessageId) await this.agent.removeInbox(binding.sessionId, item.dshMessageId);
          this.store.setInboundState(item.inboundId, "cancelled");
        }
        return { kind: "control", text: `cleared ${pending.length}` };
      }
      case "context_status":
        return { kind: "control", text: "资料：请到蓬莱设置里管理授权目录。" };
      case "memory_status":
        return { kind: "control", text: "记忆：长期写入需要在蓬莱设置里确认。" };
      case "budget_status":
        return { kind: "control", text: "预算：用量限制同时约束桌面和消息渠道，请到蓬莱设置里调整。" };
      case "companion_status":
        return { kind: "control", text: "陪伴：默认关闭，请到蓬莱设置里开启。" };
      case "voice_status": {
        const policy = this.store.getBindingVoicePolicy(routeId);
        return {
          kind: "control",
          text: `voice input=${policy.inputMode} reply=${policy.replyMode} voiceId=${policy.voiceId} fallback=${policy.failureFallback}`,
        };
      }
      case "voice_reply_mode": {
        const policy = this.setBindingVoiceReplyMode(routeId, command.mode);
        return { kind: "control", text: `voice reply=${policy.replyMode}` };
      }
      case "voice_id": {
        if (!command.voiceId) {
          const policy = this.store.getBindingVoicePolicy(routeId);
          return {
            kind: "control",
            text: `voice id=${policy.voiceId}; use /声音 <voice-id> or choose a MOSS-TTS voice in Penglai settings`,
          };
        }
        const policy = this.setBindingVoiceId(routeId, command.voiceId);
        return { kind: "control", text: `voice id=${policy.voiceId}` };
      }
      default:
        return this.reject("INVALID_INPUT", "unknown command");
    }
  }

  /**
   * Personal scan-then-chat: the first owner private route binds to the
   * official default Workspace/Session created during onboarding. WeChat and
   * Feishu share that same official session (Penglai 0.3 `owner:default`,
   * Hermes DM-after-scan). This is not last-focused-window guessing.
   */
  private async ensureOfficialBinding(
    routeId: string,
  ): Promise<{ binding: Binding; created: boolean } | undefined> {
    const existing = this.store.activeBinding(routeId);
    if (existing) return { binding: existing, created: false };
    const dest = await this.resolveOfficialDefault();
    if (!dest) return undefined;
    return {
      binding: this.attachSharedOfficialBinding(routeId, dest.workspaceIdentity, dest.sessionId),
      created: true,
    };
  }

  private enqueueWelcomeMenu(routeId: string, env: InboundEnvelope, bindingRevision: number): void {
    const text = welcomeMenuText();
    const inboundId = this.ids.id("welcome");
    this.store.insertInbound(
      {
        inboundId,
        adapterMessageKey: `${env.adapterMessageKey}:welcome`,
        routeId,
        bindingRevision,
        bodyKind: "control",
        redactedDigest: digestText(text),
        state: "control_handled",
      },
      text,
      this.clock.now(),
    );
    this.enqueueControlReply(routeId, inboundId, text);
  }

  private async resolveOfficialDefault(): Promise<{ workspaceIdentity: string; sessionId: string } | undefined> {
    const workspaces = await this.directory.listWorkspaces();
    for (const workspace of workspaces) {
      const sessions = await this.directory.listSessions(workspace.id);
      const first = sessions[0];
      if (first) return { workspaceIdentity: workspace.id, sessionId: first.id };
    }
    const workspace = workspaces[0];
    if (!workspace || !this.directory.createSession) return undefined;
    try {
      const created = await this.directory.createSession(workspace.id, "Penglai");
      return { workspaceIdentity: workspace.id, sessionId: created.id };
    } catch {
      return undefined;
    }
  }

  private attachSharedOfficialBinding(
    routeId: string,
    workspaceIdentity: string,
    sessionId: string,
  ): Binding {
    const current = this.store.activeBinding(routeId);
    if (current) return current;
    const now = this.clock.iso();
    this.store.putBinding({
      routeId,
      workspaceIdentity,
      sessionId,
      revision: 1,
      status: "active",
      createdAt: now,
      updatedAt: now,
    });
    this.ensureDefaultVoicePolicy(routeId);
    const route = this.store.getRoute(routeId);
    if (route) this.store.upsertRoute({ ...route, status: "active" });
    this.store.audit("owner_auto_bound", { routeId, sessionId }, this.clock.now());
    return this.store.activeBinding(routeId)!;
  }

  consumeToken(routeId: string, adapter: AdapterName, token: string): ControlReply {
    const guard = this.store.getGuard(routeId);
    if (guard.pairingLockedUntil > this.clock.now()) {
      return this.reject("SECURITY_POLICY", "pairing locked");
    }
    const attempts = guard.pairingAttempts + 1;
    this.store.putGuard(routeId, {
      ...guard,
      pairingAttempts: attempts,
      pairingLockedUntil: attempts > CONFIG.pairingMaxAttempts ? this.clock.now() + CONFIG.lockoutMs : 0,
    });
    if (attempts > CONFIG.pairingMaxAttempts) {
      return this.reject("SECURITY_POLICY", "pairing locked");
    }
    const rec = this.store.getPairing(this.hashToken(token));
    if (!rec) {
      return this.reject("UNAUTHORIZED", "invalid token");
    }
    this.store.bumpPairingAttempt(rec.tokenHash);
    if (rec.consumed) return this.reject("UNAUTHORIZED", "token reused");
    if (rec.expiresAt < this.clock.now()) return this.reject("UNAUTHORIZED", "token expired");
    if (rec.adapter !== adapter) return this.reject("UNAUTHORIZED", "token adapter mismatch");
    const owner = this.store.ownerOfSession(rec.sessionId);
    if (owner && owner.routeId !== routeId) {
      return this.reject("SECURITY_POLICY", "session already has an IM owner");
    }
    const existing = this.store.activeBinding(routeId);
    const revision = (existing?.revision ?? 0) + 1;
    if (existing) this.store.revokeBinding(routeId, this.clock.iso());
    this.store.putBinding({
      routeId,
      workspaceIdentity: rec.workspaceIdentity,
      sessionId: rec.sessionId,
      revision,
      status: "active",
      createdAt: this.clock.iso(),
      updatedAt: this.clock.iso(),
    });
    this.ensureDefaultVoicePolicy(routeId);
    this.store.consumePairing(rec.tokenHash);
    const route = this.store.getRoute(routeId);
    if (route) this.store.upsertRoute({ ...route, status: "active" });
    const g = this.store.getGuard(routeId);
    this.store.putGuard(routeId, { ...g, pairingAttempts: 0, pairingLockedUntil: 0 });
    return { kind: "control", text: "bound" };
  }

  private async buildProjectMenu(
    binding: Binding | undefined,
    locale: MenuLocale,
  ): Promise<{ text: string; menu: PendingMenu }> {
    const workspaces = await this.directory.listWorkspaces();
    return formatProjectMenu(workspaces, binding?.workspaceIdentity, locale, this.clock.now());
  }

  private async buildSessionMenu(
    binding: Binding,
    locale: MenuLocale,
  ): Promise<{ text: string; menu: PendingMenu }> {
    const workspaces = await this.directory.listWorkspaces();
    const workspace = workspaces.find((row) => row.id === binding.workspaceIdentity);
    const sessions = await this.directory.listSessions(binding.workspaceIdentity);
    return formatSessionMenu(
      workspace?.title ?? binding.workspaceIdentity,
      sessions,
      binding.sessionId,
      binding.workspaceIdentity,
      locale,
      this.clock.now(),
    );
  }

  private putMenu(routeId: string, menu: PendingMenu): void {
    this.store.putPendingMenu(routeId, menu);
  }

  private getMenu(routeId: string): PendingMenu | undefined {
    const stored: StoredPendingMenu | undefined = this.store.getPendingMenu(routeId, this.clock.now(), PENDING_MENU_TTL_MS);
    return stored;
  }

  private clearMenu(routeId: string): void {
    this.store.deletePendingMenu(routeId);
  }

  private async handleMenuPick(
    routeId: string,
    env: InboundEnvelope,
    binding: Binding | undefined,
    n: number,
  ): Promise<ControlReply> {
    const inboundId = this.ids.id("cmd");
    this.store.insertInbound(
      {
        inboundId,
        adapterMessageKey: env.adapterMessageKey,
        routeId,
        bindingRevision: binding?.revision ?? 0,
        bodyKind: "control",
        redactedDigest: digestText(env.text ?? ""),
        state: "control_handled",
      },
      env.text ?? "",
      this.clock.now(),
    );
    if (!binding) return this.reject("UNAUTHORIZED", "not bound");
    const menu = this.getMenu(routeId);
    return this.applyMenuChoice(routeId, binding, menu, n);
  }

  private async applyMenuChoice(
    routeId: string,
    binding: Binding,
    menu: PendingMenu | undefined,
    n: number,
  ): Promise<ControlReply> {
    const choice = pickFromMenu(menu, n);
    const locale = menu?.locale ?? "zh";
    if (!choice) {
      return { kind: "control", text: menuMissingItem(n, locale) };
    }
    let sessionId = choice.sessionId;
    if (!sessionId) {
      const sessions = await this.directory.listSessions(choice.workspaceId);
      sessionId = sessions[0]?.id;
      if (!sessionId && this.directory.createSession) {
        sessionId = (await this.directory.createSession(choice.workspaceId, "Penglai")).id;
      }
    }
    if (!sessionId) {
      return this.reject("DSH_UNAVAILABLE", "official session missing for selected project");
    }
    this.clearMenu(routeId);
    this.rebind(routeId, choice.workspaceId, sessionId);
    return { kind: "control", text: menuSwitched(choice.label, locale) };
  }

  rebind(routeId: string, workspaceIdentity: string, sessionId: string): ControlReply {
    const owner = this.store.ownerOfSession(sessionId);
    if (owner && owner.routeId !== routeId) {
      this.store.revokeBinding(owner.routeId, this.clock.iso());
    }
    const existing = this.store.activeBinding(routeId);
    const revision = (existing?.revision ?? 0) + 1;
    if (existing) this.store.revokeBinding(routeId, this.clock.iso());
    this.store.putBinding({
      routeId,
      workspaceIdentity,
      sessionId,
      revision,
      status: "active",
      createdAt: this.clock.iso(),
      updatedAt: this.clock.iso(),
    });
    this.ensureDefaultVoicePolicy(routeId);
    return { kind: "control", text: `rebound rev=${revision}` };
  }

  onClaimed(fact: ClaimedFact): void {
    this.store.tx(() => {
      const claimedSource = fact.source as Record<string, unknown>;
      if (
        (claimedSource.kind !== "user" && claimedSource.kind !== "penglai-im") ||
        claimedSource.schema !== 1 ||
        typeof claimedSource.routeId !== "string" ||
        !claimedSource.routeId ||
        typeof claimedSource.inboundId !== "string" ||
        !claimedSource.inboundId ||
        !["mock", "weixin", "feishu"].includes(String(claimedSource.adapter))
      ) {
        this.store.audit("claimed_ignored_source", { dshMessageId: fact.dshMessageId }, this.clock.now());
        return;
      }
      const src = claimedSource as unknown as PenglaiImSource;
      const inbound = this.store.getInbound(src.inboundId);
      if (!inbound) {
        this.store.audit("claimed_unknown_inbound", { inboundId: src.inboundId }, this.clock.now());
        return;
      }
      if (inbound.routeId !== src.routeId) {
        this.store.audit("claimed_route_mismatch", { inboundId: inbound.inboundId }, this.clock.now());
        return;
      }
      const existing = this.store.correlationByDshMessage(fact.dshMessageId);
      if (existing) return;
      this.store.putCorrelation({
        inboundId: inbound.inboundId,
        dshMessageId: fact.dshMessageId,
        turnId: fact.turnId,
        sessionId: fact.sessionId,
        routeId: inbound.routeId,
        bindingRevision: inbound.bindingRevision,
      });
      this.store.setInboundState(inbound.inboundId, "claimed", fact.dshMessageId);
    });
  }

  onAssistantFinal(final: AssistantFinal): void {
    this.store.tx(() => {
      const corr = this.store.correlationByTurn(final.sessionId, final.turnId);
      if (!corr) {
        this.store.audit("output_no_correlation", { turnId: final.turnId }, this.clock.now());
        return;
      }
      const binding = this.store.activeBinding(corr.routeId);
      if (!binding || binding.revision !== corr.bindingRevision) {
        this.store.setInboundState(corr.inboundId, "no_delivery");
        this.store.audit("output_stale_binding", { inboundId: corr.inboundId }, this.clock.now());
        return;
      }
      if (!final.text.trim()) {
        this.store.setInboundState(corr.inboundId, "no_delivery");
        return;
      }
      if (this.store.hasOutboxFor(corr.inboundId)) {
        return;
      }
      const fragments = splitFragments(final.text);
      let seq = this.store.nextOutboxSeq(corr.routeId);
      fragments.forEach((frag: string, idx: number) => {
        this.store.insertOutbox({
          outboxId: this.ids.id("out"),
          routeId: corr.routeId,
          inboundId: corr.inboundId,
          turnId: corr.turnId,
          sequence: seq,
          payloadKind: "text",
          payloadRef: digestText(frag),
          payloadText: frag,
          state: "pending",
          attempts: 0,
          nextAttemptAt: this.clock.now(),
          fragmentIndex: idx,
          fragmentCount: fragments.length,
        });
        seq += 1;
      });
      this.store.setInboundState(corr.inboundId, "outbox_pending");
    });
  }

  enqueueProactive(input: {
    routeId: string;
    expectedBindingRevision: number;
    sourceSessionId: string;
    triggerId: string;
    turnId: string;
    text: string;
    deliveryMode: "text" | "voice" | "text-and-voice";
  }): { inboundId: string; outboxIds: string[]; duplicate: boolean } {
    if (!/^comp_[a-f0-9]{64}$/.test(input.triggerId)) {
      throw new PenglaiError(
        "INVALID_INPUT",
        "opaque companion trigger id required",
      );
    }
    if (!input.sourceSessionId || !input.turnId)
      throw new PenglaiError(
        "INVALID_INPUT",
        "companion Turn identity required",
      );
    if (
      !input.text.trim() ||
      utf8Bytes(input.text) > CONFIG.maxInboundUtf8Bytes
    ) {
      throw new PenglaiError("INVALID_INPUT", "companion output text invalid");
    }
    return this.store.tx(() => {
      const binding = this.store.activeBinding(input.routeId);
      if (!binding || binding.revision !== input.expectedBindingRevision) {
        throw new PenglaiError(
          "BINDING_STALE",
          "companion binding is no longer active",
        );
      }
      this.requireVendorTarget(input.routeId);
      const adapterMessageKey = `penglai-companion:${input.triggerId}`;
      const existing = this.store.findInboundByKey(
        input.routeId,
        adapterMessageKey,
      );
      if (existing) {
        return {
          inboundId: existing.inboundId,
          outboxIds: this.store
            .outboxForInbound(existing.inboundId)
            .map((item) => item.outboxId),
          duplicate: true,
        };
      }
      if (
        this.store.pendingOutbox(input.routeId).length >=
        CONFIG.maxOutboxPerRoute
      ) {
        throw new PenglaiError(
          "DELIVERY_TRANSIENT",
          "companion outbox is full",
        );
      }
      const inboundId = this.ids.id("companion");
      this.store.insertInbound(
        {
          inboundId,
          adapterMessageKey,
          routeId: input.routeId,
          bindingRevision: binding.revision,
          bodyKind: "control",
          redactedDigest: digestText(input.triggerId),
          state: "outbox_pending",
        },
        "",
        this.clock.now(),
      );
      const fragments = splitFragments(input.text);
      let sequence = this.store.nextOutboxSeq(input.routeId);
      const outboxIds: string[] = [];
      fragments.forEach((fragment, index) => {
        const outboxId = this.ids.id("out");
        outboxIds.push(outboxId);
        this.store.insertOutbox({
          outboxId,
          routeId: input.routeId,
          inboundId,
          turnId: `${input.sourceSessionId}:${input.turnId}`,
          sequence,
          payloadKind: input.deliveryMode,
          payloadRef: digestText(fragment),
          payloadText: fragment,
          state: "pending",
          attempts: 0,
          nextAttemptAt: this.clock.now(),
          fragmentIndex: index,
          fragmentCount: fragments.length,
        });
        sequence += 1;
      });
      this.store.audit(
        "companion_outbox_queued",
        {
          triggerId: input.triggerId,
          routeId: input.routeId,
          sourceSessionId: input.sourceSessionId,
          turnId: input.turnId,
          deliveryMode: input.deliveryMode,
        },
        this.clock.now(),
      );
      return { inboundId, outboxIds, duplicate: false };
    });
  }

  /**
   * Turn a slash-command reply into an outbox item so the adapter delivers it
   * back to the same channel. Control replies previously never reached the
   * vendor, so `/绑定` (and every other command) produced no user-visible ack.
   * Control outbox items use the already-persisted `control` inbound row, whose
   * route carries the vendor reply target recorded when the message was
   * claimed; they do not enter the model and do not require an active binding.
   */
  enqueueControlReply(routeId: string, inboundId: string, text: string): { outboxId: string; duplicate: boolean } | null {
    return this.store.tx(() => {
      const existing = this.store.outboxForInbound(inboundId);
      if (existing.length > 0) {
        return { outboxId: existing[0]!.outboxId, duplicate: true };
      }
      // A command ack is best-effort: without a durable vendor reply target it
      // must be skipped (fail-closed), never throw and never block the command.
      try {
        this.requireVendorTarget(routeId);
      } catch {
        return null;
      }
      const outboxId = this.ids.id("out");
      const sequence = this.store.nextOutboxSeq(routeId);
      this.store.insertOutbox({
        outboxId,
        routeId,
        inboundId,
        turnId: `control:${inboundId}`,
        sequence,
        payloadKind: "text",
        payloadRef: digestText(text),
        payloadText: text,
        state: "pending",
        attempts: 0,
        nextAttemptAt: this.clock.now(),
        fragmentIndex: 0,
        fragmentCount: 1,
      });
      this.store.audit("control_reply_queued", { outboxId, routeId, inboundId }, this.clock.now());
      return { outboxId, duplicate: false };
    });
  }

  cancelProactive(routeId: string, triggerIds: string[]): number {
    return this.store.tx(() => {
      let cancelled = 0;
      for (const trigger of new Set(triggerIds)) {
        if (!/^comp_[a-f0-9]{64}$/.test(trigger)) continue;
        const inbound = this.store.findInboundByKey(
          routeId,
          `penglai-companion:${trigger}`,
        );
        if (!inbound) continue;
        for (const item of this.store.outboxForInbound(inbound.inboundId)) {
          if (
            item.state === "pending" ||
            item.state === "retryable" ||
            item.state === "sending"
          ) {
            this.store.setOutboxState(
              item.outboxId,
              "dead",
              item.attempts,
              this.clock.now(),
            );
            cancelled += 1;
          }
        }
        this.store.setInboundState(inbound.inboundId, "no_delivery");
      }
      if (cancelled)
        this.store.audit(
          "companion_outbox_cancelled",
          { routeId, count: cancelled },
          this.clock.now(),
        );
      return cancelled;
    });
  }

  noteDesktopTurn(sessionId: string, turnId: string): void {
    this.store.audit("desktop_turn", { sessionId, turnId }, this.clock.now());
  }

  markSending(outboxId: string, workerId = "local"): string | undefined {
    const item = this.store.getOutbox(outboxId);
    if (!item) return undefined;
    if (item.state === "delivered" || item.state === "dead") return undefined;
    const claimed =
      item.state === "claimed" && item.workerId === workerId && item.claimToken
        ? item
        : this.store.claimOutbox({ outboxId, workerId, now: this.clock.now() });
    if (!claimed?.claimToken) return undefined;
    const ok = this.store.setOutboxState(outboxId, "sending", claimed.attempts, claimed.nextAttemptAt, {
      expectedStates: ["claimed"],
      workerId,
      claimToken: claimed.claimToken,
    });
    return ok ? claimed.claimToken : undefined;
  }

  markDelivered(outboxId: string, claimToken?: string): void {
    const existing = this.store.getOutbox(outboxId);
    if (existing?.state === "delivered") return;
    const token = claimToken ?? existing?.claimToken;
    if (!token) return;
    const ok = this.store.setOutboxState(outboxId, "delivered", existing?.attempts ?? 0, this.clock.now(), {
      expectedStates: ["sending", "claimed"],
      claimToken: token,
    });
    if (!ok) return;
    const item = this.store.getOutbox(outboxId);
    if (item && item.fragmentIndex + 1 === item.fragmentCount) {
      this.store.setInboundState(item.inboundId, "delivered");
    }
  }

  markSendResult(outboxId: string, result: "delivered" | "transient" | "permanent" | "auth", claimToken?: string): void {
    const item = this.store.getOutbox(outboxId);
    if (!item) return;
    const token = claimToken ?? item.claimToken;
    if (result === "delivered") {
      this.markDelivered(outboxId, token);
      return;
    }
    if (item.state === "delivered" || item.state === "dead") return;
    if (result === "auth") {
      this.store.setOutboxState(outboxId, "retryable", item.attempts, this.clock.now() + 86_400_000, {
        expectedStates: ["pending", "claimed", "sending", "uncertain"],
        ...(token ? { claimToken: token } : {}),
      });
      return;
    }
    if (result === "permanent") {
      this.store.setOutboxState(outboxId, "dead", item.attempts + 1, this.clock.now(), {
        expectedStates: ["pending", "claimed", "sending", "uncertain", "retryable"],
        ...(token ? { claimToken: token } : {}),
      });
      this.store.setInboundState(item.inboundId, "dead");
      return;
    }
    const attempts = item.attempts + 1;
    if (attempts >= CONFIG.outboxMaxAttempts) {
      this.store.setOutboxState(outboxId, "dead", attempts, this.clock.now(), {
        expectedStates: ["claimed", "sending", "uncertain", "retryable"],
        ...(token ? { claimToken: token } : {}),
      });
      this.store.setInboundState(item.inboundId, "dead");
      return;
    }
    const backoff = CONFIG.outboxBaseBackoffMs * 2 ** (attempts - 1);
    this.store.setOutboxState(outboxId, "uncertain", attempts, this.clock.now() + backoff, {
      expectedStates: ["claimed", "sending"],
      ...(token ? { claimToken: token } : {}),
    });
  }

  dueOutbox(routeId: string): ReturnType<Store["pendingOutbox"]> {
    return this.store.pendingOutbox(routeId).filter((i: { nextAttemptAt: number; state: string; leaseUntil?: number }) => {
      if (i.state === "sending" && (i.leaseUntil ?? 0) > this.clock.now()) return false;
      if (i.state === "claimed" && (i.leaseUntil ?? 0) > this.clock.now()) return false;
      return i.nextAttemptAt <= this.clock.now();
    });
  }

  requireVendorTarget(routeId: string): string {
    const target = this.store.getVendorReplyTarget(routeId);
    if (!target || target === this.store.getRoute(routeId)?.peerRef) {
      throw new PenglaiError("SECURITY_POLICY", "vendor reply target required");
    }
    return target;
  }

  failClosedMissingTarget(routeId: string): number {
    try {
      this.requireVendorTarget(routeId);
      return 0;
    } catch {
      const items = this.store.pendingOutbox(routeId);
      for (const item of items) {
        this.store.setOutboxState(item.outboxId, "dead", item.attempts + 1, this.clock.now(), {
          expectedStates: ["pending", "retryable", "claimed", "sending", "uncertain"],
        });
        this.store.setInboundState(item.inboundId, "dead");
        this.store.audit("outbox_fail_closed_no_vendor_target", { outboxId: item.outboxId, routeId }, this.clock.now());
      }
      return items.length;
    }
  }

  private failClosedDelivery(outboxId: string, inboundId: string, reason: string): never {
    const item = this.store.getOutbox(outboxId);
    this.store.tx(() => {
      if (item && item.state !== "delivered" && item.state !== "dead") {
        this.store.setOutboxState(outboxId, "dead", item.attempts + 1, this.clock.now());
      }
      this.store.setInboundState(inboundId, "no_delivery");
      this.store.audit("outbox_delivery_rejected", { outboxId, inboundId, reason }, this.clock.now());
    });
    throw new PenglaiError(
      reason === "binding_stale" ? "BINDING_STALE" : "SECURITY_POLICY",
      `outbox delivery rejected: ${reason}`,
    );
  }

  safeEqualHash(a: string, b: string): boolean {
    const ba = Buffer.from(a);
    const bb = Buffer.from(b);
    if (ba.length !== bb.length) return false;
    return timingSafeEqual(ba, bb);
  }

  private ensureDefaultVoicePolicy(routeId: string): void {
    const current = this.store.getBindingVoicePolicy(routeId);
    if (current.updatedAt !== DEFAULT_BINDING_VOICE_POLICY.updatedAt) return;
    this.store.putBindingVoicePolicy(routeId, {
      ...DEFAULT_BINDING_VOICE_POLICY,
      updatedAt: this.clock.iso(),
    });
  }

  private recordInbound(
    routeId: string,
    env: InboundEnvelope,
    rev: number,
    kind: "text" | "voice" | "control",
    state: "rejected",
    text: string,
  ): void {
    this.store.insertInbound(
      {
        inboundId: this.ids.id("in"),
        adapterMessageKey: env.adapterMessageKey,
        routeId,
        bindingRevision: rev,
        bodyKind: kind,
        redactedDigest: digestText(text),
        state,
      },
      text,
      this.clock.now(),
    );
  }

  diagnostics(): {
    schemaVersion: number;
    routes: number;
    bindings: number;
    deadOutbox: number;
    uncertainQueued: number;
  } {
    return {
      schemaVersion: this.store.schemaVersion(),
      routes: this.store.listRoutes().length,
      bindings: this.store.listActiveBindings().length,
      deadOutbox: this.store.deadOutbox().length,
      uncertainQueued: this.store.queuedWithoutDshId().length,
    };
  }

  private allowRouteRate(routeId: string): boolean {
    const now = this.clock.now();
    const guard = this.store.getGuard(routeId);
    const windowMs = 60_000;
    if (now - guard.rateWindowStart >= windowMs) {
      this.store.putGuard(routeId, { ...guard, rateWindowStart: now, rateCount: 1 });
      return true;
    }
    if (guard.rateCount >= CONFIG.routeRatePerMinute) {
      return false;
    }
    this.store.putGuard(routeId, { ...guard, rateCount: guard.rateCount + 1 });
    return true;
  }

  private reject(errorClass: string, text: string): ControlReply {
    return { kind: "rejected", text, errorClass };
  }
}

export { parseCommand, helpText, welcomeMenuText } from "./commands.js";
