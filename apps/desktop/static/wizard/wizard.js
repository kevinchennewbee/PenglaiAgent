(() => {
  const COPY = {
    zh: {
      brand: "蓬莱 Penglai",
      progress: "第 {n} 步，共 7 步",
      back: "上一步",
      skip: "跳过",
      continue: "继续",
      finish: "进入蓬莱",
      locale: "语言",
      theme: "外观",
      themeLight: "浅色",
      themeDark: "深色",
      themeSystem: "跟随系统",
      languageTitle: "欢迎使用蓬莱",
      languageBody: "先选中文或 English，并选外观。默认中文、跟随系统，之后仍可在设置里改。",
      privacyTitle: "隐私说明",
      privacyBody:
        "API 密钥、微信令牌和飞书 App Secret 只写入本机 YAML 配置文件。向导和界面读不到明文。同一电脑账户下的其他本地程序仍可能读到该文件；这不是钥匙串或硬件隔离。\n\n微信与飞书只转发你绑定过的私聊文字和语音。二维码、聊天内容和密钥不会写入日志。",
      modelsTitle: "选择模型",
      modelsBody: "从已配置的供应商里选一个默认模型。列表与设置里的模型页相同。",
      provider: "供应商",
      model: "模型",
      credentialTitle: "输入 API 密钥",
      credentialBody: "密钥只保存在本机 YAML 文件。点继续会立刻测试一次连通。",
      apiKey: "API 密钥",
      workspaceTitle: "工作区",
      workspaceBody: "选择一个本机文件夹作为官方 Workspace。蓬莱不会把工作区建在自己的数据目录或安装目录里。",
      workspacePath: "文件夹",
      workspaceTitleField: "名称",
      workspacePick: "选择文件夹",
      firstTurnTitle: "第一条消息",
      firstTurnBody: "向官方 Session 发送第一条真实消息。成功后会重启进入蓬莱。",
      firstTurnMessage: "消息",
      doneTitle: "可以开始使用",
      doneBody: "引导完成。接下来进入蓬莱。",
      busy: "正在处理…",
      testing: "正在测试已选模型…",
      errorGeneric: "这一步还不能继续。",
      errorAuth: "密钥无效，或这个模型没有读到密钥。请重新输入。",
      errorRate: "模型接口限流。请稍后重试。",
      errorModel: "这个模型不可用，或测试回复不符合预期。请换一个模型。",
      errorTimeout: "模型测试没有在时限内完成。请检查网络后重试。",
      errorEmpty: "模型已经返回，但向导没有读到可用回复。请再试一次。",
      errorNetwork: "无法连接模型接口。请检查网络后重试。",
      errorAdapter: "这个供应商还不能用，请另选一个。",
      errorCatalog: "暂时读不到供应商列表。请重试。",
      retryCatalog: "重新读取列表",
      errorJail: "这个文件夹不能用作工作区（蓬莱数据目录或应用安装目录）。请另选一个。",
      errorRpc: "这一步的官方请求失败。请重试，或回到上一步检查输入。",
    },
    en: {
      brand: "Penglai",
      progress: "Step {n} of 7",
      back: "Back",
      skip: "Skip",
      continue: "Continue",
      finish: "Enter Penglai",
      locale: "Language",
      theme: "Appearance",
      themeLight: "Light",
      themeDark: "Dark",
      themeSystem: "System",
      languageTitle: "Welcome to Penglai",
      languageBody: "Choose Chinese or English, then pick an appearance. Chinese and system appearance are the defaults. You can change both later in settings.",
      privacyTitle: "Privacy",
      privacyBody:
        "API keys, Weixin tokens, and Feishu App Secrets are written only to a local YAML file on this computer. The wizard and the app window cannot read secrets back. Another local program running as the same account may still read that file. This is not Keychain or hardware isolation.\n\nWeixin and Feishu forward only the private chats you bind. QR codes, chat contents, and secrets never enter logs.",
      modelsTitle: "Choose a model",
      modelsBody: "Pick a default model from the configured providers. This is the same list as the Models page in settings.",
      provider: "Provider",
      model: "Model",
      credentialTitle: "Enter API key",
      credentialBody: "The key stays in a local YAML file on this computer. Continue runs one connectivity test.",
      apiKey: "API key",
      workspaceTitle: "Workspace",
      workspaceBody: "Choose a local folder as the official Workspace. Penglai will not use its data directory or install directory.",
      workspacePath: "Folder",
      workspaceTitleField: "Name",
      workspacePick: "Choose folder",
      firstTurnTitle: "First message",
      firstTurnBody: "Send the first real message on the official Session. After it succeeds, Penglai restarts into the main window.",
      firstTurnMessage: "Message",
      doneTitle: "Ready",
      doneBody: "Setup is complete. Penglai is ready.",
      busy: "Working…",
      testing: "Testing the selected model…",
      errorGeneric: "This step cannot continue yet.",
      errorAuth: "The key is invalid, or this model did not read a key. Enter it again.",
      errorRate: "The model API rate-limited the request. Retry later.",
      errorModel: "This model is unavailable, or the test reply was unexpected. Choose another model.",
      errorTimeout: "The model test did not finish in time. Check the network and retry.",
      errorEmpty: "The model finished, but the wizard did not read a usable reply. Retry.",
      errorNetwork: "The model API could not be reached. Check the network and retry.",
      errorAdapter: "This provider is not available yet. Choose another one.",
      errorCatalog: "The provider list could not be loaded. Retry.",
      retryCatalog: "Reload list",
      errorJail: "That folder cannot be a workspace (Penglai data or the app install directory). Choose another folder.",
      errorRpc: "This official request failed. Retry, or go back and check the input.",
    },
  };

  const LEDGER_SCREENS = [
    { id: "language", ledger: "welcome-v1", number: 1, skippable: false },
    { id: "privacy", ledger: "privacy-v1", number: 2, skippable: false },
    { id: "models", ledger: "model-provider-v1", number: 3, skippable: false },
    { id: "keytest", ledger: "credential-v1", number: 4, skippable: false },
    { id: "workspace", ledger: "workspace-v1", number: 5, skippable: false },
    { id: "firstturn", ledger: "first-turn-v1", number: 6, skippable: false },
    { id: "done", ledger: "COMPLETE", number: 7, skippable: false },
  ];

  const state = {
    locale: "zh",
    theme: "system",
    current: "welcome-v1",
    completed: [],
    providers: [],
    models: [],
    selection: null,
    keyDraft: "",
    workspacePath: "",
    workspaceTitle: "Penglai",
    firstMessage: "你好",
    error: "",
    busy: false,
    viewIndex: 0,
  };

  function t(key) {
    const table = COPY[state.locale] || COPY.zh;
    return table[key] || COPY.en[key] || key;
  }

  function screenForLedger(current) {
    if (current === "welcome-v1" || current === "appearance-locale-v1") {
      return LEDGER_SCREENS.find((s) => s.id === "language");
    }
    if (current === "credential-v1" || current === "model-test-v1") {
      return LEDGER_SCREENS.find((s) => s.id === "keytest");
    }
    if (current === "workspace-v1") return LEDGER_SCREENS.find((s) => s.id === "workspace");
    if (current === "first-turn-v1") return LEDGER_SCREENS.find((s) => s.id === "firstturn");
    if (current === "COMPLETE") {
      return LEDGER_SCREENS.find((s) => s.id === "done");
    }
    return LEDGER_SCREENS.find((s) => s.ledger === current) || LEDGER_SCREENS[0];
  }

  function applyChrome() {
    const resolved =
      state.theme === "system"
        ? window.matchMedia("(prefers-color-scheme: dark)").matches
          ? "dark"
          : "light"
        : state.theme;
    document.documentElement.lang = state.locale;
    document.documentElement.dataset.theme = resolved;
    document.documentElement.dataset.themePref = state.theme;
    document.title = t("brand");
  }

  function classifyApiTestError(err) {
    const text = err instanceof Error ? err.message : String(err);
    if (/no adapter registered/i.test(text)) return "adapter";
    if (
      /\bAUTH\b|401|403|unauthorized|invalid.?key|authentication fails|MISSING_CREDENTIAL|no credential|no API key/i.test(
        text,
      )
    )
      return "auth";
    if (/429|rate.?limit/i.test(text)) return "rate";
    if (/model.?not|unknown model|404|did not include the nonce/i.test(text)) return "model";
    if (/no durable final|did not complete/i.test(text)) return "empty";
    if (/timeout|timed out|ETIMEDOUT/i.test(text)) return "timeout";
    if (/ENOTFOUND|ECONN|network|offline|DNS|TLS/i.test(text)) return "network";
    return "unknown";
  }

  function formatWizardError(err, kind) {
    const text = err instanceof Error ? err.message : String(err);
    if (kind === "api-test") {
      const keys = {
        auth: "errorAuth",
        rate: "errorRate",
        model: "errorModel",
        timeout: "errorTimeout",
        empty: "errorEmpty",
        network: "errorNetwork",
        adapter: "errorAdapter",
        unknown: "errorGeneric",
      };
      return t(keys[classifyApiTestError(err)] || "errorGeneric");
    }
    if (/SECURITY_POLICY|jail|install directory|userData|onboarding/i.test(text)) return t("errorJail");
    if (kind === "rpc" || /DSH_UNAVAILABLE|INVALID_INPUT|Typert|rpc/i.test(text)) return t("errorRpc");
    return t("errorGeneric");
  }

  function unwrapOfficialResult(payload) {
    const result = payload && typeof payload === "object" ? payload.result : undefined;
    if (!result || typeof result !== "object" || !("ok" in result)) throw new Error("rpc");
    if (result.ok === false) throw new Error((result.error && result.error.message) || "rpc");
    return result.value;
  }

  async function rpc(method, input) {
    const res = await fetch("/api/penglaiOnboarding/" + method, {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        type: "client-request",
        rpcId: crypto.randomUUID(),
        method: "penglaiOnboarding/" + method,
        payload: input === undefined ? { args: {} } : { args: { input } },
      }),
    });
    const json = await res.json();
    return unwrapOfficialResult(json);
  }

  function desktop(name) {
    const api = window.penglai;
    if (!api || typeof api[name] !== "function") throw new Error("desktop " + name + " missing");
    return api[name]();
  }

  function el(tag, attrs, children) {
    const node = document.createElement(tag);
    Object.entries(attrs || {}).forEach(([key, value]) => {
      if (value === false || value == null) return;
      if (key === "className") node.className = value;
      else if (key.startsWith("on") && typeof value === "function") node.addEventListener(key.slice(2).toLowerCase(), value);
      else if (key === "disabled") node.disabled = Boolean(value);
      else if (key === "value" && "value" in node) node.value = String(value);
      else node.setAttribute(key, value === true ? "" : String(value));
    });
    (children || []).forEach((child) => {
      if (child == null) return;
      node.appendChild(typeof child === "string" ? document.createTextNode(child) : child);
    });
    return node;
  }

  function option(value, label, selected) {
    const node = el("option", { value }, [label]);
    if (selected) node.selected = true;
    return node;
  }

  function currentScreen() {
    return LEDGER_SCREENS[state.viewIndex] || screenForLedger(state.current);
  }

  function atLiveStep() {
    if (!state.current) return false;
    const screen = currentScreen();
    if (state.current === "COMPLETE") return screen.id === "done";
    if (screen.id === "language" && (state.current === "welcome-v1" || state.current === "appearance-locale-v1")) {
      return true;
    }
    if (screen.id === "keytest" && (state.current === "credential-v1" || state.current === "model-test-v1")) {
      return true;
    }
    return screen.ledger === state.current;
  }

  function readKeyDraft() {
    const node = document.querySelector("[data-penglai-wizard-key]");
    if (node && "value" in node) state.keyDraft = String(node.value);
    return state.keyDraft || "";
  }

  function patchStatus() {
    const err = document.querySelector("[data-penglai-wizard-error]");
    if (err) {
      err.textContent = state.busy
        ? currentScreen().id === "keytest"
          ? t("testing")
          : t("busy")
        : state.error;
    }
    const back = document.querySelector("[data-penglai-wizard-back]");
    if (back) back.disabled = state.viewIndex === 0 || state.busy;
    const cont = document.querySelector("[data-penglai-wizard-continue]");
    if (cont) cont.disabled = !canContinue();
    const key = document.querySelector("[data-penglai-wizard-key]");
    if (key) key.disabled = state.busy;
  }

  function canContinue() {
    if (state.busy || !state.current) return false;
    if (!atLiveStep()) return true;
    const id = currentScreen().id;
    if (id === "models") return Boolean(state.selection && state.selection.provider && state.selection.model);
    if (id === "keytest" && state.current === "credential-v1") {
      const value = readKeyDraft();
      return value.length >= 4 && value.length <= 4096 && !/[\r\n]/.test(value);
    }
    if (id === "workspace") return Boolean(state.workspacePath);
    if (id === "firstturn") return Boolean((state.firstMessage || "").trim());
    return true;
  }

  function patchContinue() {
    const btn = document.querySelector("[data-penglai-wizard-continue]");
    if (btn) btn.disabled = !canContinue();
  }

  async function refreshStatus() {
    const status = await rpc("status");
    state.current = status.current;
    state.completed = Array.isArray(status.completed) ? status.completed : [];
    let providers = Array.isArray(status.providers) ? status.providers : [];
    if (providers.length === 0) {
      try {
        const listed = await rpc("listProviders");
        if (Array.isArray(listed)) providers = listed;
      } catch {
        /* status.catalogError is the honest signal */
      }
    }
    state.providers = providers;
    if (status.selection) state.selection = status.selection;
    const live = screenForLedger(state.current);
    state.viewIndex = Math.max(0, LEDGER_SCREENS.findIndex((s) => s.id === live.id));
    if (live.id === "models" && providers.length === 0) {
      state.error = t("errorCatalog");
    }
  }

  async function goBack() {
    if (state.viewIndex <= 0) return;
    state.viewIndex -= 1;
    state.error = "";
    render();
  }

  async function finishWizard() {
    await desktop("wizardFinished");
  }

  async function advanceLive() {
    const id = currentScreen().id;
    if (id === "language") {
      if (state.current === "welcome-v1") {
        const welcome = await rpc("completeWelcome");
        if (welcome && welcome.current) state.current = welcome.current;
      }
      if (state.current === "appearance-locale-v1") {
        await rpc("completeAppearance", { locale: state.locale, theme: state.theme });
      }
    } else if (id === "privacy") await rpc("completePrivacy");
    else if (id === "models") {
      await rpc("selectModel", { provider: state.selection.provider, model: state.selection.model });
    } else if (id === "keytest") {
      const value = readKeyDraft();
      const canWrite = value.length >= 4 && value.length <= 4096 && !/[\r\n]/.test(value);
      if (canWrite && (state.current === "credential-v1" || state.current === "model-test-v1")) {
        await rpc("enterCredential", { provider: state.selection?.provider, value });
        state.keyDraft = "";
        await refreshStatus();
      }
      if (state.current === "model-test-v1") {
        const nonce = crypto.randomUUID().replace(/-/g, "").slice(0, 16);
        const result = await rpc("testSelectedModel", { nonce });
        if (!result || result.passed !== true) {
          throw new Error("official nonce Turn did not complete");
        }
      }
    } else if (id === "workspace") {
      if (!state.workspacePath) throw new Error(t("errorJail"));
      await rpc("createWorkspace", {
        path: state.workspacePath,
        title: (state.workspaceTitle || "Penglai").slice(0, 128),
      });
    } else if (id === "firstturn") {
      const message = (state.firstMessage || "").trim();
      if (!message) throw new Error(t("errorGeneric"));
      const result = await rpc("runFirstConversation", { message });
      if (!result || result.passed !== true) throw new Error("official first Turn did not complete");
    } else if (id === "done") {
      await finishWizard();
      return;
    }
    await refreshStatus();
  }

  async function onContinue() {
    if (!canContinue()) return;
    readKeyDraft();
    state.busy = true;
    state.error = "";
    patchStatus();
    try {
      if (!atLiveStep()) {
        state.viewIndex = Math.min(state.viewIndex + 1, LEDGER_SCREENS.length - 1);
      } else {
        await advanceLive();
      }
    } catch (err) {
      const kind = currentScreen().id === "keytest" ? "api-test" : "rpc";
      state.error = formatWizardError(err, kind);
    } finally {
      state.busy = false;
      render();
    }
  }

  async function loadModels(provider) {
    if (!provider) {
      state.models = [];
      return;
    }
    state.models = await rpc("listModels", { provider });
  }

  function prefs() {
    return el("div", { className: "prefs" }, [
      el("label", {}, [
        t("locale"),
        el(
          "select",
          {
            "data-penglai-wizard-locale": "1",
            onChange: (ev) => {
              state.locale = ev.target.value === "en" ? "en" : "zh";
              render();
            },
          },
          [option("zh", "中文", state.locale === "zh"), option("en", "English", state.locale === "en")],
        ),
      ]),
    ]);
  }

  function bodyFor(screen) {
    if (screen.id === "language") {
      return [
        el("p", {}, [t("languageBody")]),
        el("div", { className: "choices" }, [
          el(
            "button",
            {
              type: "button",
              className: state.locale === "zh" ? "choice selected" : "choice",
              "data-penglai-wizard-language-zh": "1",
              onClick: () => {
                state.locale = "zh";
                render();
              },
            },
            ["中文"],
          ),
          el(
            "button",
            {
              type: "button",
              className: state.locale === "en" ? "choice selected" : "choice",
              "data-penglai-wizard-language-en": "1",
              onClick: () => {
                state.locale = "en";
                render();
              },
            },
            ["English"],
          ),
        ]),
        el("p", { className: "field-label" }, [t("theme")]),
        el("div", { className: "choices themes" }, [
          el(
            "button",
            {
              type: "button",
              className: state.theme === "system" ? "choice selected" : "choice",
              "data-penglai-wizard-theme-system": "1",
              onClick: () => {
                state.theme = "system";
                render();
              },
            },
            [t("themeSystem")],
          ),
          el(
            "button",
            {
              type: "button",
              className: state.theme === "light" ? "choice selected" : "choice",
              "data-penglai-wizard-theme-light": "1",
              onClick: () => {
                state.theme = "light";
                render();
              },
            },
            [t("themeLight")],
          ),
          el(
            "button",
            {
              type: "button",
              className: state.theme === "dark" ? "choice selected" : "choice",
              "data-penglai-wizard-theme-dark": "1",
              onClick: () => {
                state.theme = "dark";
                render();
              },
            },
            [t("themeDark")],
          ),
        ]),
      ];
    }
    if (screen.id === "privacy") return [el("p", {}, [t("privacyBody")])];
    if (screen.id === "models") {
      return [
        el("p", {}, [t("modelsBody")]),
        state.providers.length
          ? null
          : el(
              "button",
              {
                type: "button",
                "data-penglai-wizard-retry-catalog": "1",
                onClick: async () => {
                  state.busy = true;
                  state.error = "";
                  patchStatus();
                  try {
                    await refreshStatus();
                  } catch (err) {
                    state.error = formatWizardError(err, "rpc");
                  } finally {
                    state.busy = false;
                    render();
                  }
                },
              },
              [t("retryCatalog")],
            ),
        el("label", {}, [
          t("provider"),
          el(
            "select",
            {
              "data-penglai-wizard-provider": "1",
              onChange: async (ev) => {
                state.selection = { provider: ev.target.value, model: "" };
                state.busy = true;
                render();
                try {
                  await loadModels(ev.target.value);
                } catch (err) {
                  state.error = formatWizardError(err, "rpc");
                } finally {
                  state.busy = false;
                  render();
                }
              },
            },
            [option("", t("provider"), !state.selection?.provider)].concat(
              state.providers.map((p) => option(p.id, p.displayName || p.id, state.selection?.provider === p.id)),
            ),
          ),
        ]),
        el("label", {}, [
          t("model"),
          el(
            "select",
            {
              "data-penglai-wizard-model": "1",
              disabled: !state.models.length,
              onChange: (ev) => {
                state.selection = { provider: state.selection?.provider || "", model: ev.target.value };
                render();
              },
            },
            [option("", t("model"), !state.selection?.model)].concat(
              state.models.map((m) => option(m.id, m.name || m.id, state.selection?.model === m.id)),
            ),
          ),
        ]),
      ];
    }
    if (screen.id === "keytest") {
      return [
        el("p", {}, [t("credentialBody")]),
        el("label", {}, [
          t("apiKey"),
          el("input", {
            type: "password",
            autocomplete: "off",
            spellcheck: "false",
            "data-penglai-wizard-key": "1",
            value: state.keyDraft,
            onInput: () => {
              readKeyDraft();
              patchContinue();
            },
          }),
        ]),
      ];
    }
    if (screen.id === "workspace") {
      return [
        el("p", {}, [t("workspaceBody")]),
        el("label", {}, [
          t("workspaceTitleField"),
          el("input", {
            type: "text",
            "data-penglai-wizard-workspace-title": "1",
            value: state.workspaceTitle,
            onInput: (ev) => {
              state.workspaceTitle = ev.target.value;
            },
          }),
        ]),
        el("p", { className: "field-label" }, [t("workspacePath")]),
        el("p", { "data-penglai-wizard-workspace": "1" }, [state.workspacePath || ""]),
        el(
          "button",
          {
            type: "button",
            "data-penglai-wizard-workspace-pick": "1",
            onClick: async () => {
              try {
                const picked = await desktop("wizardPickFolder");
                if (picked) {
                  state.workspacePath = String(picked);
                  render();
                }
              } catch (err) {
                state.error = formatWizardError(err, "rpc");
                render();
              }
            },
          },
          [t("workspacePick")],
        ),
      ];
    }
    if (screen.id === "firstturn") {
      return [
        el("p", {}, [t("firstTurnBody")]),
        el("label", {}, [
          t("firstTurnMessage"),
          el("textarea", {
            "data-penglai-wizard-message": "1",
            value: state.firstMessage,
            onInput: (ev) => {
              state.firstMessage = ev.target.value;
              patchContinue();
            },
          }),
        ]),
      ];
    }
    return [el("p", {}, [t("doneBody")])];
  }

  function render() {
    applyChrome();
    const screen = currentScreen();
    const titles = {
      language: "languageTitle",
      privacy: "privacyTitle",
      models: "modelsTitle",
      keytest: "credentialTitle",
      workspace: "workspaceTitle",
      firstturn: "firstTurnTitle",
      done: "doneTitle",
    };
    const root = document.getElementById("wizard-root");
    root.replaceChildren(
      el("div", { className: "wizard-top" }, [
        el("div", { className: "brand-block" }, [
          el("div", { className: "mark", "aria-hidden": "true" }, ["蓬"]),
          el("div", { className: "brand" }, [t("brand")]),
        ]),
        prefs(),
      ]),
      el("p", { className: "progress", "data-penglai-wizard-progress": String(screen.number) }, [
        t("progress").replace("{n}", String(screen.number)),
      ]),
      el(
        "ol",
        { className: "steps", "aria-hidden": "true" },
        LEDGER_SCREENS.map((item) =>
          el("li", { className: item.number === screen.number ? "current" : item.number < screen.number ? "done" : "" }, [
            String(item.number),
          ]),
        ),
      ),
      el("section", { className: "card", "data-penglai-wizard-step": screen.id }, [
        el("h1", {}, [t(titles[screen.id])]),
        ...bodyFor(screen),
        el("p", { className: "error", "data-penglai-wizard-error": "1", role: "status", "aria-live": "polite" }, [
          state.busy ? (screen.id === "keytest" ? t("testing") : t("busy")) : state.error,
        ]),
        el("div", { className: "actions" }, [
          el(
            "button",
            {
              type: "button",
              "data-penglai-wizard-back": "1",
              disabled: state.viewIndex === 0 || state.busy,
              onClick: goBack,
            },
            [t("back")],
          ),
          el(
            "button",
            {
              type: "button",
              "data-penglai-wizard-skip": "1",
              disabled: true,
              hidden: true,
            },
            [t("skip")],
          ),
          el(
            "button",
            {
              type: "button",
              className: "primary",
              "data-penglai-wizard-continue": "1",
              disabled: !canContinue(),
              onClick: onContinue,
            },
            [screen.id === "done" ? t("finish") : t("continue")],
          ),
        ]),
      ]),
    );
  }

  async function boot() {
    applyChrome();
    render();
    try {
      await refreshStatus();
      if (state.selection?.provider) {
        try {
          await loadModels(state.selection.provider);
        } catch {
          state.models = [];
        }
      }
    } catch (err) {
      state.error = formatWizardError(err, "rpc");
    }
    render();
  }

  window.__PENGLAI_WIZARD__ = { COPY, LEDGER_SCREENS, classifyApiTestError, formatWizardError, unwrapOfficialResult };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", () => void boot());
  else void boot();
})();
