import { TypertRemoteService } from "@deepseek-ai/dsh-typert-protocol";
import type { Context } from "@deepseek-ai/cordis";
import { PenglaiRemote } from "@penglai/contracts";
import type { PenglaiImHost } from "./host.js";

export class PenglaiImRemote extends TypertRemoteService {
  constructor(
    ctx: Context,
    private readonly host: PenglaiImHost,
  ) {
    super(ctx, "penglaiIm");
  }

  @PenglaiRemote
  getOverview() {
    return this.host.getOverview();
  }

  @PenglaiRemote
  getOnboardingReadiness() {
    return this.host.getOnboardingReadiness();
  }

  @PenglaiRemote
  listWorkspacesAndSessions() {
    return this.host.listWorkspacesAndSessions();
  }

  @PenglaiRemote
  proposeBinding(input: Parameters<PenglaiImHost["proposeBinding"]>[0]) {
    return this.host.proposeBinding(input);
  }

  @PenglaiRemote
  createBinding(input: Parameters<PenglaiImHost["createBinding"]>[0]) {
    return this.host.createBinding(input);
  }

  @PenglaiRemote
  enableGroup(input: Parameters<PenglaiImHost["enableGroup"]>[0]) {
    return this.host.enableGroup(input);
  }

  @PenglaiRemote
  deleteBinding(input: Parameters<PenglaiImHost["deleteBinding"]>[0]) {
    return this.host.deleteBinding(input);
  }

  @PenglaiRemote
  listBindings() {
    return this.host.listBindings();
  }

  @PenglaiRemote
  getVoiceOptions() {
    return this.host.getVoiceOptions();
  }

  @PenglaiRemote
  probeWeixinText(input: Parameters<PenglaiImHost["probeWeixinText"]>[0]) {
    return this.host.probeWeixinText(input);
  }

  @PenglaiRemote
  updateBindingVoicePolicy(input: Parameters<PenglaiImHost["updateBindingVoicePolicy"]>[0]) {
    return this.host.updateBindingVoicePolicy(input);
  }

  @PenglaiRemote
  probeWeixinNativeVoice(input: Parameters<PenglaiImHost["probeWeixinNativeVoice"]>[0]) {
    return this.host.probeWeixinNativeVoice(input);
  }

  @PenglaiRemote
  confirmWeixinNativeVoice(input: Parameters<PenglaiImHost["confirmWeixinNativeVoice"]>[0]) {
    return this.host.confirmWeixinNativeVoice(input);
  }

  @PenglaiRemote
  disableWeixinNativeVoice(input: Parameters<PenglaiImHost["disableWeixinNativeVoice"]>[0]) {
    return this.host.disableWeixinNativeVoice(input);
  }

  @PenglaiRemote
  listBindableRoutes() {
    return this.host.listBindableRoutes();
  }

  @PenglaiRemote
  beginWeixinQr() {
    return this.host.beginWeixinQr();
  }

  @PenglaiRemote
  pollWeixinQr(input: { challengeId: string }) {
    return this.host.pollWeixinQr(input);
  }

  @PenglaiRemote
  submitWeixinVerification(input: { challengeId: string; code: string }) {
    return this.host.submitWeixinVerification(input);
  }

  @PenglaiRemote
  cancelWeixinQr() {
    return this.host.cancelWeixinQr();
  }

  @PenglaiRemote
  beginFeishuQr() {
    return this.host.beginFeishuQr();
  }

  @PenglaiRemote
  pollFeishuQr(input: { challengeId: string }) {
    return this.host.pollFeishuQr(input);
  }

  @PenglaiRemote
  cancelFeishuQr() {
    return this.host.cancelFeishuQr();
  }

  @PenglaiRemote
  reconnectWeixin() {
    return this.host.reconnectWeixin();
  }

  @PenglaiRemote
  logoutWeixin() {
    return this.host.logoutWeixin();
  }

  @PenglaiRemote
  configureFeishu(input: { appId: string; secret?: string; ownerOpenId?: string }) {
    return this.host.configureFeishu(input);
  }

  @PenglaiRemote
  setFeishuOwner(input: { openId: string }) {
    return this.host.setFeishuOwner(input);
  }

  @PenglaiRemote
  verifyAndConnectFeishu() {
    return this.host.verifyAndConnectFeishu();
  }

  @PenglaiRemote
  disconnectFeishu() {
    return this.host.disconnectFeishu();
  }

  @PenglaiRemote
  logoutFeishu() {
    return this.host.logoutFeishu();
  }

  @PenglaiRemote
  getDiagnostics() {
    return this.host.getDiagnostics();
  }

  @PenglaiRemote
  listChannelManifests() {
    return this.host.listChannelManifests();
  }

  @PenglaiRemote
  beginGuidedConnection(input: Parameters<PenglaiImHost["beginGuidedConnection"]>[0]) {
    return this.host.beginGuidedConnection(input);
  }

  @PenglaiRemote
  createBot(input: Parameters<PenglaiImHost["createBot"]>[0]) {
    return this.host.createBot(input);
  }

  @PenglaiRemote
  listBots(input: Parameters<PenglaiImHost["listBots"]>[0]) {
    return this.host.listBots(input);
  }

  @PenglaiRemote
  removeBot(input: Parameters<PenglaiImHost["removeBot"]>[0]) {
    return this.host.removeBot(input);
  }

  @PenglaiRemote
  storeChannelSecret(input: Parameters<PenglaiImHost["storeChannelSecret"]>[0]) {
    return this.host.storeChannelSecret(input);
  }

  @PenglaiRemote
  beginChannelConnection(input: Parameters<PenglaiImHost["beginChannelConnection"]>[0]) {
    return this.host.beginChannelConnection(input);
  }

  @PenglaiRemote
  pollChannelConnection(input: Parameters<PenglaiImHost["pollChannelConnection"]>[0]) {
    return this.host.pollChannelConnection(input);
  }

  @PenglaiRemote
  cancelChannelConnection(input: Parameters<PenglaiImHost["cancelChannelConnection"]>[0]) {
    return this.host.cancelChannelConnection(input);
  }

  @PenglaiRemote
  peekChannelQr(input: Parameters<PenglaiImHost["peekChannelQr"]>[0]) {
    return this.host.peekChannelQr(input);
  }

  @PenglaiRemote
  disconnectChannel(input: Parameters<PenglaiImHost["disconnectChannel"]>[0]) {
    return this.host.disconnectChannel(input);
  }

  @PenglaiRemote
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
