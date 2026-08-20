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
  createBinding(input: Parameters<PenglaiImHost["createBinding"]>[0]) {
    return this.host.createBinding(input);
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
}

export const TYPERT_REMOTE = {
  package: "@penglai/im",
  descriptors: [
    "getOverview",
    "getOnboardingReadiness",
    "listWorkspacesAndSessions",
    "createBinding",
    "deleteBinding",
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
  ].map((method) => ({
    id: `@penglai/im#penglaiIm/${method}`,
    service: "penglaiIm",
    namespace: "penglaiIm",
    method,
    invocation: { kind: "direct" as const },
  })),
};
