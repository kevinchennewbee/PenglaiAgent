import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { Context } from "@deepseek-ai/cordis";
import {
  PenglaiError,
  ObjectStore,
  type ImageAdmission,
  type PenglaiAsrClient,
  type PenglaiMossTtsClient,
} from "@penglai/contracts";
import { CryptoIds, SystemClock } from "./runtime-ids.js";
import { Store } from "@penglai/persistence";
import { RoutingControlPlane } from "@penglai/routing-core";
import { DshBridge, PINNED_DSH, withPenglaiVoiceContext, type DshHost } from "@penglai/dsh-bridge";
import { hostFromCordis, listenOfficialEvents, type CordisLike } from "@penglai/dsh-bridge/plugin";
import { FeishuAdapter } from "@penglai/channel-feishu";
import { ILinkTransport, WeixinAdapter } from "@penglai/channel-weixin";
import { DingTalkAdapter } from "@penglai/channel-dingtalk";
import { WeComAdapter } from "@penglai/channel-wecom";
import { QqAdapter } from "@penglai/channel-qq";
import { SlackAdapter } from "@penglai/channel-slack";
import { TelegramAdapter } from "@penglai/channel-telegram";
import { DiscordAdapter } from "@penglai/channel-discord";
import { EncryptedWhatsAppSessionStore, WhatsAppDeviceAdapter } from "@penglai/channel-whatsapp";
import {
  dingtalkChannelAdapter,
  discordChannelAdapter,
  qqChannelAdapter,
  slackChannelAdapter,
  telegramChannelAdapter,
  wecomChannelAdapter,
  whatsappChannelAdapter,
} from "./adapters/channel-bridge.js";
import { CHANNEL_CREDENTIAL_REFS, CredentialsServiceVault, type CredentialsLike } from "./credentials-vault.js";
import { AdapterSupervisor, WorkerLease } from "./supervisor.js";
import { ArtifactService } from "@penglai/artifacts";
import { OwnerApprovalBroker } from "@penglai/runtime/owner-broker";
import { createHostOwnerDialog } from "@penglai/runtime/owner-dialog";
import { PenglaiImHost } from "./host.js";
import { PenglaiImRemote } from "./remote.js";

export const name = "@penglai/im";
export const inject = [
  "agents",
  "workspaceRegistry",
  "credentials",
  "apiProxy",
  "attachments",
];

export function createRuntime(opts: {
  dbPath: string;
  host: DshHost;
  token?: string;
  objects?: ObjectStore;
}) {
  const store = new Store(opts.dbPath);
  const bridge = new DshBridge(opts.host);
  const plane = new RoutingControlPlane(
    store,
    SystemClock,
    new CryptoIds(),
    bridge,
    bridge,
    opts.objects ? { bind: (handle, bind) => opts.objects!.bind(handle, bind) } : undefined,
  );
  plane.recoverAfterCrash();
  return { store, plane, token: opts.token ?? new CryptoIds().token() };
}

function credentialsFrom(ctx: CordisLike): CredentialsLike | undefined {
  const raw = (ctx as CordisLike & { credentials?: CredentialsLike }).credentials;
  if (!raw || typeof raw.set !== "function" || typeof raw.describe !== "function") return undefined;
  return raw;
}

export function optionalVoiceServicesFrom(ctx: CordisLike): {
  readonly asr?: PenglaiAsrClient | undefined;
  readonly tts?: PenglaiMossTtsClient | undefined;
} {
  const services = ctx as CordisLike & {
    get?: (name: string, strict?: boolean) => unknown;
    penglaiAsr?: PenglaiAsrClient;
    penglaiMossTts?: PenglaiMossTtsClient;
  };
  const resolve = <T>(name: "penglaiAsr" | "penglaiMossTts"): T | undefined => {
    if (typeof services.get === "function") return services.get(name, true) as T | undefined;
    return services[name] as T | undefined;
  };
  return {
    get asr() {
      return resolve<PenglaiAsrClient>("penglaiAsr");
    },
    get tts() {
      return resolve<PenglaiMossTtsClient>("penglaiMossTts");
    },
  };
}

export async function addVoiceContextAtOfficialPreStep(next: unknown): Promise<unknown> {
  if (typeof next !== "function") return { kind: "reject" };
  const decision = await (next as () => unknown)();
  if (!decision || typeof decision !== "object") return decision;
  const entered = decision as Record<string, unknown>;
  if (entered.kind !== "enter" || !Array.isArray(entered.messages)) return decision;
  return { ...entered, messages: withPenglaiVoiceContext(entered.messages) };
}

export function apply(ctx: CordisLike): ReturnType<typeof createRuntime> & { host: PenglaiImHost; supervisor: AdapterSupervisor } {
  const userData = process.env.PENGLAI_USER_DATA;
  const dbPath = process.env.PENGLAI_DB ?? (userData ? join(userData, "im", "penglai-im.sqlite") : "");
  if (!userData || !dbPath) {
    throw new PenglaiError("DSH_UNAVAILABLE", "PENGLAI_USER_DATA required for @penglai/im");
  }
  mkdirSync(dirname(dbPath), { recursive: true, mode: 0o700 });
  const dsh = hostFromCordis(ctx, process.env.PENGLAI_DSH_PIN ?? PINNED_DSH);
  const objects = new ObjectStore(join(userData, "objects"));
  const attachments = (ctx as CordisLike & { attachments?: ImageAdmission }).attachments;
  const rt = createRuntime({
    dbPath,
    host: dsh,
    objects,
    ...(process.env.PENGLAI_CONTROL_TOKEN ? { token: process.env.PENGLAI_CONTROL_TOKEN } : {}),
  });
  listenOfficialEvents(ctx, rt.plane);
  ctx.on(
    "agent/pre-step",
    (_payload, next) => addVoiceContextAtOfficialPreStep(next),
    { global: true, prepend: true },
  );
  const vault = new CredentialsServiceVault(credentialsFrom(ctx));
  // ASR and TTS are optional, hot-pluggable capabilities. IM text routing
  // must stay active when either plugin is absent; adapters resolve the
  // current service on each voice operation and fail/fallback locally.
  const voice = optionalVoiceServicesFrom(ctx);
  const savedFeishu = rt.store.getAdapterConfig("feishu-default");
  let feishuAppId = process.env.PENGLAI_FEISHU_APP_ID;
  if (savedFeishu) {
    try {
      const parsed = JSON.parse(savedFeishu) as { appId?: string };
      if (parsed.appId) feishuAppId = parsed.appId;
    } catch {
      /* ignore corrupt adapter config */
    }
  }
  const weixin = new WeixinAdapter(
    rt.plane,
    new ILinkTransport(),
    vault,
    "weixin-default",
    rt.store,
    voice,
    rt.store,
  );
  const feishu = new FeishuAdapter(
    rt.plane,
    feishuAppId,
    undefined,
    rt.store,
    feishuAppId ? { appId: feishuAppId } : undefined,
    voice,
  );
  if (attachments) {
    weixin.imageAdmission = attachments;
    feishu.imageAdmission = attachments;
  }
  weixin.objectStore = objects;
  feishu.objectStore = objects;
  ctx.on("internal/service", (...args: unknown[]) => {
    if (args[0] !== "penglaiAsr" || !voice.asr) return;
    queueMicrotask(() => {
      weixin.retryPendingVoiceClaims();
      feishu.retryPendingVoiceClaims();
    });
  });
  let lastInboundRecoveryAt = 0;
  let imHost: PenglaiImHost | undefined;
  const supervisor = new AdapterSupervisor(weixin, feishu, vault, async () => {
    const now = Date.now();
    if (now - lastInboundRecoveryAt >= 5_000) {
      lastInboundRecoveryAt = now;
      await rt.plane.recoverQueuedInbounds();
    }
    for (const route of rt.store.listRoutes()) {
      const closed = rt.plane.failClosedMissingTarget(route.routeId);
      if (closed > 0) continue;
      const target = rt.plane.requireVendorTarget(route.routeId);
      if (route.adapter === "weixin") await weixin.pumpOutbox(route.routeId, target);
      if (route.adapter === "feishu") await feishu.pumpOutbox(route.routeId, target);
      await imHost?.pumpChannelOutbox(route.routeId);
    }
  });
  const host = new PenglaiImHost(rt.store, rt.plane, weixin, feishu, vault, supervisor, dsh, voice);
  imHost = host;
  const dingtalkCreds: Record<string, { clientId: string; clientSecret: string }> = {};
  const wecomCreds: Record<string, { botId: string; secret: string }> = {};
  const qqCreds: Record<string, { appId: string; clientSecret: string }> = {};
  const slackCreds: Record<string, { botToken: string; appToken?: string }> = {};
  const telegramCreds: Record<string, { token: string }> = {};
  const discordCreds: Record<string, { token: string }> = {};
  const parseVault = async <T>(ref: string, cache: Record<string, T>, wrap: (raw: string) => T): Promise<void> => {
    const raw = await vault.read(ref);
    if (!raw) return;
    try {
      cache[ref] = JSON.parse(raw) as T;
    } catch {
      cache[ref] = wrap(raw);
    }
  };
  host.attachChannelAdapter(
    dingtalkChannelAdapter(
      new DingTalkAdapter({
        resolve: (ref) => dingtalkCreds[ref],
        put: (ref, creds) => {
          dingtalkCreds[ref] = creds;
          void vault.write(ref, JSON.stringify(creds));
        },
      }),
    ),
  );
  host.attachChannelAdapter(
    wecomChannelAdapter(
      new WeComAdapter({
        resolve: (ref) => wecomCreds[ref],
        put: (ref, creds) => {
          wecomCreds[ref] = creds;
          void vault.write(ref, JSON.stringify(creds));
        },
      }),
    ),
  );
  host.attachChannelAdapter(
    qqChannelAdapter(
      new QqAdapter({
        resolve: (ref) => qqCreds[ref],
        put: (ref, creds) => {
          qqCreds[ref] = creds;
          void vault.write(ref, JSON.stringify(creds));
        },
      }),
    ),
  );
  host.attachChannelAdapter(
    slackChannelAdapter(
      new SlackAdapter({
        resolve: (ref) => slackCreds[ref],
      }),
    ),
  );
  host.attachChannelAdapter(
    telegramChannelAdapter(
      new TelegramAdapter({
        resolve: (ref) => telegramCreds[ref],
      }),
    ),
  );
  host.attachChannelAdapter(
    discordChannelAdapter(
      new DiscordAdapter({
        resolve: (ref) => discordCreds[ref],
      }),
    ),
  );
  host.attachChannelAdapter(
    whatsappChannelAdapter(
      new WhatsAppDeviceAdapter(
        new EncryptedWhatsAppSessionStore(
          join(userData, "im", "whatsapp.session"),
          createHash("sha256").update(`penglai-wa:${userData}`).digest(),
        ),
        async () => {
          throw new PenglaiError("DSH_UNAVAILABLE", "WHATSAPP_BAILEYS_MISSING");
        },
      ),
    ),
  );
  void Promise.all([
    parseVault(CHANNEL_CREDENTIAL_REFS.dingtalk, dingtalkCreds, (raw) => ({ clientId: raw, clientSecret: "" })),
    parseVault(CHANNEL_CREDENTIAL_REFS.wecom, wecomCreds, (raw) => ({ botId: raw, secret: "" })),
    parseVault(CHANNEL_CREDENTIAL_REFS.qq, qqCreds, (raw) => ({ appId: raw, clientSecret: "" })),
    parseVault(CHANNEL_CREDENTIAL_REFS.slack, slackCreds, (raw) => ({ botToken: raw })),
    parseVault(CHANNEL_CREDENTIAL_REFS.telegram, telegramCreds, (raw) => ({ token: raw })),
    parseVault(CHANNEL_CREDENTIAL_REFS.discord, discordCreds, (raw) => ({ token: raw })),
  ]).then(() => {
    if (host.store.isClosed()) return;
    return host.restoreChannelAdapters();
  });
  const artifacts = new ArtifactService(join(userData, "artifacts"));
  host.attachArtifacts(artifacts);
  const admitInbound = (input: {
    bytes: Buffer;
    filename?: string;
    mime?: string;
    routeId: string;
    workspaceId: string;
    sessionId: string;
    turnId: string;
    objectHandle?: string;
  }) => {
    const name = input.filename && /\.(docx|xlsx|pptx|pdf|txt|md|csv)$/i.test(input.filename)
      ? input.filename
      : undefined;
    if (!name) return;
    try {
      return artifacts.ingestBytes(input.bytes, {
        name,
        source: "im",
        scope: "turn",
        workspaceId: input.workspaceId,
        sessionId: input.sessionId,
        turnId: input.turnId,
      });
    } catch {
      /* images/audio stay on MediaStore and official attachments */
      return undefined;
    }
  };
  weixin.onAdmittedBytes = admitInbound;
  feishu.onAdmittedBytes = admitInbound;
  host.attachOwner(
    new OwnerApprovalBroker(userData, {
      dialog: createHostOwnerDialog(userData),
    }),
  );
  void rt.plane.recoverQueuedInbounds();
  void supervisor.start();
  void host
    .getOverview()
    .then((overview) => {
      try {
        writeFileSync(join(userData, "im", "remote-snapshot.json"), JSON.stringify(overview, null, 2), { mode: 0o600 });
      } catch {
        /* tests may close the store before this snapshot */
      }
    })
    .catch(() => undefined);
  const effect = (ctx as CordisLike & { effect?: (fn: () => () => void) => void }).effect;
  effect?.(() => () => {
    host.releaseAll();
    artifacts.close();
  });
  if (ctx instanceof Context) {
    new PenglaiImRemote(ctx, host);
  }
  const provide = (ctx as { provide?: (name: string, value: unknown) => void }).provide;
  if (typeof provide !== "function") {
    throw new PenglaiError("DSH_UNAVAILABLE", "Cordis provide service required for IM core");
  }
  provide.call(ctx, "penglaiImCore", host);
  return { ...rt, host, supervisor };
}

Object.assign(apply, { inject });
export default { name, inject, apply };
export { PINNED_DSH, PenglaiImHost, PenglaiImRemote, AdapterSupervisor, CredentialsServiceVault, WorkerLease };
export { CHANNEL_IDS, CHANNEL_MANIFESTS, getChannelManifest, listChannelManifests, refuseFakeQr } from "./registry.js";
export {
  assertLiveSend,
  connectionResultForMethod,
  guidedAdapter,
  requireAdapter,
} from "./channel-adapter.js";
export type {
  ChannelAdapter,
  ChannelHealth,
  ConnectionResult,
  ConnectionState,
  InboundChannelEvent,
} from "./channel-adapter.js";
export { ImBotStore, ensureImV2Tables } from "./bots.js";
export { beginGuidedConnection } from "./guided.js";
export { TYPERT_REMOTE } from "./remote.js";
export { IM_OWNER_ACTIONS, requireImActionId } from "./owner.js";
