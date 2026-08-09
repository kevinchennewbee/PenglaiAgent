/**
 * 桌面首次启动向导（React）。
 *
 * 顶层架构：
 *   - 流程：欢迎 → 厂家 → 计费/套餐（不可跳）→ 模型 → Key/冒烟 → 身份 → 工作台
 *   - 壳底栏统一「上一步 | 下一步」并排（长列表滚动时导航仍固定可见）
 *   - 步骤只渲染内容 + 声明 canProceed；不各自塞主按钮
 *   - 状态机：wizard/machine.ts；目录：wizard/catalog.ts
 *   - key 只写 Host profiles，桌面本地不存
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { ModelProfile } from "@penglai/protocol";
import type { PenglaiBridge } from "../bridge/types.js";
import { toBridgeError } from "../bridge/types.js";
import { Icon } from "../ui/Icon.js";
import {
  CATALOG,
  billingShortTag,
  catalogUpdated,
  describeModelContext,
  describeModelPrice,
  getBilling,
  getProvider,
  introLines,
  modelById,
  orderedProviders,
  type CatalogOverlayEntry,
  type ListModelsResult,
  type ProviderCatalogDoc,
  type SmokeResult,
} from "./catalog.js";
import {
  SMOKE_SKIP_WARNING,
  billingGuidance,
  billingRows,
  confirmSaved,
  defaultModelIndex,
  deprecatedNotice,
  envHintFor,
  goBack,
  initialWizardNav,
  labelFor,
  parseKeyAnswer,
  pickBilling,
  pickCustomBase,
  pickCustomKey,
  pickCustomModel,
  pickModel,
  pickProvider,
  profileIdFor,
  providerRows,
  resolveModelList,
  stepProgress,
  type KeyAnswer,
  type ResolvedModelList,
  type WizardChrome,
  type WizardNav,
  selectionChrome,
} from "./machine.js";

export interface WizardDone {
  profileId: string | null;
  verified: boolean;
  skipped: boolean;
}

interface OnboardingStatus {
  identity: { name: string; bornAt: string } | null;
}

interface BirthResultView {
  ran: boolean;
  name?: string;
  bornAt?: string;
  identityWritten?: boolean;
  seeds?: Array<{ name: string; outcome: "planted" | "kept" | "rejected"; reason?: string }>;
  existingName?: string;
}

type SmokePhase =
  | { phase: "idle" }
  | { phase: "verifying" }
  | { phase: "ok"; detail: string; liveLine: string | null; profileId: string }
  | { phase: "failed"; detail: string };

type IdentityPhase =
  | { phase: "loading" }
  | { phase: "exists"; name: string; bornAt: string }
  | { phase: "naming" }
  | { phase: "celebrating" }
  | { phase: "born"; result: BirthResultView }
  | { phase: "skipped" };

export function SetupWizard({
  bridge,
  manual,
  onDone,
  onCancel,
  catalog = CATALOG,
}: {
  bridge: PenglaiBridge;
  /** 设置页「重新配置模型」= true（可取消）；首次启动 = false。 */
  manual: boolean;
  onDone: (result: WizardDone) => void;
  onCancel?: () => void;
  catalog?: ProviderCatalogDoc;
}) {
  const [nav, setNav] = useState<WizardNav>(() => initialWizardNav());
  const [error, setError] = useState<string | null>(null);

  // ── 步骤局部状态（换步即重置） ──
  const [providerId, setProviderId] = useState<string>("");
  const [billingId, setBillingId] = useState<string>("");
  const [billingManualBase, setBillingManualBase] = useState("");
  const [modelId, setModelId] = useState("");
  const [modelManual, setModelManual] = useState("");
  const [modelList, setModelList] = useState<ResolvedModelList | null>(null);
  const [modelLoading, setModelLoading] = useState(false);
  const [deprecated, setDeprecated] = useState<{ replace: string; text: string } | null>(null);
  const [keyInput, setKeyInput] = useState("");
  const [smoke, setSmoke] = useState<SmokePhase>({ phase: "idle" });
  const [identity, setIdentity] = useState<IdentityPhase>({ phase: "loading" });
  const [nameInput, setNameInput] = useState("");
  const [customBaseInput, setCustomBaseInput] = useState("");
  const [customIdInput, setCustomIdInput] = useState("custom");
  const [liveProbe, setLiveProbe] = useState<ListModelsResult | null>(null);
  const [savedProfile, setSavedProfile] = useState<{ id: string; verified: boolean; skipped: boolean } | null>(null);

  /** 过期异步结果守卫（换步/卸载后不得再落状态）。 */
  const genRef = useRef(0);
  const nextGen = () => ++genRef.current;

  const sel = nav.selections;
  const progress = stepProgress(nav.step, smoke.phase !== "idle");
  const canBack = !["welcome", "identity"].includes(nav.step) && smoke.phase !== "verifying";

  // 进入 provider 步预选第一家（CLI 默认序号 1）。
  useEffect(() => {
    if (nav.step === "provider" && !providerId) {
      setProviderId(orderedProviders(catalog)[0]?.id ?? "");
    }
  }, [nav.step, providerId, catalog]);

  // 进入 billing 步预选默认模式。
  useEffect(() => {
    if (nav.step === "billing") setBillingId(sel.billingId || getProvider(sel.providerId, catalog)?.default_billing || "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nav.step]);

  // ── 模型列表探测（model：无 key；customModel：带 key） ──
  useEffect(() => {
    if (nav.step !== "model" && nav.step !== "customModel") return;
    const gen = nextGen();
    setModelLoading(true);
    setModelList(null);
    setLiveProbe(null);
    setDeprecated(null);
    const keyPart =
      nav.step === "customModel" && sel.key
        ? { ...(sel.key.apiKey ? { apiKey: sel.key.apiKey } : {}), ...(sel.key.apiKeyEnv ? { apiKeyEnv: sel.key.apiKeyEnv } : {}) }
        : {};
    void (async () => {
      const [probe, status] = await Promise.all([
        bridge
          .rpc<ListModelsResult>("config.listModels", { baseUrl: sel.baseUrl, ...keyPart })
          .catch((e): ListModelsResult => {
            const err = toBridgeError(e);
            return { ok: false, kind: "network", ids: [], detail: `模型列表调用失败：${err.message}` };
          }),
        bridge
          .rpc<{ catalogUpdated: string; overlay: CatalogOverlayEntry[] | null }>("catalog.status")
          .catch(() => null),
      ]);
      if (genRef.current !== gen) return;
      setLiveProbe(probe);
      if (nav.step === "model") {
        setModelList(
          resolveModelList({
            catalog,
            providerId: sel.providerId,
            billingId: sel.billingId,
            probe,
            overlay: status?.overlay ?? null,
          }),
        );
      }
      setModelLoading(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nav.step, sel.baseUrl, sel.billingId]);

  // 合并列表就绪后预选默认模型。
  useEffect(() => {
    if (nav.step === "model" && modelList && !modelId) {
      const idx = defaultModelIndex(modelList.merged, catalog, sel.providerId, sel.billingId);
      setModelId(modelList.merged[idx]?.id ?? "");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modelList, nav.step]);

  // ── 身份页：查询既有身份 ──
  useEffect(() => {
    if (nav.step !== "identity") return;
    const gen = nextGen();
    setIdentity({ phase: "loading" });
    void bridge
      .rpc<OnboardingStatus>("onboarding.status")
      .then((status) => {
        if (genRef.current !== gen) return;
        if (status.identity) setIdentity({ phase: "exists", ...status.identity });
        else setIdentity({ phase: "naming" });
      })
      .catch(() => {
        if (genRef.current !== gen) return;
        setIdentity({ phase: "naming" });
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nav.step]);

  // ── 换步 ──

  const goto = useCallback((next: WizardNav) => {
    nextGen();
    setNav(next);
    setError(null);
    setSmoke({ phase: "idle" });
    setKeyInput("");
    setModelId("");
    setModelManual("");
    setModelList(null);
    setDeprecated(null);
    if (next.step === "billing") setBillingManualBase("");
  }, []);

  const onBack = useCallback(() => {
    goto(goBack(nav, catalog));
  }, [goto, nav, catalog]);

  // ── 冒烟 + 保存（key 步 / customModel 步共用；selections 显式传入避免闭包过期） ──

  const smokeAndSave = useCallback(
    async (selections: WizardNav["selections"], key: KeyAnswer) => {
      const gen = nextGen();
      setSmoke({ phase: "verifying" });
      setError(null);
      const smokeInput = {
        baseUrl: selections.baseUrl,
        model: selections.modelId,
        ...(key.apiKey ? { apiKey: key.apiKey } : {}),
        ...(key.apiKeyEnv ? { apiKeyEnv: key.apiKeyEnv } : {}),
      };
      let result: SmokeResult;
      try {
        result = await bridge.rpc<SmokeResult>("config.smokeTest", smokeInput);
      } catch (e) {
        if (genRef.current !== gen) return;
        setSmoke({ phase: "failed", detail: `验证调用失败：${toBridgeError(e).message}` });
        return;
      }
      if (genRef.current !== gen) return;
      if (!result.ok) {
        setSmoke({ phase: "failed", detail: result.detail });
        return;
      }
      // 带 key 复核实时列表（确认所选模型在列；失败只降级一行提示）。
      let liveLine: string | null = null;
      try {
        const live = await bridge.rpc<ListModelsResult>("config.listModels", smokeInput);
        if (live.ok) {
          liveLine = live.ids.includes(selections.modelId)
            ? `模型「${selections.modelId}」已在供应商实时列表确认（共 ${live.ids.length} 个模型）`
            : `实时列表中未见「${selections.modelId}」（目录/路由模型；冒烟已通过，可正常使用）`;
        }
      } catch {
        liveLine = null;
      }
      if (genRef.current !== gen) return;
      try {
        const profile = await bridge.rpc<ModelProfile>("config.createProfile", {
          id: profileIdFor(selections, catalog),
          label: labelFor(selections, catalog),
          provider: selections.providerId,
          ...smokeInput,
        });
        if (genRef.current !== gen) return;
        setSavedProfile({ id: profile.id, verified: true, skipped: false });
        setSmoke({ phase: "ok", detail: result.detail, liveLine, profileId: profile.id });
      } catch (e) {
        if (genRef.current !== gen) return;
        setSmoke({ phase: "failed", detail: `保存档案失败：${toBridgeError(e).message}` });
      }
    },
    [bridge, catalog],
  );

  /** 跳过验证先保存（带警告）。 */
  const skipAndSave = useCallback(
    async (selections: WizardNav["selections"], key: KeyAnswer) => {
      const gen = nextGen();
      setSmoke({ phase: "verifying" });
      try {
        const profile = await bridge.rpc<ModelProfile>("config.createProfile", {
          id: profileIdFor(selections, catalog),
          label: labelFor(selections, catalog),
          provider: selections.providerId,
          baseUrl: selections.baseUrl,
          model: selections.modelId,
          ...(key.apiKey ? { apiKey: key.apiKey } : {}),
          ...(key.apiKeyEnv ? { apiKeyEnv: key.apiKeyEnv } : {}),
        });
        if (genRef.current !== gen) return;
        setSavedProfile({ id: profile.id, verified: false, skipped: true });
        goto(confirmSaved(nav));
      } catch (e) {
        if (genRef.current !== gen) return;
        setSmoke({ phase: "failed", detail: `保存档案失败：${toBridgeError(e).message}` });
      }
    },
    [bridge, catalog, goto, nav],
  );

  // ── 身份诞生 ──

  const celebrate = useCallback(async () => {
    const gen = nextGen();
    setIdentity({ phase: "celebrating" });
    try {
      const result = await bridge.rpc<BirthResultView>("onboarding.birthIdentity", { name: nameInput });
      if (genRef.current !== gen) return;
      if (!result.ran && result.existingName) {
        setIdentity({ phase: "exists", name: result.existingName, bornAt: "" });
      } else {
        setIdentity({ phase: "born", result });
      }
    } catch (e) {
      if (genRef.current !== gen) return;
      setIdentity({ phase: "naming" });
      setError(`仪式未能完成：${toBridgeError(e).message}`);
    }
  }, [bridge, nameInput]);

  const finish = useCallback(() => {
    onDone({
      profileId: savedProfile?.id ?? null,
      verified: savedProfile?.verified ?? false,
      skipped: savedProfile?.skipped ?? false,
    });
  }, [onDone, savedProfile]);

  // ── 各步渲染 ─────────────────────────────────────────────────

  const provider = sel.providerId ? getProvider(sel.providerId, catalog) : undefined;
  const billingMode = sel.billingId ? getBilling(sel.providerId, sel.billingId, catalog) : undefined;

  function renderWelcome() {
    return (
      <div className="wizard-welcome">
        <div className="brand-seal large">蓬</div>
        <p className="eyebrow">{manual ? "重新配置模型" : "首次启动向导"}</p>
        <h1>{manual ? "换一颗大脑，或再验一次活" : "蓬莱第一次醒来"}</h1>
        <p className="wizard-lead">
          先花一分钟接上大脑：选厂家 → 选按量/套餐 → 选模型 → 填 Key → 验活。
          最后它会有一个名字——身份诞生，只做一次。
        </p>
        <p className="wizard-dim">
          目录数据 {catalogUpdated(catalog)} 实测修正版 · {orderedProviders(catalog).length - 1} 家供应商 +
          自定义端点 · 每一步都可返回上一步
        </p>
        <div className="wizard-actions center">
          <button className="primary-button" onClick={() => goto({ ...nav, step: "provider" })}>
            开始<Icon name="chevron" size={15} />
          </button>
          {!manual && onCancel && (
            <button className="link-button" onClick={onCancel}>
              稍后再配（下次启动还会提醒）
            </button>
          )}
        </div>
      </div>
    );
  }

  function renderProvider() {
    const rows = providerRows(catalog);
    const chosen = rows.find((r) => r.id === providerId);
    return (
      <>
        <p className="wizard-lead">第 1 步 · 选厂家。价格单位：元/百万 tokens。选中后看注册入口；下一步再选按量或套餐。</p>
        <div className="wizard-option-list">
          {rows.map((row, index) => (
            <button
              key={row.id}
              className={`wizard-option ${providerId === row.id ? "selected" : ""}`}
              onClick={() => setProviderId(row.id)}
            >
              <span className="wizard-option-num">{String(index + 1).padStart(2, "0")}</span>
              <span className="wizard-option-main">
                <strong>{row.display}</strong>
                <small>{row.billingTags}</small>
              </span>
              {row.defaultModel && <code className="wizard-option-side">{row.defaultModel}</code>}
            </button>
          ))}
        </div>
        {chosen && !chosen.isCustom && chosen.signupUrl && (
          <p className="wizard-dim">注册/充值入口：<code>{chosen.signupUrl}</code></p>
        )}
        <p className="wizard-dim">下一步将选择接入方式（按量 / Coding Plan / Agent Plan 等）。</p>
      </>
    );
  }

  function renderBilling() {
    const rows = billingRows(catalog, sel.providerId);
    const chosenMode = rows.find((r) => r.id === billingId)?.mode;
    const needsManualBase = chosenMode ? !chosenMode.base_url : false;
    return (
      <>
        <p className="wizard-lead">
          第 2 步 · 怎么接入 {provider?.display}？按量 / Coding Plan / Agent Plan / 订阅的端点与 Key 通常不通用。
          常驻管家优先「按量 OpenAI 兼容」；套餐请先读警示。
        </p>
        <div className="wizard-option-list">
          {rows.map(({ id, mode }) => (
            <button
              key={id}
              className={`wizard-option ${billingId === id ? "selected" : ""}`}
              onClick={() => setBillingId(id)}
            >
              <span className="wizard-option-main">
                <strong>{mode.label}</strong>
                <small>
                  {mode.plans?.length ? mode.plans.map((p) => p.display).join(" · ") : mode.note ?? ""}
                </small>
              </span>
              <code className="wizard-option-side">{billingShortTag(id, mode)}</code>
            </button>
          ))}
        </div>
        {billingId && (() => {
          const guide = billingGuidance(billingId, chosenMode);
          const cls =
            guide.kind === "recommended"
              ? "wizard-guide ok"
              : guide.kind === "blocked"
                ? "wizard-guide bad"
                : "wizard-guide caution";
          return (
            <div className={cls}>
              <strong>{guide.title}</strong>
              <p>{guide.body}</p>
            </div>
          );
        })()}
        {chosenMode?.base_url && (
          <p className="wizard-dim">OpenAI 兼容端点 <code>{chosenMode.base_url}</code></p>
        )}
        {chosenMode?.base_url_anthropic && !chosenMode?.base_url && (
          <p className="wizard-dim">
            仅 Anthropic 协议端点 <code>{chosenMode.base_url_anthropic}</code>
            （主路径需 OpenAI 兼容，或手填兼容网关）
          </p>
        )}
        {needsManualBase && (
          <label className="wizard-field">
            <span>该模式无 OpenAI 兼容端点，请手填 API Base URL</span>
            <input
              value={billingManualBase}
              onChange={(e) => setBillingManualBase(e.target.value)}
              placeholder="https://api.example.com/v1"
              spellCheck={false}
            />
          </label>
        )}
      </>
    );
  }

  function renderModel() {
    const chosenId = modelManual.trim() || modelId;
    return (
      <>
        <p className="wizard-lead">{provider?.display} · {billingMode?.label} — 选一个模型。</p>
        <p className="wizard-status-line">{modelList?.statusLine ?? "　"}</p>
        {modelLoading && <p className="wizard-dim"><i className="mini-spinner" /> 正在拉取实时模型列表…</p>}
        {!modelLoading && modelList && (
          <>
            <p className="wizard-dim">{modelList.probeLine}</p>
            <div className="wizard-option-list tall">
              {modelList.merged.map((model, index) => (
                <button
                  key={model.id}
                  className={`wizard-option ${chosenId === model.id && !modelManual.trim() ? "selected" : ""}`}
                  onClick={() => { setModelId(model.id); setModelManual(""); setDeprecated(null); }}
                >
                  <span className="wizard-option-num">{String(index + 1).padStart(2, "0")}</span>
                  <span className="wizard-option-main">
                    <strong>
                      {model.display}
                      {model.isDefault && <em className="default-mark">★默认</em>}
                    </strong>
                    <small>
                      {[
                        model.catalog ? describeModelPrice(model.catalog) : "",
                        model.catalog ? describeModelContext(model.catalog) : "",
                        model.catalog?.features?.join("/") ?? "",
                      ].filter(Boolean).join(" · ")}
                      {model.source === "live" && "（实时新增）"}
                      {model.source === "catalog" && liveProbe?.ok && "（目录）"}
                    </small>
                  </span>
                </button>
              ))}
            </div>
          </>
        )}
        <label className="wizard-field">
          <span>也可手输模型 id（实时列表/目录之外）</span>
          <input
            value={modelManual}
            onChange={(e) => { setModelManual(e.target.value); setDeprecated(null); }}
            placeholder="模型 id"
            spellCheck={false}
          />
        </label>
        {deprecated && (
          <div className="wizard-deprecated">
            <p className="wizard-warn">⚠️ {deprecated.text}</p>
            <div className="wizard-actions">
              <button className="secondary-button" onClick={() => {
                setModelId(deprecated.replace);
                setModelManual("");
                setDeprecated(null);
              }}>
                改用 {deprecated.replace}
              </button>
              <button className="secondary-button" onClick={() => {
                goto(pickModel(nav, chosenId));
              }}>
                仍用 {chosenId}
              </button>
            </div>
          </div>
        )}
</>
    );
  }

  function renderKey() {
    const modelEntry = modelById(sel.providerId, sel.billingId, sel.modelId, catalog);
    const envHint = envHintFor(sel.providerId);
    const parsed = parseKeyAnswer(keyInput);
    return (
      <>
        <dl className="wizard-summary">
          <div><dt>已选</dt><dd>{provider?.display} · {billingMode?.label}</dd></div>
          <div><dt>端点</dt><dd><code>{sel.baseUrl}</code></dd></div>
          {billingMode?.base_url_anthropic && (
            <div><dt>备查</dt><dd><code>{billingMode.base_url_anthropic}</code>（Anthropic 协议端点）</dd></div>
          )}
          <div><dt>模型</dt><dd>{sel.modelId}{modelEntry ? `（${modelEntry.display}）` : ""}</dd></div>
        </dl>
        {smoke.phase === "idle" && (
          <>
            <label className="wizard-field">
              <span>API key（也可输入 <code>env:变量名</code> 引用环境变量，如 <code>env:{envHint}</code>）</span>
              <input
                type="password"
                value={keyInput}
                onChange={(e) => { setKeyInput(e.target.value); setError(null); }}
                placeholder={`sk-… 或 env:${envHint}`}
                spellCheck={false}
                autoFocus
              />
            </label>
            <p className="wizard-dim">
              key 只发给本机 Host 验证并落 <code>profiles.json</code>（0600 私密文件）；env: 引用则本机不留存 key 本体。
              验证请用底栏「验证并保存」。
            </p>
          </>
        )}
        {smoke.phase === "verifying" && (
          <p className="wizard-dim"><i className="mini-spinner" /> 冒烟验证：真实调用一次模型（30s 超时）…</p>
        )}
        {smoke.phase === "ok" && (
          <div className="wizard-smoke ok">
            <p><Icon name="check" size={15} /> {smoke.detail}</p>
            {smoke.liveLine && <p className="wizard-dim">{smoke.liveLine}</p>}
            <p className="wizard-dim">档案已保存：{smoke.profileId}（{sel.modelId} @ {sel.baseUrl}）</p>
            <p className="wizard-dim">请点底栏「下一步：身份诞生」继续。</p>
          </div>
        )}
        {smoke.phase === "failed" && (
          <div className="wizard-smoke fail">
            <p><Icon name="x" size={15} /> {smoke.detail}</p>
            <div className="wizard-actions">
              <button className="secondary-button" onClick={() => { setSmoke({ phase: "idle" }); setKeyInput(""); }}>
                重输 key
              </button>
              <button className="secondary-button" onClick={onBack}>
                返回换模型
              </button>
              <button
                className="secondary-button danger"
                onClick={() => {
                  const key = parseKeyAnswer(keyInput) ?? { apiKey: "", apiKeyEnv: "" };
                  void skipAndSave(sel, key);
                }}
              >
                跳过验证先保存
              </button>
            </div>
            <p className="wizard-warn">⚠ {SMOKE_SKIP_WARNING}</p>
          </div>
        )}
      </>
    );
  }

  function renderCustomBase() {
    return (
      <>
        <p className="wizard-lead">任何兼容 OpenAI /chat/completions 的端点均可（本地 vLLM/Ollama/自建网关…）。</p>
        <label className="wizard-field">
          <span>API Base URL（通常以 /v1 结尾）</span>
          <input
            value={customBaseInput}
            onChange={(e) => { setCustomBaseInput(e.target.value); setError(null); }}
            placeholder="http://127.0.0.1:8000/v1"
            spellCheck={false}
            autoFocus
          />
        </label>
        <label className="wizard-field">
          <span>档案 id</span>
          <input
            value={customIdInput}
            onChange={(e) => setCustomIdInput(e.target.value)}
            placeholder="custom"
            spellCheck={false}
          />
        </label>

      </>
    );
  }

  function renderCustomKey() {
    const parsed = parseKeyAnswer(keyInput);
    return (
      <>
        <dl className="wizard-summary">
          <div><dt>端点</dt><dd><code>{sel.baseUrl}</code></dd></div>
        </dl>
        <label className="wizard-field">
          <span>API key（本地无鉴权端点可填任意非空占位；<code>env:变量名</code> 亦可）</span>
          <input
            type="password"
            value={keyInput}
            onChange={(e) => { setKeyInput(e.target.value); setError(null); }}
            placeholder="sk-local"
            spellCheck={false}
            autoFocus
          />
        </label>

      </>
    );
  }

  function renderCustomModel() {
    const chosenId = modelManual.trim() || modelId;
    return (
      <>
        <dl className="wizard-summary">
          <div><dt>端点</dt><dd><code>{sel.baseUrl}</code></dd></div>
        </dl>
        {smoke.phase === "idle" && (
          <>
            {modelLoading && <p className="wizard-dim"><i className="mini-spinner" /> 正在拉取实时模型列表…</p>}
            {!modelLoading && liveProbe && (
              <>
                <p className="wizard-dim">{liveProbe.detail}</p>
                {liveProbe.ok && (
                  <div className="wizard-option-list tall">
                    {liveProbe.ids.map((id, index) => (
                      <button
                        key={id}
                        className={`wizard-option ${chosenId === id && !modelManual.trim() ? "selected" : ""}`}
                        onClick={() => { setModelId(id); setModelManual(""); }}
                      >
                        <span className="wizard-option-num">{String(index + 1).padStart(2, "0")}</span>
                        <span className="wizard-option-main"><strong>{id}</strong></span>
                      </button>
                    ))}
                  </div>
                )}
              </>
            )}
            <label className="wizard-field">
              <span>{liveProbe?.ok ? "也可手输模型 id" : "模型名"}</span>
              <input
                value={modelManual}
                onChange={(e) => setModelManual(e.target.value)}
                placeholder="模型 id"
                spellCheck={false}
              />
            </label>
            <p className="wizard-dim">选定后用底栏「验证并保存」完成冒烟；步骤内不再放第二颗主按钮。</p>
          </>
        )}
        {smoke.phase === "verifying" && (
          <p className="wizard-dim"><i className="mini-spinner" /> 冒烟验证：真实调用一次模型（30s 超时）…</p>
        )}
        {smoke.phase === "ok" && (
          <div className="wizard-smoke ok">
            <p><Icon name="check" size={15} /> {smoke.detail}</p>
            {smoke.liveLine && <p className="wizard-dim">{smoke.liveLine}</p>}
            <p className="wizard-dim">档案已保存：{smoke.profileId}（{sel.modelId} @ {sel.baseUrl}）</p>
            <p className="wizard-dim">请点底栏「下一步：身份诞生」继续。</p>
          </div>
        )}
        {smoke.phase === "failed" && (
          <div className="wizard-smoke fail">
            <p><Icon name="x" size={15} /> {smoke.detail}</p>
            <div className="wizard-actions">
              <button className="secondary-button" onClick={() => goto(goBack(nav, catalog))}>
                返回换 key
              </button>
              <button className="secondary-button" onClick={() => setSmoke({ phase: "idle" })}>
                重选模型
              </button>
              <button
                className="secondary-button danger"
                onClick={() => void skipAndSave(sel, sel.key ?? { apiKey: "", apiKeyEnv: "" })}
              >
                跳过验证先保存
              </button>
            </div>
            <p className="wizard-warn">⚠ {SMOKE_SKIP_WARNING}</p>
          </div>
        )}
      </>
    );
  }

  function renderIdentity() {
    if (identity.phase === "loading") {
      return <p className="wizard-dim"><i className="mini-spinner" /> 正在确认它是否已有名字…</p>;
    }
    if (identity.phase === "exists") {
      return (
        <div className="wizard-identity">
          <div className="brand-seal large">蓬</div>
          <h1>它已有名字：{identity.name}</h1>
          <p className="wizard-lead">
            身份诞生只做一次{identity.bornAt ? `（诞生日 ${identity.bornAt}）` : ""}，不再重复仪式。
          </p>
          <div className="wizard-actions center">
            <button className="primary-button" onClick={finish}>
              进入工作台<Icon name="chevron" size={15} />
            </button>
          </div>
        </div>
      );
    }
    if (identity.phase === "naming" || identity.phase === "celebrating") {
      return (
        <div className="wizard-identity">
          <div className="brand-seal large">蓬</div>
          <p className="eyebrow">身份诞生</p>
          <h1>大脑接上了，它还没有名字</h1>
          <p className="wizard-lead">
            给它起个名字，它会自我介绍三件事：单一核心、本地陪伴、记忆进化；
            第一套工作纪律（验证/压缩）会过审长进技能树。仪式只做一次，也可改天再办。
          </p>
          <label className="wizard-field">
            <span>它的名字</span>
            <input
              value={nameInput}
              onChange={(e) => setNameInput(e.target.value)}
              placeholder="蓬莱"
              maxLength={24}
              autoFocus
            />
          </label>
          <div className="wizard-actions center">
            <button
              className="primary-button"
              disabled={identity.phase === "celebrating"}
              onClick={() => void celebrate()}
            >
              {identity.phase === "celebrating" ? "正在诞生…" : "举行诞生仪式"}
            </button>
            <button className="link-button" onClick={() => setIdentity({ phase: "skipped" })}>
              跳过仪式，改天再办
            </button>
          </div>
        </div>
      );
    }
    if (identity.phase === "skipped") {
      return (
        <div className="wizard-identity">
          <div className="brand-seal large">蓬</div>
          <h1>仪式改天再办</h1>
          <p className="wizard-lead">
            下次重走向导（设置页「重新配置模型」或 CLI <code>penglai setup</code>）会再问。
          </p>
          <div className="wizard-actions center">
            <button className="primary-button" onClick={finish}>
              进入工作台<Icon name="chevron" size={15} />
            </button>
          </div>
        </div>
      );
    }
    // born
    const result = identity.result;
    const name = result.name ?? "蓬莱";
    return (
      <div className="wizard-identity">
        <div className="brand-seal large">蓬</div>
        <p className="eyebrow">身份诞生 · {result.bornAt}</p>
        <div className="wizard-intro-card">
          {introLines(name).map((line) => (
            <p key={line}>{line}</p>
          ))}
        </div>
        <div className="wizard-seeds">
          {(result.seeds ?? []).map((seed) => (
            <p key={seed.name} className={seed.outcome === "rejected" ? "wizard-warn" : "wizard-dim"}>
              {seed.outcome === "planted" && `✓ 工作纪律「${seed.name}」过审入树`}
              {seed.outcome === "kept" && `○ 工作纪律「${seed.name}」${seed.reason ?? ""}`}
              {seed.outcome === "rejected" && `! 工作纪律「${seed.name}」${seed.reason ?? ""}`}
            </p>
          ))}
          {result.identityWritten === false && (
            <p className="wizard-warn">⚠ L1 已满（≤30 行铁律），身份未能写入——请在 CLI 精简 L1.md 后重跑 setup。</p>
          )}
          {result.identityWritten !== false && (
            <p className="wizard-dim">身份已落全局记忆 L1（{name} · 诞生日 {result.bornAt}），今后对话它都带着这个名字。</p>
          )}
        </div>
        <div className="wizard-actions center">
          <button className="primary-button" onClick={finish}>
            进入工作台<Icon name="chevron" size={15} />
          </button>
        </div>
      </div>
    );
  }


  // ── 壳导航：底栏统一「上一步 | 下一步」，步骤不各自塞主按钮 ──
  const needsManualBase =
    nav.step === "billing" &&
    !!billingId &&
    !(billingRows(catalog, sel.providerId).find((r) => r.id === billingId)?.mode.base_url);

  const chrome: WizardChrome = (() => {
    switch (nav.step) {
      case "welcome":
      case "identity":
        return { kind: "none", showBack: false, primaryLabel: "", primaryEnabled: false };
      case "provider":
        return selectionChrome({ step: "provider", canProceed: !!providerId, primaryLabel: "下一步：选择接入方式" });
      case "billing":
        return selectionChrome({
          step: "billing",
          canProceed:
            !!billingId &&
            (!needsManualBase || /^https?:\/\//.test(billingManualBase.trim())),
          primaryLabel: "下一步：选择模型",
        });
      case "model": {
        const chosenId = modelManual.trim() || modelId;
        return selectionChrome({
          step: "model",
          canProceed: !!chosenId && !modelLoading && !deprecated,
          primaryLabel: "下一步：填入 Key",
        });
      }
      case "key":
        if (smoke.phase === "verifying") {
          return { kind: "busy", showBack: true, primaryLabel: "验证中…", primaryEnabled: false };
        }
        if (smoke.phase === "ok") {
          return selectionChrome({ step: "key", canProceed: true, primaryLabel: "下一步：身份诞生" });
        }
        // idle / failed：主按钮 = 开始验证（key 页内容区仍保留重试/跳过菜单）
        return selectionChrome({
          step: "key",
          canProceed: !!keyInput.trim(),
          primaryLabel: smoke.phase === "failed" ? "重新验证" : "验证并保存",
        });
      case "customBase":
        return selectionChrome({
          step: "customBase",
          canProceed: /^https?:\/\//.test(customBaseInput.trim()),
          primaryLabel: "下一步",
        });
      case "customKey":
        return selectionChrome({
          step: "customKey",
          canProceed: !!keyInput.trim(),
          primaryLabel: "下一步：选择模型",
        });
      case "customModel": {
        const chosenId = modelManual.trim() || modelId;
        if (smoke.phase === "verifying") {
          return { kind: "busy", showBack: true, primaryLabel: "验证中…", primaryEnabled: false };
        }
        if (smoke.phase === "ok") {
          return selectionChrome({ step: "customModel", canProceed: true, primaryLabel: "下一步：身份诞生" });
        }
        return selectionChrome({
          step: "customModel",
          canProceed: !!chosenId && !modelLoading,
          primaryLabel: smoke.phase === "failed" ? "重新验证" : "验证并保存",
        });
      }
      default:
        return { kind: "none", showBack: false, primaryLabel: "", primaryEnabled: false };
    }
  })();

  const onPrimary = () => {
    setError(null);
    switch (nav.step) {
      case "provider":
        if (providerId) goto(pickProvider(nav, providerId, catalog));
        break;
      case "billing": {
        const mode = billingRows(catalog, sel.providerId).find((r) => r.id === billingId)?.mode;
        const needs = mode ? !mode.base_url : false;
        if (!billingId) return;
        if (needs && !/^https?:\/\//.test(billingManualBase.trim())) return;
        goto(pickBilling(nav, billingId, catalog, needs ? billingManualBase : undefined));
        break;
      }
      case "model": {
        const chosenId = modelManual.trim() || modelId;
        if (!chosenId || modelLoading) return;
        const notice = deprecatedNotice(catalog, sel.providerId, chosenId);
        if (notice) {
          setDeprecated(notice);
          return;
        }
        goto(pickModel(nav, chosenId));
        break;
      }
      case "key": {
        if (smoke.phase === "ok") {
          goto(confirmSaved(nav));
          break;
        }
        const key = parseKeyAnswer(keyInput);
        if (!key) {
          setError("请填写 Key，或 env:变量名");
          break;
        }
        void smokeAndSave(nav.selections, key);
        break;
      }
      case "customBase": {
        const next = pickCustomBase(nav, customBaseInput, customIdInput);
        if ("error" in next) setError(next.error);
        else goto(next);
        break;
      }
      case "customKey": {
        const parsed = parseKeyAnswer(keyInput);
        if (!parsed) {
          setError("请填写 Key，或 env:变量名");
          return;
        }
        goto(pickCustomKey(nav, parsed));
        break;
      }
      case "customModel": {
        const chosenId = modelManual.trim() || modelId;
        if (!chosenId) return;
        if (smoke.phase === "ok") {
          goto(confirmSaved(nav));
          break;
        }
        const withModel = pickCustomModel(nav, chosenId);
        const key = withModel.selections.key;
        if (!key) {
          setError("缺少 Key，请返回上一步填写");
          break;
        }
        setNav(withModel);
        void smokeAndSave(withModel.selections, key);
        break;
      }
    }
  };

  const stepBody = (() => {

    switch (nav.step) {
      case "welcome": return renderWelcome();
      case "provider": return renderProvider();
      case "billing": return renderBilling();
      case "model": return renderModel();
      case "key": return renderKey();
      case "customBase": return renderCustomBase();
      case "customKey": return renderCustomKey();
      case "customModel": return renderCustomModel();
      case "identity": return renderIdentity();
    }
  })();

  const title = (() => {
    if (nav.step === "welcome" || nav.step === "identity") return null;
    if (nav.step === "provider") return "选择供应商（蓬莱的大脑）";
    if (nav.step === "billing") return `选择计费模式（${provider?.display ?? ""}）`;
    if (nav.step === "model") return `选择模型（${provider?.display ?? ""} · ${billingMode?.label ?? ""}）`;
    if (nav.step === "key") return "填入 Key 并验证";
    if (nav.step === "customBase") return "自定义 OpenAI 兼容端点";
    if (nav.step === "customKey") return "填入 Key（自定义端点）";
    if (nav.step === "customModel") return "选择模型（自定义端点）";
    return null;
  })();

  return (
    <main className="wizard-shell">
      <section className="wizard-card">
        <header className="wizard-head">
          <div className="wizard-head-left">
            {title ? <h2>{title}</h2> : <h2>蓬莱 · 首次启动向导</h2>}
          </div>
          <div className="wizard-head-right">
            {progress && <span className="wizard-progress">{progress.index}/{progress.total} · {progress.label}</span>}
            {manual && onCancel && (
              <button className="icon-button" title="取消" onClick={onCancel}>
                <Icon name="x" size={15} />
              </button>
            )}
          </div>
        </header>
        <section className="wizard-body">
          {error && <p className="wizard-error">{error}</p>}
          {stepBody}
        </section>
        <footer className="wizard-foot">
          <div className="wizard-foot-nav">
            {chrome.showBack || canBack ? (
              <button className="secondary-button" onClick={onBack} type="button">
                <Icon name="chevron" size={14} />上一步
              </button>
            ) : (
              <span className="wizard-foot-spacer" />
            )}
            {chrome.kind !== "none" ? (
              <button
                className="primary-button"
                type="button"
                disabled={!chrome.primaryEnabled}
                onClick={onPrimary}
              >
                {chrome.primaryLabel}
                {chrome.kind === "nav" && chrome.primaryEnabled ? <Icon name="chevron" size={15} /> : null}
              </button>
            ) : (
              <span className="wizard-foot-note">蓬莱 0.4 · key 永不离开本机 Host</span>
            )}
          </div>
          {chrome.kind !== "none" && (
            <p className="wizard-foot-hint">蓬莱 0.4 · key 永不离开本机 Host</p>
          )}
        </footer>
      </section>
    </main>
  );
}
