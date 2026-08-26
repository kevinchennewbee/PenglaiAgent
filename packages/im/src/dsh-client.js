window.__ModuleLoader__.load({
  id: "@penglai/im",
  factory: (require) => {
    const module = { exports: {} };
    const React = require("react");
    const jsx = require("react/jsx-runtime");
    const inject = ["remote"];

    function strictJson(value, depth = 0, seen = new Set()) {
      if (
        value === null ||
        typeof value === "string" ||
        typeof value === "boolean" ||
        (typeof value === "number" && Number.isFinite(value))
      )
        return value;
      if (
        depth > 12 ||
        !value ||
        typeof value !== "object" ||
        (!Array.isArray(value) &&
          Object.prototype.toString.call(value) !== "[object Object]")
      )
        throw new TypeError("IM Remote requires bounded JSON");
      if (seen.has(value)) throw new TypeError("IM Remote rejects cyclic JSON");
      seen.add(value);
      const entries = Array.isArray(value) ? value : Object.entries(value);
      if (entries.length > 4096)
        throw new TypeError("IM Remote JSON is too large");
      if (Array.isArray(value))
        value.forEach((item) => strictJson(item, depth + 1, seen));
      else
        for (const [key, item] of entries) {
          if (["__proto__", "prototype", "constructor"].includes(key))
            throw new TypeError("IM Remote rejects unsafe fields");
          strictJson(item, depth + 1, seen);
        }
      seen.delete(value);
      return value;
    }
    const remoteCodec = (kind) => ({
      mode: "strict",
      typeSymbol: `@penglai/im/client#${kind}`,
      schema: {
        parse(value) {
          if (
            kind === "input" &&
            (!value || typeof value !== "object" || Array.isArray(value))
          )
            throw new TypeError("IM Remote input must be an object");
          return value === undefined ? value : strictJson(value);
        },
      },
    });
    const remoteDescriptor = (method, input) => ({
      id: `@penglai/im#penglaiIm/${method}`,
      service: "penglaiIm",
      namespace: "penglaiIm",
      method,
      implementation: method,
      invocation: { kind: "direct" },
      parameters: input
        ? [
            {
              name: "input",
              wire: "input",
              source: "json",
              codec: remoteCodec("input"),
            },
          ]
        : [],
      result: remoteCodec("result"),
    });
    const INPUT_METHODS = new Set([
      "proposeBinding",
      "createBinding",
      "deleteBinding",
      "enableGroup",
      "pollWeixinQr",
      "submitWeixinVerification",
      "pollFeishuQr",
      "configureFeishu",
      "setFeishuOwner",
      "updateBindingVoicePolicy",
      "probeWeixinText",
      "probeWeixinNativeVoice",
      "confirmWeixinNativeVoice",
      "disableWeixinNativeVoice",
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
    ]);
    const REMOTE = {
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
      ].map((method) => remoteDescriptor(method, INPUT_METHODS.has(method))),
    };

    const COPY = {
      zh: {
        overview: "总览",
        weixin: "微信",
        feishu: "飞书",
        bindings: "绑定",
        commands: "命令",
        diagnostics: "诊断",
        connectWeixin: "连接微信",
        configureFeishu: "连接飞书",
        connectFeishu: "连接飞书",
        guidedConnect: "连接",
        disconnect: "断开",
        logout: "退出并删除凭据",
        manage: "管理",
        close: "关闭",
        experimental: "实验性",
        pasteToken: "粘贴官方 Token",
        pasteCreds: "粘贴凭据",
        saveConnect: "保存并连接",
        riskAck: "我已了解账号风险，仍要启用 WhatsApp",
        noQr: "该平台没有二维码捷径。请按官方 Bot / OAuth / Token 步骤连接。",
        whatsappRisk: "WhatsApp 使用社区协议，默认关闭，存在账号风险。这不是官方 Cloud API。",
        tokenHint: "凭据只写入本机保险库，界面不会回显。",
        scanOfficial: "请用官方应用扫码。",
        statusDisconnected: "未连接",
        statusConnecting: "正在连接",
        statusConnected: "已连接",
        statusNeedsAction: "需要处理",
        statusDisabled: "已关闭",
        statusNotConfigured: "未配置",
        statusDegraded: "降级",
        statusExpired: "已过期",
        statusFailed: "失败",
        lastError: "最近错误",
        referenceId: "参考号",
        reconnect: "重连",
        testSend: "测试",
        advanced: "高级设置",
        openConsole: "打开飞书开发者后台",
        openLongDoc: "打开长连接说明",
        copyScopes: "复制最小权限",
        copyEvent: "复制事件名称",
        copied: "已复制",
        connecting: "正在创建微信二维码…",
        connectingFeishu: "正在创建飞书二维码…",
        qrHint:
          "扫码后请在微信里向 Bot 发送任意消息；首次消息会收到欢迎和 /帮助、/项目 菜单。",
        feishuQrHint:
          "扫码后请在飞书里向机器人发任意消息；首次消息会收到欢迎和 /帮助、/项目 菜单。",
        feishuManual: "扫码不可用时再手动填写。",
        feishuFallback: "扫码不可用时手动填写",
        refresh: "刷新状态",
        cancel: "取消",
        submitCode: "提交验证码",
        qrPending: "等待扫码",
        qrScanned: "已扫码",
        qrConfirmed: "已确认",
        qrExpired: "已过期",
        qrNeed: "需要验证码",
        qrFailed: "失败",
        qrCancelled: "已取消",
        bindHint:
          "扫码后会自动使用官方默认工作区/会话。这里只在需要换会话时使用。",
        bindAction: "改绑到所选官方会话",
        workspace: "工作区",
        session: "会话",
        peer: "通道对端",
        voiceCapability: "语音能力",
        asrState: "语音识别",
        ttsState: "语音合成",
        inputMode: "接收方式",
        inputTextVoice: "文字和语音",
        inputTextOnly: "仅文字",
        replyMode: "回复方式",
        replyText: "仅文字",
        replyVoice: "仅语音（失败自动回退文字）",
        replyMirror: "跟随输入",
        replyBoth: "文字和语音",
        voiceChoice: "回复声音",
        textProbe: "发送微信文字测试",
        textProbeSent: "测试文字已发送，请在微信回复「收到文字」。",
        textProbeFailed: "微信文字测试发送失败，请查看诊断。",
        voiceInstallHint: "ASR 或 MOSS-TTS 未就绪时，对应语音能力会安全降级；请到蓬莱子菜单安装模型。",
        nativeProbe: "发送微信原生语音测试",
        nativeAwaiting: "测试已发送。只有你在微信确认看见可播放的语音气泡后，才能启用。",
        nativeConfirm: "我已看到语音气泡，启用",
        nativeReject: "没有看到，保持音频附件",
        nativeDisable: "停用原生气泡，改用音频附件",
        nativeEnabled: "微信原生语音气泡已启用；发送失败会自动降级为音频附件。",
        nativeFailed: "微信未接受原生语音测试，已保持音频附件回退。",
        nativeDiagnostic: "安全诊断",
        policyFailed: "语音设置保存失败，请刷新状态后重试。",
        feishuNotQr: "手动 App ID/Secret 只是后备。",
        feishuOwner: "允许的飞书 open_id",
        feishuOwnerHint:
          "扫码会自动记录确认者。手动连接必须填写该账号，否则私聊会被拒绝。",
        feishuOwnerMissing:
          "尚未指定允许身份：飞书私聊会全部拒绝，直到扫码确认或在此填写。",
        feishuOwnerSave: "保存允许身份",
        saveSecret: "保存并写入 credential ref",
        verifyConnect: "校验并连接",
        overviewHint:
          "连接平台后，在私聊里发任意消息。首次消息会收到欢迎和 /帮助 /项目 菜单，直接说「你好」也能对话。",
        weixinLine: "微信",
        feishuLine: "飞书",
        bound: "绑定",
        commandsHint:
          "/帮助 /模型 /项目 /会话 /新建 /状态 /插话 /停止 /语音 /声音 由 IM 确定性消费，不进入模型。",
        diagnosticsHint:
          "诊断只显示稳定错误码、队列计数和恢复动作，不含密钥或正文。",
        loading: "正在读取实际连接状态…",
        loadError: "无法读取 IM 状态",
        pageTitle: "消息连接",
        stepCreateApp: "创建企业自建应用",
        stepBot: "启用机器人能力",
        stepScopes: "授予最小私聊权限",
        stepLong: "选择长连接",
        stepEvent: "订阅 im.message.receive_v1",
        stepPublish: "创建并发布应用版本",
      },
      en: {
        overview: "Overview",
        weixin: "Weixin",
        feishu: "Feishu",
        bindings: "Bindings",
        commands: "Commands",
        diagnostics: "Diagnostics",
        connectWeixin: "Connect Weixin",
        configureFeishu: "Connect Feishu",
        connectFeishu: "Connect Feishu",
        guidedConnect: "Connect",
        disconnect: "Disconnect",
        logout: "Log out and delete credentials",
        manage: "Manage",
        close: "Close",
        experimental: "Experimental",
        pasteToken: "Paste the official token",
        pasteCreds: "Paste credentials",
        saveConnect: "Save and connect",
        riskAck: "I understand the account risk and still want to enable WhatsApp",
        noQr: "This platform has no QR shortcut. Use the official bot, OAuth, or token steps.",
        whatsappRisk: "WhatsApp uses a community protocol, stays off by default, and carries account risk. This is not the official Cloud API.",
        tokenHint: "Credentials are written only to the local vault and are never echoed.",
        scanOfficial: "Scan with the official app.",
        statusDisconnected: "Not connected",
        statusConnecting: "Connecting",
        statusConnected: "Connected",
        statusNeedsAction: "Needs attention",
        statusDisabled: "Disabled",
        statusNotConfigured: "Not configured",
        statusDegraded: "Degraded",
        statusExpired: "Expired",
        statusFailed: "Failed",
        lastError: "Last error",
        referenceId: "Reference",
        reconnect: "Reconnect",
        testSend: "Test",
        advanced: "Advanced settings",
        openConsole: "Open Feishu developer console",
        openLongDoc: "Open long-connection help",
        copyScopes: "Copy minimum scopes",
        copyEvent: "Copy event name",
        copied: "Copied",
        connecting: "Creating the Weixin QR challenge…",
        connectingFeishu: "Creating the Feishu QR challenge…",
        qrHint:
          "After you scan, send any message to the Weixin bot. The first message gets a welcome plus /help and /project.",
        feishuQrHint:
          "After you scan, send any message to the Feishu bot. The first message gets a welcome plus /help and /project.",
        feishuManual: "Enter credentials manually only if scan is unavailable.",
        feishuFallback: "Enter credentials manually if scan is unavailable",
        refresh: "Refresh status",
        cancel: "Cancel",
        submitCode: "Submit code",
        qrPending: "Waiting for scan",
        qrScanned: "Scanned",
        qrConfirmed: "Confirmed",
        qrExpired: "Expired",
        qrNeed: "Verification required",
        qrFailed: "Failed",
        qrCancelled: "Cancelled",
        bindHint:
          "After you scan, Penglai uses the official default workspace and session. Use this only to switch sessions.",
        bindAction: "Rebind to the selected official session",
        workspace: "Workspace",
        session: "Session",
        peer: "Channel peer",
        voiceCapability: "Voice capability",
        asrState: "Speech recognition",
        ttsState: "Speech synthesis",
        inputMode: "Accept",
        inputTextVoice: "Text and voice",
        inputTextOnly: "Text only",
        replyMode: "Reply",
        replyText: "Text only",
        replyVoice: "Voice (text fallback on failure)",
        replyMirror: "Mirror input",
        replyBoth: "Text and voice",
        voiceChoice: "Reply voice",
        voiceInstallHint: "If ASR or MOSS-TTS is not ready, that voice capability safely degrades. Install its model from the Penglai submenu.",
        nativeProbe: "Send Weixin native voice test",
        textProbe: "Send Weixin text test",
        textProbeSent: 'Test text sent. Reply "received" in Weixin.',
        textProbeFailed: "Weixin text test failed. Check diagnostics.",
        nativeAwaiting: "Test sent. Enable only after you visibly confirm a playable voice bubble in Weixin.",
        nativeConfirm: "I saw the voice bubble; enable",
        nativeReject: "Not visible; keep audio attachment",
        nativeDisable: "Disable native bubble; use audio attachment",
        nativeEnabled: "Weixin native voice bubble is enabled. Failures fall back to an audio attachment.",
        nativeFailed: "Weixin did not accept the native voice test. Audio attachment fallback remains active.",
        nativeDiagnostic: "Safe diagnostic",
        policyFailed: "Voice settings could not be saved. Refresh the status and try again.",
        feishuNotQr: "App ID/Secret is fallback only.",
        feishuOwner: "Allowed Feishu open_id",
        feishuOwnerHint:
          "Scan records the confirmer automatically. Manual connect must set this account, or private messages are rejected.",
        feishuOwnerMissing:
          "No allowed identity yet: Feishu private chats are rejected until you scan or enter it here.",
        feishuOwnerSave: "Save allowed identity",
        saveSecret: "Save and write credential ref",
        verifyConnect: "Verify and connect",
        overviewHint:
          "After you connect, send any private message. The first message gets a welcome plus /help and /project. Saying 你好 also starts the conversation.",
        weixinLine: "Weixin",
        feishuLine: "Feishu",
        bound: "bound",
        commandsHint:
          "/help /model /projects /sessions /new /status /steer /stop /voice /voiceid are consumed by IM and never enter the model.",
        diagnosticsHint:
          "Diagnostics show stable error codes, queue counts, and recovery actions only. No secrets or bodies.",
        loading: "Reading live IM status…",
        pageTitle: "Messaging",
        loadError: "Unable to read IM status",
        stepCreateApp: "Create a self-built enterprise app",
        stepBot: "Enable bot capability",
        stepScopes: "Grant minimum p2p scopes",
        stepLong: "Select long connection",
        stepEvent: "Subscribe im.message.receive_v1",
        stepPublish: "Create and publish an app version",
      },
    };

    function localeCopy() {
      const id = String(document.documentElement.lang ?? "zh");
      return COPY[id.startsWith("en") ? "en" : "zh"];
    }

    const QR_LABEL = (t) => ({
      pending: t.qrPending,
      scanned: t.qrScanned,
      confirmed: t.qrConfirmed,
      expired: t.qrExpired,
      "need-verification": t.qrNeed,
      failed: t.qrFailed,
      cancelled: t.qrCancelled,
    });
    const QR_FROM_HOST = {
      wait: "pending",
      waiting: "pending",
      scanned: "scanned",
      scaned: "scanned",
      connected: "confirmed",
      confirmed: "confirmed",
      expired: "expired",
      need_verify: "need-verification",
      "need-verification": "need-verification",
      error: "failed",
      failed: "failed",
      denied: "cancelled",
      cancelled: "cancelled",
    };

    function unwrapRemote(result) {
      if (result && typeof result === "object" && "ok" in result) {
        if (result.ok === false)
          throw new Error((result.error && result.error.message) || "remote");
        return result.value;
      }
      return result;
    }

    function imCall(remote, connection, method, args) {
      const api = remote && remote.penglaiIm;
      if (api && typeof api[method] === "function") {
        return Promise.resolve(
          args === undefined ? api[method]() : api[method](args),
        ).then(unwrapRemote);
      }
      if (
        !connection ||
        !connection.rpc ||
        typeof connection.rpc.call !== "function"
      ) {
        return Promise.reject(new Error("penglaiIm rpc missing"));
      }
      return connection.rpc
        .call("/api", "penglaiIm/" + method, {
          args: args ? { input: args } : {},
        })
        .then(unwrapRemote);
    }

    function withTimeout(promise, ms, message) {
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(message)), ms);
        Promise.resolve(promise).then(
          (value) => {
            clearTimeout(timer);
            resolve(value);
          },
          (err) => {
            clearTimeout(timer);
            reject(err);
          },
        );
      });
    }

    function BindingsPane({ remote, connection }) {
      const t = localeCopy();
      const [rows, setRows] = React.useState([]);
      const [routes, setRoutes] = React.useState([]);
      const [workspaces, setWorkspaces] = React.useState([]);
      const [workspaceId, setWorkspaceId] = React.useState("");
      const [sessionId, setSessionId] = React.useState("");
      const [peerKey, setPeerKey] = React.useState("");
      const [actionError, setActionError] = React.useState("");
      const [textProbeStatus, setTextProbeStatus] = React.useState("");
      const [voiceOptions, setVoiceOptions] = React.useState({ asr: "unavailable", tts: "unavailable", voices: [], weixinNative: { enabled: false } });
      const refresh = React.useCallback(() => {
        Promise.all([
          imCall(remote, connection, "listBindings").catch(() => []),
          imCall(remote, connection, "listBindableRoutes").catch(() => []),
          imCall(remote, connection, "listWorkspacesAndSessions").catch(() => ({
            workspaces: [],
          })),
          imCall(remote, connection, "getVoiceOptions").catch(() => ({ asr: "unavailable", tts: "unavailable", voices: [], weixinNative: { enabled: false } })),
        ]).then(([bindings, bindable, listed, voice]) => {
          setRows(Array.isArray(bindings) ? bindings : []);
          setRoutes(Array.isArray(bindable) ? bindable : []);
          const next = listed && listed.workspaces ? listed.workspaces : [];
          setWorkspaces(next);
          setVoiceOptions(voice || { asr: "unavailable", tts: "unavailable", voices: [], weixinNative: { enabled: false } });
          if (!workspaceId && next[0]) {
            setWorkspaceId(next[0].id);
            const firstSession = next[0].sessions && next[0].sessions[0];
            if (firstSession)
              setSessionId(
                typeof firstSession === "string"
                  ? firstSession
                  : firstSession.id,
              );
          }
        });
      }, [remote, connection, workspaceId]);
      React.useEffect(() => {
        refresh();
      }, [refresh]);
      const selected =
        workspaces.find((ws) => ws.id === workspaceId) || workspaces[0];
      const sessions = selected && selected.sessions ? selected.sessions : [];
      const bindSelected = () => {
        if (!workspaceId || !sessionId || !peerKey) return;
        const peer = routes.find(
          (r) => `${r.channel}:${r.accountId}:${r.peerId}` === peerKey,
        );
        if (!peer) return;
        const objectId = `${peer.channel}:${peer.accountId}:${peer.peerId}`;
        Promise.resolve(imCall(remote, connection, "proposeBinding", {
          action: "im.bind",
          objectId,
          workspaceId,
          sessionId,
        }))
          .then((proposed) => {
            const approve = window.penglai && window.penglai.requestOwnerApproval;
            if (!approve || !proposed || !proposed.actionId) {
              throw new Error("owner approval required");
            }
            return Promise.resolve(approve({ actionId: proposed.actionId })).then((decided) => {
              if (!decided || decided.decision !== "approved") throw new Error("owner denied");
              return imCall(remote, connection, "createBinding", {
                channel: peer.channel,
                accountId: peer.accountId,
                peerId: peer.peerId,
                workspaceId,
                sessionId,
                ownerActionId: proposed.actionId,
                receipt: decided.receipt,
              });
            });
          })
          .then(refresh)
          .catch(() => undefined);
      };
      const updateVoice = (row, patch) => {
        setActionError("");
        const current = row.voice || { inputMode: "text-and-voice", replyMode: "mirror-input", voiceId: "moss-zh-default" };
        Promise.resolve(imCall(remote, connection, "updateBindingVoicePolicy", {
          id: row.id,
          expectedRevision: row.revision,
          inputMode: patch.inputMode || current.inputMode,
          replyMode: patch.replyMode || current.replyMode,
          voiceId: patch.voiceId || current.voiceId,
        })).then(() => {
          setActionError("");
          refresh();
        }).catch(() => {
          setActionError(t.policyFailed);
          refresh();
        });
      };
      const nativeCall = (method, row, extra) => {
        setActionError("");
        Promise.resolve(imCall(remote, connection, method, { bindingId: row.id, ...(extra || {}) }))
          .then(() => {
            setActionError("");
            refresh();
          })
          .catch((error) => {
            const raw = error && typeof error.message === "string" ? error.message : "";
            const safe = raw.match(/\((?:getuploadurl|cdn-upload|sendmessage|native-voice)[a-z0-9-]*\)/i)?.[0] || "";
            setActionError(`${t.nativeFailed}${safe ? ` ${safe}` : ""}`);
            refresh();
          });
      };
      const textProbe = (row) => {
        setActionError("");
        setTextProbeStatus("");
        Promise.resolve(imCall(remote, connection, "probeWeixinText", { bindingId: row.id }))
          .then(() => setTextProbeStatus(t.textProbeSent))
          .catch(() => setActionError(t.textProbeFailed));
      };
      return jsx.jsxs("div", {
        "data-penglai-im-binding": "1",
        children: [
          jsx.jsx("p", { children: t.bindHint }),
          jsx.jsx("p", {
            "data-penglai-im-workspaces": String(workspaces.length),
            children: String(workspaces.length),
          }),
          jsx.jsx("label", { children: t.peer }),
          jsx.jsx("select", {
            "data-penglai-im-peer": "1",
            value: peerKey,
            onChange: (ev) => setPeerKey(ev.target.value),
            children: routes.map((r) =>
              jsx.jsx(
                "option",
                {
                  value: `${r.channel}:${r.accountId}:${r.peerId}`,
                  children: `${r.channel} · ${r.peerId}`,
                },
                `${r.channel}:${r.accountId}:${r.peerId}`,
              ),
            ),
          }),
          jsx.jsx("label", { children: t.workspace }),
          jsx.jsx("select", {
            "data-penglai-im-workspace": "1",
            value: workspaceId,
            onChange: (ev) => {
              setWorkspaceId(ev.target.value);
              const ws = workspaces.find((item) => item.id === ev.target.value);
              const first = ws && ws.sessions && ws.sessions[0];
              setSessionId(
                first ? (typeof first === "string" ? first : first.id) : "",
              );
            },
            children: workspaces.map((ws) =>
              jsx.jsx(
                "option",
                { value: ws.id, children: ws.title || ws.id },
                ws.id,
              ),
            ),
          }),
          jsx.jsx("label", { children: t.session }),
          jsx.jsx("select", {
            "data-penglai-im-session": "1",
            value: sessionId,
            onChange: (ev) => setSessionId(ev.target.value),
            children: sessions.map((sess) => {
              const id = typeof sess === "string" ? sess : sess.id;
              return jsx.jsx("option", { value: id, children: id }, id);
            }),
          }),
          jsx.jsx("button", {
            type: "button",
            "data-penglai-im-bind": "1",
            onClick: bindSelected,
            children: t.bindAction,
          }),
          jsx.jsx("ul", {
            children: rows.map((row) =>
              jsx.jsxs(
                "li",
                {
                  "data-penglai-im-voice-policy": row.id,
                  style: { listStyle: "none", margin: "12px 0", padding: "14px", border: "1px solid var(--dsw-alias-border-l2)", borderRadius: "12px", background: "var(--dsw-alias-bg-module-platform)" },
                  children: [
                    jsx.jsx("strong", { children: `${row.channel} · ${row.peerId}` }),
                    jsx.jsx("p", { children: `${row.workspaceId} / ${row.sessionId}` }),
                    jsx.jsxs("p", { children: [`${t.voiceCapability} · ${t.asrState}: ${voiceOptions.asr} · ${t.ttsState}: ${voiceOptions.tts}`] }),
                    jsx.jsx("p", { style: { color: "var(--dsw-alias-label-secondary)", fontSize: "12px" }, children: t.voiceInstallHint }),
                    jsx.jsxs("label", { children: [t.inputMode, " ", jsx.jsxs("select", {
                      value: row.voice?.inputMode || "text-and-voice",
                      onChange: (ev) => updateVoice(row, { inputMode: ev.target.value }),
                      children: [jsx.jsx("option", { value: "text-and-voice", children: t.inputTextVoice }), jsx.jsx("option", { value: "text-only", children: t.inputTextOnly })],
                    })] }),
                    " ",
                    jsx.jsxs("label", { children: [t.replyMode, " ", jsx.jsxs("select", {
                      value: row.voice?.replyMode || "mirror-input",
                      onChange: (ev) => updateVoice(row, { replyMode: ev.target.value }),
                      children: [
                        jsx.jsx("option", { value: "text", children: t.replyText }),
                        jsx.jsx("option", { value: "voice", children: t.replyVoice }),
                        jsx.jsx("option", { value: "mirror-input", children: t.replyMirror }),
                        jsx.jsx("option", { value: "text-and-voice", children: t.replyBoth }),
                      ],
                    })] }),
                    " ",
                    jsx.jsxs("label", { children: [t.voiceChoice, " ", jsx.jsx("select", {
                      value: row.voice?.voiceId || "moss-zh-default",
                      disabled: !Array.isArray(voiceOptions.voices) || voiceOptions.voices.length === 0,
                      onChange: (ev) => updateVoice(row, { voiceId: ev.target.value }),
                      children: (voiceOptions.voices || []).map((voice) => jsx.jsx("option", { value: voice.id, children: voice.displayName || voice.id }, voice.id)),
                    })] }),
                    row.channel === "weixin" ? jsx.jsxs("div", {
                      "data-penglai-weixin-native-voice": voiceOptions.weixinNative?.enabled ? "enabled" : voiceOptions.weixinNative?.pendingProbeId ? "pending" : "disabled",
                      style: { marginTop: "12px", paddingTop: "12px", borderTop: "1px solid var(--dsw-alias-border-l2)" },
                      children: [
                        jsx.jsx("button", { type: "button", onClick: () => textProbe(row), children: t.textProbe }, "text-probe"),
                        textProbeStatus
                          ? jsx.jsx("p", { role: "status", children: textProbeStatus }, "text-probe-status")
                          : null,
                        voiceOptions.weixinNative?.diagnostic
                          ? jsx.jsx("p", {
                              role: "alert",
                              "data-penglai-weixin-native-diagnostic": "1",
                              children: `${t.nativeDiagnostic}: ${voiceOptions.weixinNative.diagnostic}`,
                            }, "diagnostic")
                          : null,
                        voiceOptions.weixinNative?.enabled
                        ? [
                            jsx.jsx("p", { children: t.nativeEnabled }, "enabled"),
                            jsx.jsx("button", { type: "button", onClick: () => nativeCall("disableWeixinNativeVoice", row), children: t.nativeDisable }, "disable"),
                          ]
                        : voiceOptions.weixinNative?.pendingProbeId
                          ? [
                              jsx.jsx("p", { children: t.nativeAwaiting }, "awaiting"),
                              jsx.jsx("button", { type: "button", onClick: () => nativeCall("confirmWeixinNativeVoice", row, { probeId: voiceOptions.weixinNative.pendingProbeId, visible: true }), children: t.nativeConfirm }, "confirm"),
                              " ",
                              jsx.jsx("button", { type: "button", onClick: () => nativeCall("confirmWeixinNativeVoice", row, { probeId: voiceOptions.weixinNative.pendingProbeId, visible: false }), children: t.nativeReject }, "reject"),
                            ]
                          : [jsx.jsx("button", { type: "button", disabled: voiceOptions.tts !== "ready", onClick: () => nativeCall("probeWeixinNativeVoice", row), children: t.nativeProbe }, "probe")],
                      ],
                    }) : null,
                  ],
                },
                row.id,
              ),
            ),
          }),
          actionError
            ? jsx.jsx("p", {
                role: "alert",
                "data-penglai-im-action-error": "1",
                children: actionError,
              })
            : null,
        ],
      });
    }

    function qrSrc(raw) {
      const value = String(raw || "").trim();
      return /^data:image\/png;base64,/i.test(value) ? value : "";
    }

    function copyPlain(text) {
      const node = document.createElement("textarea");
      node.value = text;
      node.setAttribute("readonly", "");
      node.style.position = "fixed";
      node.style.left = "-9999px";
      document.body.appendChild(node);
      node.select();
      try {
        document.execCommand("copy");
      } catch {
        /* selectable field below remains */
      }
      node.remove();
    }

    const FEISHU_CONSOLE = "https://open.feishu.cn/app";
    const FEISHU_LONG_DOC =
      "https://open.feishu.cn/document/develop-an-echo-bot/faq?lang=zh-CN";
    const FEISHU_SCOPES = "im:message.p2p_msg:readonly\nim:message:send_as_bot";
    const FEISHU_EVENT = "im.message.receive_v1";

    function WeixinPane({ remote, connection, load, kick }) {
      const t = localeCopy();
      const labels = QR_LABEL(t);
      const [qr, setQr] = React.useState({
        status: "",
        challengeId: "",
        image: "",
        error: "",
      });
      const [code, setCode] = React.useState("");
      const mapped = QR_FROM_HOST[qr.status] || (qr.status ? qr.status : "");
      const begin = React.useCallback(() => {
        setQr({
          status: "wait",
          challengeId: "",
          image: "",
          error: t.connecting,
        });
        imCall(remote, connection, "beginWeixinQr")
          .then((started) => {
            setQr({
              status: started.status || "wait",
              challengeId: started.challengeId || "",
              image: qrSrc(started.qrImageRef || started.image),
              error: qrSrc(started.qrImageRef || started.image)
                ? ""
                : "qr image missing",
            });
            load();
          })
          .catch((err) =>
            setQr({
              status: "failed",
              challengeId: "",
              image: "",
              error: String(err && err.message ? err.message : err),
            }),
          );
      }, [remote, connection, load, t.connecting]);
      React.useEffect(() => {
        if (kick) begin();
      }, [kick, begin]);
      React.useEffect(() => {
        if (
          !qr.challengeId ||
          mapped === "confirmed" ||
          mapped === "expired" ||
          mapped === "failed" ||
          mapped === "cancelled"
        )
          return undefined;
        const timer = setInterval(() => {
          imCall(remote, connection, "pollWeixinQr", {
            challengeId: qr.challengeId,
          })
            .then((next) => {
              setQr((prev) => ({
                ...prev,
                status: next.status || prev.status,
                image: qrSrc(next.qrImageRef || prev.image),
              }));
              if (next.status === "connected") load();
            })
            .catch(() => undefined);
        }, 3000);
        return () => clearInterval(timer);
      }, [qr.challengeId, mapped, remote, connection, load]);
      const poll = () => {
        if (!qr.challengeId) return;
        imCall(remote, connection, "pollWeixinQr", {
          challengeId: qr.challengeId,
        })
          .then((next) => {
            setQr((prev) => ({
              ...prev,
              status: next.status || prev.status,
              image: qrSrc(next.qrImageRef || prev.image),
              error: "",
            }));
            if (next.status === "connected") load();
          })
          .catch((err) =>
            setQr((prev) => ({
              ...prev,
              status: "failed",
              error: String(err && err.message ? err.message : err),
            })),
          );
      };
      const verify = () => {
        if (!qr.challengeId) return;
        imCall(remote, connection, "submitWeixinVerification", {
          challengeId: qr.challengeId,
          code,
        })
          .then((next) => {
            setCode("");
            setQr((prev) => ({
              ...prev,
              status: next.status || prev.status,
              error: "",
            }));
          })
          .catch((err) =>
            setQr((prev) => ({
              ...prev,
              error: String(err && err.message ? err.message : err),
            })),
          );
      };
      const cancel = () => {
        imCall(remote, connection, "cancelWeixinQr")
          .then(() =>
            setQr({
              status: "cancelled",
              challengeId: "",
              image: "",
              error: "",
            }),
          )
          .catch(() => undefined);
      };
      return jsx.jsxs("div", {
        "data-section": "weixin",
        role: "region",
        "aria-label": "Weixin",
        children: [
          jsx.jsx("button", {
            type: "button",
            "data-penglai-im-qr-begin": "1",
            onClick: begin,
            children:
              qr.error === t.connecting ? t.connecting : t.connectWeixin,
          }),
          jsx.jsx("p", { children: t.qrHint }),
          mapped
            ? jsx.jsx("p", {
                "data-penglai-im-qr-state": mapped,
                "aria-live": "polite",
                children: labels[mapped] || mapped,
              })
            : null,
          qr.challengeId
            ? jsx.jsx("p", {
                "data-penglai-im-qr-ttl": "300000",
                children: "300s",
              })
            : null,
          qr.image
            ? jsx.jsx("img", {
                alt: "Weixin QR challenge",
                "data-penglai-im-qr-image": "1",
                src: qr.image,
                width: "192",
                height: "192",
              })
            : null,
          qr.error
            ? jsx.jsx("p", {
                "data-penglai-im-qr-error": "1",
                children: qr.error,
              })
            : null,
          jsx.jsx("button", {
            type: "button",
            onClick: poll,
            children: t.refresh,
          }),
          jsx.jsx("button", {
            type: "button",
            "data-penglai-im-qr-cancel": "1",
            onClick: cancel,
            children: t.cancel,
          }),
          mapped === "need-verification"
            ? jsx.jsxs("div", {
                children: [
                  jsx.jsx("input", {
                    "data-penglai-im-qr-code": "1",
                    value: code,
                    onChange: (ev) => setCode(ev.target.value),
                    autoComplete: "off",
                  }),
                  jsx.jsx("button", {
                    type: "button",
                    onClick: verify,
                    children: t.submitCode,
                  }),
                ],
              })
            : null,
          [
            "pending",
            "scanned",
            "confirmed",
            "expired",
            "need-verification",
            "failed",
            "cancelled",
          ].map((id) =>
            jsx.jsx(
              "span",
              {
                "data-penglai-im-qr-states": id,
                hidden: true,
                children: labels[id],
              },
              id,
            ),
          ),
        ],
      });
    }

    function FeishuPane({ remote, connection, load, appId, ownerKnown, kick }) {
      const t = localeCopy();
      const labels = QR_LABEL(t);
      const [qr, setQr] = React.useState({
        status: "",
        challengeId: "",
        image: "",
        error: "",
      });
      const [draftId, setDraftId] = React.useState(appId || "");
      const [ownerId, setOwnerId] = React.useState("");
      const [secret, setSecret] = React.useState("");
      const [doctor, setDoctor] = React.useState("");
      const [copied, setCopied] = React.useState("");
      const mapped = qr.image
        ? QR_FROM_HOST[qr.status] || (qr.status ? qr.status : "")
        : "";
      const busy = qr.error === t.connectingFeishu;
      const begin = React.useCallback(() => {
        setQr({
          status: "",
          challengeId: "",
          image: "",
          error: t.connectingFeishu,
        });
        withTimeout(
          imCall(remote, connection, "beginFeishuQr"),
          20000,
          t.connectingFeishu,
        )
          .then((started) => {
            const image = qrSrc(started.qrImageRef || started.image);
            setQr({
              status: image ? started.status || "wait" : "failed",
              challengeId: started.challengeId || "",
              image,
              error: image ? "" : "qr image missing",
            });
            if (image) load();
          })
          .catch((err) =>
            setQr({
              status: "failed",
              challengeId: "",
              image: "",
              error: String(err && err.message ? err.message : err),
            }),
          );
      }, [remote, connection, load, t.connectingFeishu]);
      React.useEffect(() => {
        if (kick) begin();
      }, [kick, begin]);
      React.useEffect(() => {
        if (
          !qr.challengeId ||
          mapped === "confirmed" ||
          mapped === "expired" ||
          mapped === "failed" ||
          mapped === "cancelled"
        )
          return undefined;
        const timer = setInterval(() => {
          imCall(remote, connection, "pollFeishuQr", {
            challengeId: qr.challengeId,
          })
            .then((next) => {
              setQr((prev) => ({
                ...prev,
                status: next.status || prev.status,
              }));
              if (next.status === "confirmed") load();
            })
            .catch(() => undefined);
        }, 5000);
        return () => clearInterval(timer);
      }, [qr.challengeId, mapped, remote, connection, load]);
      const cancel = () => {
        imCall(remote, connection, "cancelFeishuQr")
          .then(() =>
            setQr({
              status: "cancelled",
              challengeId: "",
              image: "",
              error: "",
            }),
          )
          .catch(() => undefined);
      };
      const save = () => {
        const value = secret;
        setSecret("");
        imCall(remote, connection, "configureFeishu", {
          appId: draftId,
          secret: value || undefined,
          ownerOpenId: ownerId.trim() || undefined,
        })
          .then(() => load())
          .catch((err) =>
            setDoctor(String(err && err.message ? err.message : err)),
          );
      };
      const saveOwner = () => {
        imCall(remote, connection, "setFeishuOwner", { openId: ownerId.trim() })
          .then(() => {
            setOwnerId("");
            return load();
          })
          .catch((err) =>
            setDoctor(String(err && err.message ? err.message : err)),
          );
      };
      const connect = () => {
        imCall(remote, connection, "verifyAndConnectFeishu")
          .then((next) => setDoctor(String(next.connection || "")))
          .then(load)
          .catch((err) =>
            setDoctor(String(err && err.message ? err.message : err)),
          );
      };
      return jsx.jsxs("div", {
        "data-section": "feishu",
        children: [
          jsx.jsx("button", {
            type: "button",
            "data-penglai-feishu-qr-begin": "1",
            disabled: busy,
            onClick: begin,
            children: busy ? t.connectingFeishu : t.connectFeishu,
          }),
          jsx.jsx("p", { children: t.feishuQrHint }),
          ownerKnown
            ? null
            : jsx.jsx("p", {
                "data-penglai-feishu-owner-missing": "1",
                children: t.feishuOwnerMissing,
              }),
          mapped
            ? jsx.jsx("p", {
                "data-penglai-feishu-qr-state": mapped,
                "aria-live": "polite",
                children: labels[mapped] || mapped,
              })
            : null,
          qr.image && qr.challengeId
            ? jsx.jsx("p", {
                "data-penglai-feishu-qr-ttl": "1",
                children: "3600s",
              })
            : null,
          qr.image
            ? jsx.jsx("img", {
                alt: "Feishu QR challenge",
                "data-penglai-feishu-qr-image": "1",
                src: qr.image,
                width: "192",
                height: "192",
              })
            : null,
          qr.error && !busy
            ? jsx.jsx("p", {
                "data-penglai-feishu-qr-error": "1",
                children: qr.error,
              })
            : null,
          busy || qr.image
            ? jsx.jsx("button", {
                type: "button",
                "data-penglai-feishu-qr-cancel": "1",
                onClick: cancel,
                children: t.cancel,
              })
            : jsx.jsx("button", {
                type: "button",
                "data-penglai-feishu-qr-cancel": "1",
                hidden: true,
                onClick: cancel,
                children: t.cancel,
              }),
          jsx.jsxs("details", {
            "data-penglai-feishu-fallback": "1",
            children: [
              jsx.jsx("summary", { children: t.feishuFallback }),
              jsx.jsx("p", { children: t.feishuNotQr }),
              jsx.jsx("p", { children: t.feishuManual }),
              jsx.jsx("p", {
                children: jsx.jsx("a", {
                  href: FEISHU_CONSOLE,
                  target: "_blank",
                  rel: "noreferrer noopener",
                  "data-penglai-feishu-console": "1",
                  children: t.openConsole,
                }),
              }),
              jsx.jsx("p", {
                children: jsx.jsx("a", {
                  href: FEISHU_LONG_DOC,
                  target: "_blank",
                  rel: "noreferrer noopener",
                  "data-penglai-feishu-long-doc": "1",
                  children: t.openLongDoc,
                }),
              }),
              jsx.jsx("p", {
                children: jsx.jsxs("button", {
                  type: "button",
                  "data-penglai-feishu-copy-scopes": "1",
                  onClick: () => {
                    copyPlain(FEISHU_SCOPES);
                    setCopied("scopes");
                  },
                  children: [
                    t.copyScopes,
                    copied === "scopes" ? " · " + t.copied : "",
                  ],
                }),
              }),
              jsx.jsx("p", {
                children: jsx.jsxs("button", {
                  type: "button",
                  "data-penglai-feishu-copy-event": "1",
                  onClick: () => {
                    copyPlain(FEISHU_EVENT);
                    setCopied("event");
                  },
                  children: [
                    t.copyEvent,
                    copied === "event" ? " · " + t.copied : "",
                  ],
                }),
              }),
              jsx.jsx("input", {
                readOnly: true,
                value: FEISHU_SCOPES,
                "data-penglai-feishu-scopes": "1",
              }),
              jsx.jsx("input", {
                readOnly: true,
                value: FEISHU_EVENT,
                "data-penglai-feishu-event": "1",
              }),
              jsx.jsx("ol", {
                "data-penglai-feishu-wizard": "1",
                children: [
                  ["create_enterprise_app", t.stepCreateApp],
                  ["enable_bot_capability", t.stepBot],
                  ["grant_min_p2p_scopes", t.stepScopes],
                  ["select_long_connection", t.stepLong],
                  ["subscribe_im.message.receive_v1", t.stepEvent],
                  ["create_and_publish_version", t.stepPublish],
                ].map((step) =>
                  jsx.jsx(
                    "li",
                    { "data-penglai-feishu-step": step[0], children: step[1] },
                    step[0],
                  ),
                ),
              }),
              jsx.jsx("label", { children: "App ID" }),
              jsx.jsx("input", {
                "data-penglai-feishu-app-id": "1",
                value: draftId,
                onChange: (ev) => setDraftId(ev.target.value),
                autoComplete: "off",
              }),
              jsx.jsx("label", { children: "App Secret" }),
              jsx.jsx("input", {
                type: "password",
                "data-penglai-feishu-app-secret": "1",
                value: secret,
                onChange: (ev) => setSecret(ev.target.value),
                autoComplete: "off",
              }),
              jsx.jsx("label", { children: t.feishuOwner }),
              jsx.jsx("p", { children: t.feishuOwnerHint }),
              jsx.jsx("input", {
                "data-penglai-feishu-owner-id": "1",
                value: ownerId,
                onChange: (ev) => setOwnerId(ev.target.value),
                autoComplete: "off",
              }),
              jsx.jsx("button", {
                type: "button",
                "data-penglai-feishu-owner-save": "1",
                onClick: saveOwner,
                children: t.feishuOwnerSave,
              }),
              jsx.jsx("button", {
                type: "button",
                "data-penglai-feishu-save": "1",
                onClick: save,
                children: t.saveSecret,
              }),
              jsx.jsx("button", {
                type: "button",
                "data-penglai-feishu-connect": "1",
                onClick: connect,
                children: t.verifyConnect,
              }),
              doctor
                ? jsx.jsx("p", {
                    "data-penglai-feishu-doctor": "1",
                    children: doctor,
                  })
                : null,
            ],
          }),
        ],
      });
    }

    function plainStatus(channel, t) {
      const connection = String(channel.connection || "");
      if (connection === "connected") return t.statusConnected;
      if (connection === "connecting") return t.statusConnecting;
      if (connection === "disabled") return t.statusDisabled;
      if (connection === "not_configured") return t.statusNotConfigured;
      if (connection === "degraded") return t.statusDegraded;
      if (connection === "expired") return t.statusExpired;
      if (connection === "failed" || connection === "blocked") return t.statusFailed;
      return t.statusDisconnected;
    }

    function dualSecretLabels(channelId) {
      if (channelId === "slack") return ["Bot Token", "App Token"];
      if (channelId === "dingtalk") return ["Client ID", "Client Secret"];
      if (channelId === "wecom") return ["Bot ID", "Secret"];
      if (channelId === "qq") return ["App ID", "Client Secret"];
      return null;
    }

    function defaultMethod(channel) {
      const methods = channel.connectionMethods || [];
      if (methods.includes("qr")) return "qr";
      if (methods.includes("device-link")) return "device-link";
      if (methods.includes("token")) return "token";
      if (methods.includes("oauth")) return "oauth";
      return methods[0] || "token";
    }

    function ChannelConnectPane({ remote, connection, channel, manifest, load, onClose }) {
      const t = localeCopy();
      const methods = channel.connectionMethods || [];
      const usesQr = methods.includes("qr") || methods.includes("device-link");
      const usesToken = methods.includes("token") || methods.includes("oauth") || methods.includes("manifest");
      const [secret, setSecret] = React.useState("");
      const [secretB, setSecretB] = React.useState("");
      const [riskAck, setRiskAck] = React.useState(false);
      const [error, setError] = React.useState("");
      const [steps, setSteps] = React.useState([]);
      const [scanImage, setScanImage] = React.useState("");
      const [operationId, setOperationId] = React.useState("");
      const dual = dualSecretLabels(channel.channel);
      const lang = String(document.documentElement.lang || "zh").startsWith("en") ? "en" : "zh";
      const begin = (method) => {
        setError("");
        const combined = dual ? [secret, secretB].filter(Boolean).join("\n") : secret;
        const args = {
          channel: channel.channel,
          method,
          ...(channel.risk === "community-protocol" ? { riskAck } : {}),
          ...(combined ? { secret: combined } : {}),
        };
        setSecret("");
        setSecretB("");
        imCall(remote, connection, "beginChannelConnection", args)
          .then((started) => {
            setOperationId(started.operationId || "");
            setSteps((started.steps && started.steps[lang]) || []);
            setScanImage(qrSrc(started.qrImageRef));
            load();
          })
          .catch((err) => setError(String(err && err.message ? err.message : err)));
      };
      React.useEffect(() => {
        if (!operationId) return undefined;
        const timer = setInterval(() => {
          imCall(remote, connection, "pollChannelConnection", {
            channel: channel.channel,
            operationId,
          })
            .then((next) => {
              const image = qrSrc(next.qrImageRef);
              if (image) setScanImage(image);
              if (next.status === "connected" || next.status === "failed" || next.status === "expired") load();
            })
            .catch((err) => setError(String(err && err.message ? err.message : err)));
        }, 3000);
        return () => clearInterval(timer);
      }, [operationId, channel.channel, remote, connection, load]);
      return jsx.jsxs("div", {
        role: "dialog",
        "aria-modal": "true",
        "data-penglai-im-connect-dialog": channel.channel,
        style: {
          marginTop: "12px",
          padding: "14px",
          border: "1px solid var(--dsw-alias-border-l2)",
          borderRadius: "12px",
          background: "var(--dsw-alias-bg-module-platform)",
        },
        children: [
          jsx.jsx("p", { children: t.tokenHint }),
          channel.risk === "community-protocol"
            ? jsx.jsxs("label", {
                children: [
                  jsx.jsx("input", {
                    type: "checkbox",
                    "data-penglai-im-risk-ack": "1",
                    checked: riskAck,
                    onChange: (ev) => setRiskAck(ev.target.checked),
                  }),
                  " ",
                  t.riskAck,
                ],
              })
            : null,
          channel.risk === "community-protocol" ? jsx.jsx("p", { children: t.whatsappRisk }) : null,
          usesQr
            ? jsx.jsx("p", { children: t.scanOfficial })
            : jsx.jsx("p", { children: t.noQr }),
          usesToken
            ? jsx.jsxs("div", {
                children: [
                  jsx.jsx("label", {
                    htmlFor: `penglai-im-secret-${channel.channel}`,
                    children: dual ? dual[0] : t.pasteToken,
                  }),
                  jsx.jsx("input", {
                    id: `penglai-im-secret-${channel.channel}`,
                    type: "password",
                    autoComplete: "off",
                    "data-penglai-im-secret": channel.channel,
                    value: secret,
                    onChange: (ev) => setSecret(ev.target.value),
                  }),
                  dual
                    ? jsx.jsxs("p", {
                        children: [
                          jsx.jsx("label", {
                            htmlFor: `penglai-im-secret-b-${channel.channel}`,
                            children: dual[1],
                          }),
                          jsx.jsx("input", {
                            id: `penglai-im-secret-b-${channel.channel}`,
                            type: "password",
                            autoComplete: "off",
                            "data-penglai-im-secret-app": channel.channel,
                            value: secretB,
                            onChange: (ev) => setSecretB(ev.target.value),
                          }),
                        ],
                      })
                    : null,
                ],
              })
            : null,
          jsx.jsx("ol", {
            children: steps.map((step, index) => jsx.jsx("li", { children: step }, index)),
          }),
          scanImage
            ? jsx.jsx("img", {
                alt: t.scanOfficial,
                "data-penglai-im-scan-image": "1",
                src: scanImage,
                width: 192,
                height: 192,
              })
            : null,
          error
            ? jsx.jsx("p", { role: "alert", "data-penglai-im-connect-error": "1", children: error })
            : null,
          jsx.jsx("button", {
            type: "button",
            "data-penglai-im-connect-submit": channel.channel,
            onClick: () => begin(defaultMethod(channel)),
            children: t.saveConnect,
          }),
          channel.connection === "connected" || channel.connection === "connecting"
            ? jsx.jsx("button", {
                type: "button",
                onClick: () =>
                  imCall(remote, connection, "disconnectChannel", { channel: channel.channel })
                    .then(load)
                    .catch(() => undefined),
                children: t.disconnect,
              })
            : null,
          jsx.jsx("button", {
            type: "button",
            onClick: () =>
              imCall(remote, connection, "logoutChannel", { channel: channel.channel })
                .then(() => {
                  onClose();
                  load();
                })
                .catch(() => undefined),
            children: t.logout,
          }),
          jsx.jsx("button", { type: "button", onClick: onClose, children: t.close }),
        ],
      });
    }

    function ImTab({ remote, connection }) {
      const t = localeCopy();
      const [selected, setSelected] = React.useState("");
      const [weixinKick, setWeixinKick] = React.useState(0);
      const [feishuKick, setFeishuKick] = React.useState(0);
      const [snap, setSnap] = React.useState({
        status: "loading",
        overview: null,
        error: "",
      });
      const load = React.useCallback(() => {
        Promise.resolve(imCall(remote, connection, "getOverview"))
          .then((overview) => setSnap({ status: "ready", overview, error: "" }))
          .catch(() =>
            setSnap({ status: "error", overview: null, error: t.loadError }),
          );
      }, [remote, connection]);
      React.useEffect(() => {
        load();
      }, [load]);
      const channels = snap.overview?.channels ?? [];
      const openChannel = (id) => {
        setSelected(id);
        if (id === "weixin") setWeixinKick((n) => n + 1);
        if (id === "feishu") setFeishuKick((n) => n + 1);
      };
      return jsx.jsxs("section", {
        "data-penglai-im": "1",
        children: [
          jsx.jsx("h3", { children: t.pageTitle }),
          snap.status === "loading" ? jsx.jsx("p", { children: t.loading }) : null,
          snap.status === "error" ? jsx.jsx("p", { children: snap.error }) : null,
          snap.status === "ready"
            ? jsx.jsxs("div", {
                "data-section": "overview",
                children: [
                  jsx.jsx("p", { children: t.overviewHint }),
                  jsx.jsx("ul", {
                    "data-penglai-im-platforms": "1",
                    style: {
                      display: "grid",
                      gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))",
                      gap: "12px",
                      listStyle: "none",
                      padding: 0,
                    },
                    children: channels.map((c) => {
                      const manifest = (snap.overview?.manifests || []).find((row) => row.id === c.channel) || {};
                      const names = manifest.displayName || {};
                      const title = String(
                        (document.documentElement.lang || "zh").startsWith("en")
                          ? names.en || c.channel
                          : names.zh || c.channel,
                      );
                      const status = plainStatus(c, t);
                      return jsx.jsxs(
                        "li",
                        {
                          "data-penglai-im-platform": c.channel,
                          "data-penglai-im-live": String(c.live === true),
                          "data-penglai-im-connect-methods": (c.connectionMethods || []).join(","),
                          "data-penglai-im-status": status,
                          style: {
                            padding: "14px",
                            border: "1px solid var(--dsw-alias-border-l2)",
                            borderRadius: "12px",
                            background: "var(--dsw-alias-bg-module-platform)",
                          },
                          children: [
                            jsx.jsx("strong", { children: title }),
                            c.supportLevel === "experimental"
                              ? jsx.jsx("span", { children: ` · ${t.experimental}` })
                              : null,
                            jsx.jsx("p", { "aria-live": "polite", children: status }),
                            c.live === true
                              ? jsx.jsx("p", { "data-penglai-im-release-live": "1", children: "live" })
                              : null,
                            c.error
                              ? jsx.jsxs("p", {
                                  role: "alert",
                                  "data-penglai-im-last-error": c.channel,
                                  children: [
                                    t.lastError,
                                    ": ",
                                    c.error.code,
                                    " — ",
                                    (document.documentElement.lang || "zh").startsWith("en")
                                      ? c.error.message?.en
                                      : c.error.message?.zh,
                                    c.error.referenceId ? ` (${t.referenceId} ${c.error.referenceId})` : "",
                                  ],
                                })
                              : null,
                            jsx.jsx("button", {
                              type: "button",
                              "data-penglai-im-connect": c.channel,
                              ...(c.channel === "weixin" ? { "data-penglai-im-goto-weixin": "1" } : {}),
                              ...(c.channel === "feishu" ? { "data-penglai-im-goto-feishu": "1" } : {}),
                              onClick: () => openChannel(c.channel),
                              children: t.guidedConnect,
                            }),
                          ],
                        },
                        c.channel,
                      );
                    }),
                  }),
                ],
              })
            : null,
          selected === "weixin"
            ? jsx.jsx(WeixinPane, {
                remote,
                connection,
                load,
                kick: weixinKick,
              })
            : null,
          selected === "feishu"
            ? jsx.jsx(FeishuPane, {
                remote,
                connection,
                load,
                appId: String(snap.overview?.feishuAppId ?? ""),
                ownerKnown: snap.overview?.feishuOwnerKnown === true,
                kick: feishuKick,
              })
            : null,
          selected && selected !== "weixin" && selected !== "feishu"
            ? jsx.jsx(ChannelConnectPane, {
                remote,
                connection,
                channel: channels.find((row) => row.channel === selected) || { channel: selected, connectionMethods: [] },
                load,
                onClose: () => setSelected(""),
              })
            : null,
          jsx.jsxs("details", {
            "data-penglai-im-advanced": "1",
            children: [
              jsx.jsx("summary", { children: t.advanced }),
              jsx.jsx(BindingsPane, { remote, connection }),
              jsx.jsx("p", { children: t.commandsHint }),
              jsx.jsx("p", { children: t.diagnosticsHint }),
            ],
          }),
        ],
      });
    }

    function ImSettingsSection(props) {
      return jsx.jsx("div", {
        className: "penglai-settings-page",
        "data-penglai-settings": "im",
        children: jsx.jsx(ImTab, props),
      });
    }

    async function apply(ctx) {
      const disposeRemote = await ctx.remote.$mount(REMOTE);
      const viewFiber = ctx.inject(
        ["slots", "connection", "remote.penglaiIm"],
        (viewCtx) => {
          const pageRemote = { penglaiIm: viewCtx.remote.penglaiIm };
          viewCtx.slots.inject("settings.section", () =>
            viewCtx.slots.register(
              {
                name: "settings.section",
                id: "penglai-im",
                order: 18.1,
                label: () =>
                  String(document.documentElement.lang ?? "zh").startsWith("en")
                    ? "Messages"
                    : "消息连接",
                inject: () => ({
                  remote: pageRemote,
                  connection: viewCtx.connection,
                }),
              },
              ImSettingsSection,
            ),
          );
        },
      );
      try {
        await viewFiber;
      } catch (error) {
        await disposeRemote();
        throw error;
      }
      return async () => {
        await viewFiber.dispose();
        await disposeRemote();
      };
    }

    module.exports = { apply, inject };
    return module.exports;
  },
});
