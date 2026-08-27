import { Remote, TypertRemoteService } from "@deepseek-ai/dsh-typert-protocol";
import type { Context } from "@deepseek-ai/cordis";
import type { PenglaiImHost } from "./host.js";

export class PenglaiImRemote extends TypertRemoteService {
  constructor(
    ctx: Context,
    private readonly host: PenglaiImHost,
  ) {
    super(ctx, "penglaiIm");
  }

  @Remote
  getOverview() {
    return this.host.getOverview();
  }

  @Remote
  getOnboardingReadiness() {
    return this.host.getOnboardingReadiness();
  }

  @Remote
  listWorkspacesAndSessions() {
    return this.host.listWorkspacesAndSessions();
  }

  @Remote
  proposeBinding(input: Parameters<PenglaiImHost["proposeBinding"]>[0]) {
    return this.host.proposeBinding(input);
  }

  @Remote
  createBinding(input: Parameters<PenglaiImHost["createBinding"]>[0]) {
    return this.host.createBinding(input);
  }

  @Remote
  enableGroup(input: Parameters<PenglaiImHost["enableGroup"]>[0]) {
    return this.host.enableGroup(input);
  }

  @Remote
  deleteBinding(input: Parameters<PenglaiImHost["deleteBinding"]>[0]) {
    return this.host.deleteBinding(input);
  }

  @Remote
  listBindings() {
    return this.host.listBindings();
  }

  @Remote
  getVoiceOptions() {
    return this.host.getVoiceOptions();
  }

  @Remote
  probeWeixinText(input: Parameters<PenglaiImHost["probeWeixinText"]>[0]) {
    return this.host.probeWeixinText(input);
  }

  @Remote
  updateBindingVoicePolicy(input: Parameters<PenglaiImHost["updateBindingVoicePolicy"]>[0]) {
    return this.host.updateBindingVoicePolicy(input);
  }

  @Remote
  probeWeixinNativeVoice(input: Parameters<PenglaiImHost["probeWeixinNativeVoice"]>[0]) {
    return this.host.probeWeixinNativeVoice(input);
  }

  @Remote
  confirmWeixinNativeVoice(input: Parameters<PenglaiImHost["confirmWeixinNativeVoice"]>[0]) {
    return this.host.confirmWeixinNativeVoice(input);
  }

  @Remote
  disableWeixinNativeVoice(input: Parameters<PenglaiImHost["disableWeixinNativeVoice"]>[0]) {
    return this.host.disableWeixinNativeVoice(input);
  }

  @Remote
  listBindableRoutes() {
    return this.host.listBindableRoutes();
  }

  @Remote
  beginWeixinQr() {
    return this.host.beginWeixinQr();
  }

  @Remote
  pollWeixinQr(input: { challengeId: string }) {
    return this.host.pollWeixinQr(input);
  }

  @Remote
  submitWeixinVerification(input: { challengeId: string; code: string }) {
    return this.host.submitWeixinVerification(input);
  }

  @Remote
  cancelWeixinQr() {
    return this.host.cancelWeixinQr();
  }

  @Remote
  beginFeishuQr() {
    return this.host.beginFeishuQr();
  }

  @Remote
  pollFeishuQr(input: { challengeId: string }) {
    return this.host.pollFeishuQr(input);
  }

  @Remote
  cancelFeishuQr() {
    return this.host.cancelFeishuQr();
  }

  @Remote
  reconnectWeixin() {
    return this.host.reconnectWeixin();
  }

  @Remote
  logoutWeixin() {
    return this.host.logoutWeixin();
  }

  @Remote
  configureFeishu(input: { appId: string; secret?: string; ownerOpenId?: string }) {
    return this.host.configureFeishu(input);
  }

  @Remote
  setFeishuOwner(input: { openId: string }) {
    return this.host.setFeishuOwner(input);
  }

  @Remote
  verifyAndConnectFeishu() {
    return this.host.verifyAndConnectFeishu();
  }

  @Remote
  disconnectFeishu() {
    return this.host.disconnectFeishu();
  }

  @Remote
  logoutFeishu() {
    return this.host.logoutFeishu();
  }

  @Remote
  getDiagnostics() {
    return this.host.getDiagnostics();
  }

  @Remote
  listChannelManifests() {
    return this.host.listChannelManifests();
  }

  @Remote
  beginGuidedConnection(input: Parameters<PenglaiImHost["beginGuidedConnection"]>[0]) {
    return this.host.beginGuidedConnection(input);
  }

  @Remote
  createBot(input: Parameters<PenglaiImHost["createBot"]>[0]) {
    return this.host.createBot(input);
  }

  @Remote
  listBots(input: Parameters<PenglaiImHost["listBots"]>[0]) {
    return this.host.listBots(input);
  }

  @Remote
  acknowledgeChannelRisk(input: Parameters<PenglaiImHost["acknowledgeChannelRisk"]>[0]) {
    return this.host.acknowledgeChannelRisk(input);
  }

  @Remote
  removeBot(input: Parameters<PenglaiImHost["removeBot"]>[0]) {
    return this.host.removeBot(input);
  }

  @Remote
  storeChannelSecret(input: Parameters<PenglaiImHost["storeChannelSecret"]>[0]) {
    return this.host.storeChannelSecret(input);
  }

  @Remote
  beginChannelConnection(input: Parameters<PenglaiImHost["beginChannelConnection"]>[0]) {
    return this.host.beginChannelConnection(input);
  }

  @Remote
  pollChannelConnection(input: Parameters<PenglaiImHost["pollChannelConnection"]>[0]) {
    return this.host.pollChannelConnection(input);
  }

  @Remote
  cancelChannelConnection(input: Parameters<PenglaiImHost["cancelChannelConnection"]>[0]) {
    return this.host.cancelChannelConnection(input);
  }

  @Remote
  peekChannelQr(input: Parameters<PenglaiImHost["peekChannelQr"]>[0]) {
    return this.host.peekChannelQr(input);
  }

  @Remote
  disconnectChannel(input: Parameters<PenglaiImHost["disconnectChannel"]>[0]) {
    return this.host.disconnectChannel(input);
  }

  @Remote
  logoutChannel(input: Parameters<PenglaiImHost["logoutChannel"]>[0]) {
    return this.host.logoutChannel(input);
  }
}

export const TYPERT_REMOTE = {
  package: "@penglai/im",
  descriptors: [
    "getOverview",
    "getOnboardingReadiness",
    "listWorkspacesAndSessions",
    "proposeBinding",
    "createBinding",
    "deleteBinding",
    "enableGroup",
    "listBindings",
    "getVoiceOptions",
    "probeWeixinText",
    "updateBindingVoicePolicy",
    "probeWeixinNativeVoice",
    "confirmWeixinNativeVoice",
    "disableWeixinNativeVoice",
    "listBindableRoutes",
    "beginWeixinQr",
    "pollWeixinQr",
    "submitWeixinVerification",
    "cancelWeixinQr",
    "beginFeishuQr",
    "pollFeishuQr",
    "cancelFeishuQr",
    "reconnectWeixin",
    "logoutWeixin",
    "configureFeishu",
    "setFeishuOwner",
    "verifyAndConnectFeishu",
    "disconnectFeishu",
    "logoutFeishu",
    "getDiagnostics",
    "listChannelManifests",
    "beginGuidedConnection",
    "createBot",
    "listBots",
    "acknowledgeChannelRisk",
    "removeBot",
    "storeChannelSecret",
    "beginChannelConnection",
    "pollChannelConnection",
    "cancelChannelConnection",
    "peekChannelQr",
    "disconnectChannel",
    "logoutChannel",
  ].map((method) => ({
    id: `@penglai/im#penglaiIm/${method}`,
    service: "penglaiIm",
    namespace: "penglaiIm",
    method,
    invocation: { kind: "direct" as const },
  })),
};
