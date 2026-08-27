window.__ModuleLoader__.load({
  id: "@penglai/plugin-center",
  factory: (require) => {
    const module = { exports: {} };
    const React = require("react");
    const jsx = require("react/jsx-runtime");
    const inject = ["remote"];

    function strictJson(value, path = "$", depth = 0, seen = new Set()) {
      if (
        value === null ||
        typeof value === "string" ||
        typeof value === "boolean"
      )
        return value;
      if (typeof value === "number" && Number.isFinite(value)) return value;
      if (depth > 12)
        throw new TypeError(`${path} exceeds the Penglai Remote depth limit`);
      if (!value || typeof value !== "object")
        throw new TypeError(`${path} is not JSON data`);
      if (seen.has(value)) throw new TypeError(`${path} is cyclic`);
      seen.add(value);
      if (Array.isArray(value)) {
        if (value.length > 4096)
          throw new TypeError(`${path} exceeds the Penglai Remote item limit`);
        value.forEach((entry, index) =>
          strictJson(entry, `${path}[${index}]`, depth + 1, seen),
        );
      } else {
        const prototype = Object.getPrototypeOf(value);
        if (
          prototype !== null &&
          Object.prototype.toString.call(value) !== "[object Object]"
        )
          throw new TypeError(`${path} is not a plain object`);
        const keys = Object.keys(value);
        if (keys.length > 4096)
          throw new TypeError(`${path} exceeds the Penglai Remote field limit`);
        for (const key of keys) {
          if (
            key === "__proto__" ||
            key === "prototype" ||
            key === "constructor"
          )
            throw new TypeError(`${path} contains an unsafe field`);
          strictJson(value[key], `${path}.${key}`, depth + 1, seen);
        }
      }
      seen.delete(value);
      return value;
    }

    const inputSchema = {
      parse(value) {
        if (!value || typeof value !== "object" || Array.isArray(value))
          throw new TypeError("Penglai Remote input must be an object");
        return strictJson(value);
      },
    };
    const resultSchema = {
      parse(value) {
        return value === undefined ? value : strictJson(value);
      },
    };
    const codec = (kind) => ({
      mode: "strict",
      typeSymbol: `@penglai/plugin-center/client#${kind}`,
      schema: kind === "input" ? inputSchema : resultSchema,
    });
    const descriptor = (namespace, method, hasInput = false) => ({
      id: `@penglai/plugin-center#${namespace}/${method}`,
      service: namespace,
      namespace,
      method,
      implementation: method,
      invocation: { kind: "direct" },
      parameters: hasInput
        ? [
            {
              name: "input",
              wire: "input",
              source: "json",
              codec: codec("input"),
            },
          ]
        : [],
      result: codec("result"),
    });
    const methods = (namespace, names, inputNames = []) =>
      names.map((method) =>
        descriptor(namespace, method, inputNames.includes(method)),
      );
    const PENGLAI_REMOTE_CONTRIBUTION = {
      package: "@penglai/plugin-center",
      descriptors: [
        ...methods(
          "penglaiCenter",
          [
            "list",
            "enable",
            "disable",
            "update",
            "rollback",
            "refreshRegistry",
            "download",
            "installDisabled",
            "installEnable",
          ],
          ["enable", "disable", "update", "rollback", "download", "installDisabled", "installEnable"],
        ),
      ],
    };

    const HIDDEN_PRODUCT_CARDS = new Set([
      "@penglai/plugin-center",
      "@penglai/plugin-reference",
      "@penglai/plugin-pilot",
      "@penglai/budget",
    ]);
    const PRODUCT_LINKS = {
      repository: "https://github.com/kevinchennewbee/PenglaiAgent",
      homepage: "https://github.com/kevinchennewbee/PenglaiAgent",
      documentation: "https://github.com/kevinchennewbee/PenglaiAgent/blob/main/README.md",
      issues: "https://github.com/kevinchennewbee/PenglaiAgent/issues",
    };
    const FIRST_PARTY_CARDS = [
      { id: "@penglai/im", key: "cardIm" },
      { id: "@penglai/office", key: "cardOffice" },
      { id: "@penglai/asr", key: "cardAsr" },
      { id: "@penglai/moss-tts", key: "cardTts" },
      { id: "@penglai/memory", key: "cardMemory" },
      { id: "@penglai/companion", key: "cardCompanion" },
    ];

    const PAGE_ICONS = {
      "penglai-center": "M4 5.5h16M4 12h16M4 18.5h16M7 3v5M12 9.5v5M17 16v5",
      "penglai-im": "M4 5h16v11H9l-5 4V5Zm4 4h8M8 12h5",
      "penglai-asr":
        "M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3Zm-7 9a7 7 0 0 0 14 0M12 19v3M8 22h8",
      "penglai-moss-tts":
        "M4 10v4h4l5 4V6L8 10H4Zm13-2a6 6 0 0 1 0 8M19.5 5a10 10 0 0 1 0 14",
      "penglai-memory":
        "M5 6c0-1.1 3.1-2 7-2s7 .9 7 2-3.1 2-7 2-7-.9-7-2Zm0 0v6c0 1.1 3.1 2 7 2s7-.9 7-2V6M5 12v6c0 1.1 3.1 2 7 2s7-.9 7-2v-6",
      "penglai-office": "M6 3h9l5 5v13H6V3Zm9 0v5h5M8 13h8M8 17h6",
      "penglai-budget": "M4 19a8 8 0 1 1 16 0M12 11l4-3M7 19h10",
      "penglai-companion":
        "M12 21S4 16.2 4 9.5A4.5 4.5 0 0 1 12 6a4.5 4.5 0 0 1 8 3.5C20 16.2 12 21 12 21Z",
      "penglai-update":
        "M20 7v5h-5M4 17v-5h5M18.7 9A7 7 0 0 0 6.2 6.2L4 12M5.3 15A7 7 0 0 0 17.8 17.8L20 12",
      "penglai-uninstall": "M4 7h16M9 7V4h6v3M7 7l1 14h8l1-14M10 11v6M14 11v6",
    };

    function PageIcon({ id, size = 18 }) {
      return jsx.jsx("svg", {
        viewBox: "0 0 24 24",
        width: size,
        height: size,
        fill: "none",
        stroke: "currentColor",
        strokeWidth: 1.7,
        strokeLinecap: "round",
        strokeLinejoin: "round",
        "aria-hidden": "true",
        children: jsx.jsx("path", {
          d: PAGE_ICONS[id] ?? PAGE_ICONS["penglai-center"],
        }),
      });
    }

    function CenterTab({ list, mutate }) {
      const [state, setState] = React.useState({
        status: "loading",
        catalog: [],
        remote: [],
        registry: null,
        inventory: [],
        degraded: false,
      });
      const [actions, setActions] = React.useState({});
      const refresh = React.useCallback(() => {
        return Promise.resolve()
          .then(() => list())
          .then((snapshot) => {
            const inventory =
              snapshot?.inventory?.entries ?? snapshot?.entries ?? [];
            const catalog = Array.isArray(snapshot?.catalog)
              ? snapshot.catalog
              : [];
            const remote = Array.isArray(snapshot?.remote) ? snapshot.remote : [];
            setState({
              status: snapshot?.degraded ? "degraded" : "ready",
              catalog,
              remote,
              registry: snapshot?.registry ?? null,
              inventory: Array.isArray(inventory) ? inventory : [],
              degraded: Boolean(snapshot?.degraded),
            });
          })
          .catch(() =>
            setState({
              status: "degraded",
              catalog: [],
              remote: [],
              registry: null,
              inventory: [],
              degraded: true,
            }),
          );
      }, [list]);
      React.useEffect(() => {
        let active = true;
        refresh();
        const timer = setInterval(() => {
          if (active) refresh();
        }, 1000);
        return () => {
          active = false;
          clearInterval(timer);
        };
      }, [refresh]);
      const act = async (id, action) => {
        if (!mutate) return;
        setActions((current) => ({
          ...current,
          [id]: { busy: true, kind: "working", message: "" },
        }));
        try {
          await mutate(id, action);
          await refresh();
          const messages = {
            enable: localeCopy().centerActionEnabled,
            installEnable: localeCopy().centerActionInstalledEnabled,
            disable: localeCopy().centerActionDisabled,
            update: localeCopy().centerActionUpdated,
            rollback: localeCopy().centerActionRolledBack,
            download: localeCopy().centerActionDownloaded,
            installDisabled: localeCopy().centerActionInstalled,
            refreshRegistry: localeCopy().centerActionRefreshed,
          };
          setActions((current) => ({
            ...current,
            [id]: {
              busy: false,
              kind: "success",
              message: `${messages[action] ?? localeCopy().centerActionDone} ${localeCopy().centerActionReloading}`,
            },
          }));
          if (
            id &&
            id !== "@penglai/plugin-center" &&
            action !== "refreshRegistry" &&
            action !== "download" &&
            typeof window !== "undefined" &&
            typeof window.location?.reload === "function"
          ) {
            window.setTimeout(() => window.location.reload(), 900);
          }
        } catch (error) {
          setActions((current) => ({
            ...current,
            [id]: {
              busy: false,
              kind: "error",
              message: `${localeCopy().centerActionFailed}: ${error instanceof Error ? error.message : String(error)}`,
            },
          }));
        }
      };
      const t = localeCopy();
      if (state.status === "loading") {
        return jsx.jsx("section", {
          "data-penglai-center": "1",
          "data-penglai-center-status": "loading",
          children: t.centerLoading,
        });
      }
      const live = new Map(
        (state.catalog.length ? state.catalog : state.inventory).map(
          (entry) => [
            String(
              entry.id ?? entry.moduleName ?? entry.name ?? entry.entryId ?? "",
            ),
            entry,
          ],
        ),
      );
      for (const row of state.remote) {
        const id = String(row.id ?? "");
        if (id) live.set(id, { ...(live.get(id) ?? {}), ...row });
      }
      const remoteCardIds = state.remote
        .map((entry) => String(entry.id ?? ""))
        .filter((id) => id && !HIDDEN_PRODUCT_CARDS.has(id));
      const cardIds = [
        ...FIRST_PARTY_CARDS.map((card) => card.id),
        ...remoteCardIds,
      ].filter(
        (id, index, all) =>
          !HIDDEN_PRODUCT_CARDS.has(id) && all.indexOf(id) === index,
      );
      const firstParty = new Map(FIRST_PARTY_CARDS.map((card) => [card.id, card]));
      const cards = cardIds.map((id) => {
        const entry = live.get(id) ?? {};
        const meta = firstParty.get(id);
        const loaded = Boolean(entry.loaded ?? entry.fiberPhase === "active");
        const desired = String(
          entry.desired ?? (entry.enabled === false ? "disabled" : "enabled"),
        );
        const installed = String(entry.installed ?? "unknown");
        const notInstalled = installed === "not-installed" || installed === "unknown";
        const healthy = Boolean(entry.healthy ?? false);
        const revoked = Boolean(entry.revoked);
        const incompatible = Boolean(
          entry.incompatible || entry.dshCompatible === false,
        );
        const title =
          entry.title?.["zh-CN"] ||
          entry.title?.en ||
          (meta ? t[meta.key] : id);
        const hint =
          entry.summary?.["zh-CN"] ||
          entry.summary?.en ||
          (meta ? t[`${meta.key}Hint`] : "");
        const actionState = actions[id] ?? {
          busy: false,
          kind: "idle",
          message: "",
        };
        const statusCopy = incompatible
          ? t.centerStatusIncompatible
          : revoked
          ? t.centerStatusRevoked
          : notInstalled
            ? t.centerStatusNotInstalled
            : healthy
              ? t.centerStatusHealthy
              : loaded
                ? t.centerStatusAttention
                : t.centerStatusInactive;
        return jsx.jsxs(
          "li",
          {
            "data-penglai-plugin-card": id,
            "data-penglai-plugin-installed": installed,
            "data-penglai-plugin-loaded": String(loaded),
            "data-penglai-plugin-source": String(entry.source ?? "bundled-first-party"),
            "data-penglai-plugin-version": String(entry.version ?? ""),
            "data-penglai-plugin-revoked": String(revoked),
            className: "penglai-capability-card",
            children: [
              jsx.jsxs("header", {
                children: [
                  jsx.jsx("span", {
                    className: "penglai-capability-icon",
                    children: jsx.jsx(PageIcon, {
                      id: `penglai-${id.split("/").pop()?.replace("plugin-center", "center")}`,
                    }),
                  }),
                  jsx.jsxs("span", {
                    className: "penglai-capability-heading",
                    children: [
                      jsx.jsx("strong", { children: title }),
                    ],
                  }),
                  jsx.jsx("span", {
                    className: `penglai-status penglai-status-${revoked ? "warn" : healthy ? "good" : loaded ? "warn" : "muted"}`,
                    children: statusCopy,
                  }),
                ],
              }),
              hint ? jsx.jsx("p", { children: hint }) : null,
              jsx.jsx("nav", {
                "data-penglai-plugin-links": "1",
                children: [
                  ["repository", t.linkRepo],
                  ["homepage", t.linkHome],
                  ["documentation", t.linkDocs],
                  ["issues", t.linkIssues],
                ]
                  .map(([key, label]) => {
                    const href = (entry.links && entry.links[key]) || PRODUCT_LINKS[key];
                    if (!href) return null;
                    return jsx.jsx(
                      "button",
                      {
                        type: "button",
                        "data-penglai-plugin-link": key,
                        onClick: () => {
                          const open = window.penglai && window.penglai.openPluginLink;
                          if (typeof open === "function") Promise.resolve(open(href)).catch(() => undefined);
                        },
                        children: label,
                      },
                      key,
                    );
                  })
                  .filter(Boolean),
              }),
              jsx.jsxs("p", {
                className: "penglai-plugin-permissions",
                children: [
                  t.centerPermissions,
                  ": ",
                  Array.isArray(entry.permissions) && entry.permissions.length > 0
                    ? t.centerLocalPermissions
                    : t.centerNoPermissions,
                ],
              }),
              entry.error
                ? jsx.jsxs("p", {
                    role: "alert",
                    children: [t.centerErrorLabel, ": ", String(entry.error)],
                  })
                : null,
              mutate
                ? jsx.jsxs("div", {
                    className: "penglai-card-actions",
                    children: [
                      notInstalled
                        ? jsx.jsx("button", {
                            type: "button",
                            "data-penglai-plugin-action": "installEnable",
                            disabled: actionState.busy || revoked || incompatible,
                            onClick: () => act(id, "installEnable"),
                            children: t.centerInstallEnable,
                          })
                        : loaded
                          ? jsx.jsx("button", {
                              type: "button",
                              "data-penglai-plugin-action": "disable",
                              disabled:
                                actionState.busy ||
                                id === "@penglai/plugin-center",
                              onClick: () => act(id, "disable"),
                              children: t.centerDisable,
                            })
                          : jsx.jsx("button", {
                              type: "button",
                              "data-penglai-plugin-action": "enable",
                              disabled:
                                actionState.busy ||
                                revoked ||
                                incompatible ||
                                id === "@penglai/plugin-center",
                              onClick: () => act(id, "enable"),
                              children: t.centerEnable,
                            }),
                      jsx.jsxs("details", {
                        "data-penglai-plugin-advanced": "1",
                        children: [
                          jsx.jsx("summary", { children: t.centerAdvanced ?? "Advanced" }),
                          jsx.jsxs("dl", {
                            "data-penglai-plugin-diagnostics": "1",
                            children: [
                              jsx.jsxs("div", {
                                children: [
                                  jsx.jsx("dt", { children: t.centerSource }),
                                  jsx.jsx("dd", { children: String(entry.source ?? "bundled-first-party") }),
                                ],
                              }),
                              jsx.jsxs("div", {
                                children: [
                                  jsx.jsx("dt", { children: "id" }),
                                  jsx.jsx("dd", { children: id }),
                                ],
                              }),
                              jsx.jsxs("div", {
                                children: [
                                  jsx.jsx("dt", { children: t.centerVersion }),
                                  jsx.jsx("dd", { children: String(entry.version ?? installed) }),
                                ],
                              }),
                              jsx.jsxs("div", {
                                children: [
                                  jsx.jsx("dt", { children: t.centerDsh }),
                                  jsx.jsx("dd", {
                                    children: String(entry.dshExact ?? entry.dsh?.exact ?? "0.1.1-rc.2"),
                                  }),
                                ],
                              }),
                              jsx.jsxs("div", {
                                children: [
                                  jsx.jsx("dt", { children: t.centerPermissions }),
                                  jsx.jsx("dd", {
                                    children: Array.isArray(entry.permissions)
                                      ? entry.permissions.join(", ") || t.centerNoPermissions
                                      : t.centerNoPermissions,
                                  }),
                                ],
                              }),
                              jsx.jsxs("div", {
                                children: [
                                  jsx.jsx("dt", { children: t.centerSignature }),
                                  jsx.jsx("dd", {
                                    children: entry.signature
                                      ? `${entry.signature.keyId ?? ""} ${entry.signature.ok ? t.centerSignatureOk : t.centerSignatureBad}`
                                      : t.centerSignatureBundled,
                                  }),
                                ],
                              }),
                              jsx.jsxs("div", {
                                children: [
                                  jsx.jsx("dt", { children: t.centerUpdated }),
                                  jsx.jsx("dd", { children: String(entry.updatedAt ?? entry.issuedAt ?? "—") }),
                                ],
                              }),
                              jsx.jsxs("div", {
                                children: [
                                  jsx.jsx("dt", { children: t.centerActual }),
                                  jsx.jsx("dd", { children: String(loaded) }),
                                ],
                              }),
                              jsx.jsxs("div", {
                                children: [
                                  jsx.jsx("dt", { children: t.centerDesired }),
                                  jsx.jsx("dd", { children: desired }),
                                ],
                              }),
                              jsx.jsxs("div", {
                                children: [
                                  jsx.jsx("dt", { children: t.centerInstalled }),
                                  jsx.jsx("dd", { children: installed }),
                                ],
                              }),
                              jsx.jsxs("div", {
                                children: [
                                  jsx.jsx("dt", { children: t.centerHealthy }),
                                  jsx.jsx("dd", { children: String(healthy) }),
                                ],
                              }),
                            ],
                          }),
                          jsx.jsx("button", {
                            type: "button",
                            "data-penglai-plugin-action": "download",
                            disabled: actionState.busy || revoked || incompatible,
                            onClick: () => act(id, "download"),
                            children: t.centerDownload,
                          }),
                          jsx.jsx("button", {
                            type: "button",
                            "data-penglai-plugin-action": "installDisabled",
                            disabled: actionState.busy || revoked || incompatible,
                            onClick: () => act(id, "installDisabled"),
                            children: t.centerInstallDisabled,
                          }),
                          jsx.jsx("button", {
                            type: "button",
                            "data-penglai-plugin-action": "update",
                            disabled:
                              actionState.busy ||
                              notInstalled ||
                              revoked ||
                              incompatible,
                            onClick: () => act(id, "update"),
                            children: t.centerVerifyUpdate,
                          }),
                          jsx.jsx("button", {
                            type: "button",
                            "data-penglai-plugin-action": "rollback",
                            disabled: actionState.busy,
                            onClick: () => act(id, "rollback"),
                            children: t.centerRollback,
                          }),
                        ],
                      }),
                    ],
                  })
                : null,
              actionState.busy || actionState.message
                ? jsx.jsx("p", {
                    "data-penglai-plugin-action-status": actionState.kind,
                    "data-penglai-plugin-action-busy": String(
                      actionState.busy,
                    ),
                    role: actionState.kind === "error" ? "alert" : "status",
                    children: actionState.busy
                      ? t.centerActionWorking
                      : actionState.message,
                  })
                : null,
            ],
          },
          id,
        );
      });
      return jsx.jsxs("section", {
        "data-penglai-center": "1",
        "data-penglai-center-status": state.degraded ? "error" : "ready",
        "data-penglai-registry-source": String(state.registry?.source ?? "bundled-first-party"),
        role: "region",
        "aria-label": t.centerTitle,
        children: [
          jsx.jsx("h3", { children: t.centerTitle }),
          jsx.jsx("p", { children: t.centerHint }),
          state.registry
            ? jsx.jsx("p", {
                "data-penglai-registry-sequence": String(state.registry.sequence ?? ""),
                children: `${t.centerRegistry}: ${state.registry.source} ${state.registry.tag ?? ""} ${state.registry.offline ? t.centerOffline : ""}`.trim(),
              })
            : null,
          mutate
            ? jsx.jsx("button", {
                type: "button",
                "data-penglai-plugin-action": "refreshRegistry",
                onClick: () => act("", "refreshRegistry"),
                children: t.centerRefresh,
              })
            : null,
          state.degraded
            ? jsx.jsx("p", { role: "status", children: t.centerError })
            : null,
          jsx.jsx("ul", {
            className: "penglai-capability-grid",
            "aria-live": "polite",
            children: cards,
          }),
        ],
      });
    }

    const COPY = {
      zh: {
        penglaiSettingsTitle: "蓬莱",
        penglaiSettingsEyebrow: "蓬莱功能中心",
        penglaiSettingsHint:
          "办公和记忆功能可以直接使用；消息连接、语音识别、语音生成和主动陪伴可按需开启。",
        groupOverview: "概览",
        groupConnections: "连接",
        groupVoice: "语音",
        groupKnowledge: "知识与记忆",
        groupGuardrails: "控制与陪伴",
        groupSystem: "系统",
        updateTitle: "软件更新",
        updateHint:
          "蓬莱不会在后台自动安装更新。发现新版本后，你可以先下载并校验，再由系统安装程序完成更新。",
        updateCheck: "检查更新",
        updateDownload: "下载并校验",
        updateCancel: "取消",
        updateInstall: "打开系统安装器",
        updateConfirm:
          "我确认退出蓬莱并由系统安装器继续；现有数据将先做不含凭证明文的版本化备份。",
        updateState: "当前状态",
        updateVersion: "版本",
        updateSize: "安装包大小",
        updateNotes: "更新说明",
        updateNotesOpen: "查看更新说明",
        updateVerification: "安全检查",
        updateVerificationReady: "安装包会在打开前自动校验",
        updateSystemConfirm: "安装前还需要你在系统窗口中确认",
        updateError: "更新操作失败",
        updateStates: {
          IDLE: "尚未检查",
          CHECKING: "正在检查…",
          CURRENT: "已是最新版本",
          AVAILABLE: "发现新版本",
          DOWNLOADING: "正在下载并校验…",
          READY_FOR_USER: "可以安装",
          FAILED: "更新失败，请重试",
          ROLLED_BACK: "已恢复到更新前版本",
          COMMITTED: "更新已完成",
          UNKNOWN: "等待操作",
        },
        uninstallTitle: "存储与卸载",
        uninstallHint:
          "卸载应用时默认保留你的数据。如果需要完整删除，请按类别选择；账号凭据需要再次确认。工作文件夹和旧版数据不会被删除。",
        storageRefresh: "重新扫描",
        storageLoading: "正在核对本机数据…",
        storageBytes: "字节",
        storageEntries: "项",
        storageTargets: "精确路径",
        storageUnavailable: "不可安全删除",
        neverDeleteTitle: "受保护且永不删除",
        workspaceProtected: "已授权的工作文件夹",
        legacyProtected: "旧版蓬莱 0.4.1 数据（只读保护）",
        credentialsConfirm: "单独确认删除本地账号凭据；该操作不可恢复。",
        sensitiveConfirm:
          "单独确认删除本地声音参考或长期记忆；该操作不可恢复。",
        completePhrase: "选择全部类别时请输入精确确认词：DELETE PENGLAI DATA",
        prepareDelete: "停止服务并生成精确删除预览",
        previewTitle: "删除前预览",
        previewExpires: "到期时间",
        executeConfirm:
          "我已核对每一条路径、类型、文件数与大小，并确认立即删除所选类别。",
        executeDelete: "执行删除并退出蓬莱",
        cancelDelete: "取消删除并恢复服务",
        exportPreview: "预览可导出诊断",
        exportRedacted: "导出预览已脱敏，不包含凭证、聊天正文或二维码。",
        uninstallGuide: "应用卸载说明",
        appWillQuit:
          "删除成功后蓬莱会退出；macOS 请再将 Penglai.app 移到废纸篓。",
        deleteError: "删除操作失败并已停止，不会扩大路径或提升权限重试。",
        categoryLabels: {
          cache: "运行时缓存与日志",
          settings: "设置与首次引导",
          dsh: "对话与任务记录",
          im: "消息平台绑定和待发送消息",
          credentials: "本地账号凭据",
          "asr-models": "语音识别模型",
          "tts-models": "语音生成模型",
          "local-voices": "本地声音参考",
          "voice-temp": "语音临时数据",
          "context-indexes": "授权资料与派生索引",
          memory: "蓬莱记忆、技能与授权资料",
          budget: "用量和预算设置",
          companion: "主动陪伴设置与记录",
        },
        centerTitle: "蓬莱插件中心",
        centerHint:
          "内置的办公和记忆功能默认开启，其他功能可按需安装或开启。蓬莱会校验在线插件的来源和完整性。",
        centerRefresh: "刷新已签名目录",
        centerRegistry: "目录来源",
        centerOffline: "离线使用上次已验证目录",
        centerSource: "来源",
        centerVersion: "版本",
        centerDsh: "兼容性",
        centerPermissions: "权限",
        linkRepo: "源代码",
        linkHome: "官网",
        linkDocs: "使用文档",
        linkIssues: "反馈问题",
        centerNoPermissions: "无额外权限",
        centerLocalPermissions: "使用本机所需功能（详情见高级/诊断）",
        centerSignature: "签名",
        centerSignatureOk: "已验证",
        centerSignatureBad: "失败",
        centerSignatureBundled: "内置",
        centerUpdated: "更新时间",
        centerDownload: "下载",
        centerAdvanced: "高级/诊断",
        centerInstallDisabled: "安装（停用）",
        centerStatusRevoked: "已撤销",
        centerStatusIncompatible: "不兼容当前版本或平台",
        centerActionDownloaded: "下载成功。",
        centerActionInstalled: "已安装为停用。",
        centerActionRefreshed: "目录已刷新。",
        centerLoading: "正在读取插件列表…",
        centerError: "插件列表暂时不可用。",
        cardCenter: "蓬莱插件中心",
        cardCenterHint: "管理本机已签入插件的实际状态。",
        cardIm: "消息连接",
        cardImHint: "在一个入口中管理九个消息平台的私聊连接。",
        cardAsr: "蓬莱语音识别",
        cardAsrHint: "本地 SenseVoice。到「蓬莱语音识别」页下载模型并试转写。",
        cardTts: "蓬莱语音生成",
        cardTtsHint: "本地 MOSS-TTS。到「蓬莱语音合成」页下载模型并试听。",
        cardMemory: "蓬莱记忆",
        cardMemoryHint: "本机分层记忆、项目隔离、授权资料、来源追溯与可视化；写入和遗忘需要可见确认。",
        cardOffice: "蓬莱办公",
        cardOfficeHint: "读取、创建和编辑 DOCX、XLSX、PPTX 与 PDF。",
        cardBudget: "用量预算",
        cardBudgetHint: "到达硬上限会阻止新的对话。",
        cardCompanion: "蓬莱主动陪伴",
        cardCompanionHint: "默认关闭，只走已绑定的消息渠道。",
        centerActual: "当前状态",
        centerDesired: "你的选择",
        centerInstalled: "是否安装",
        centerHealthy: "运行状态",
        centerErrorLabel: "错误",
        centerEnable: "启用",
        centerInstallEnable: "安装并启用",
        centerDisable: "停用",
        centerVerifyUpdate: "校验并更新",
        centerRollback: "回滚",
        centerStatusHealthy: "运行正常",
        centerStatusAttention: "需要关注",
        centerStatusInactive: "未启用",
        centerStatusNotInstalled: "未安装",
        centerActionWorking: "正在执行并核对插件状态…",
        centerActionEnabled: "启用成功。",
        centerActionInstalledEnabled: "安装并启用成功。",
        centerActionDisabled: "停用成功。",
        centerActionUpdated: "校验并更新成功。",
        centerActionRolledBack: "回滚成功。",
        centerActionDone: "操作成功。",
        centerActionReloading: "正在应用内重新载入配置页面；随后可从左侧进入对应插件。",
        centerActionFailed: "操作失败",
      },
      en: {
        penglaiSettingsTitle: "Penglai",
        penglaiSettingsEyebrow: "Penglai feature center",
        penglaiSettingsHint:
          "Office and Memory are ready to use. Messaging, speech recognition, voice generation, and Companion can be turned on when you need them.",
        groupOverview: "Overview",
        groupConnections: "Connections",
        groupVoice: "Voice",
        groupKnowledge: "Knowledge and memory",
        groupGuardrails: "Controls and companion",
        groupSystem: "System",
        updateTitle: "Software updates",
        updateHint:
          "Penglai never installs updates in the background. When a new version is available, you can download and verify it before continuing in the system installer.",
        updateCheck: "Check for updates",
        updateDownload: "Download and verify",
        updateCancel: "Cancel",
        updateInstall: "Open system installer",
        updateConfirm:
          "I confirm Penglai will quit and the system installer will continue. Versioned state is backed up first without copying plaintext credentials.",
        updateState: "Current status",
        updateVersion: "Version",
        updateSize: "Download size",
        updateNotes: "What's new",
        updateNotesOpen: "View what's new",
        updateVerification: "Safety check",
        updateVerificationReady: "The installer is verified before it opens",
        updateSystemConfirm: "You will confirm once more in the system installer",
        updateError: "Update operation failed",
        updateStates: {
          IDLE: "Not checked yet",
          CHECKING: "Checking…",
          CURRENT: "You're up to date",
          AVAILABLE: "New version available",
          DOWNLOADING: "Downloading and verifying…",
          READY_FOR_USER: "Ready to install",
          FAILED: "Update failed. Please try again",
          ROLLED_BACK: "Restored the previous version",
          COMMITTED: "Update complete",
          UNKNOWN: "Waiting",
        },
        uninstallTitle: "Storage and uninstall",
        uninstallHint:
          "Uninstalling the app keeps your data by default. For a complete deletion, choose each category; account credentials require another confirmation. Work folders and older-version data are never deleted.",
        storageRefresh: "Scan again",
        storageLoading: "Inspecting local data…",
        storageBytes: "bytes",
        storageEntries: "entries",
        storageTargets: "Exact paths",
        storageUnavailable: "Cannot be deleted safely",
        neverDeleteTitle: "Protected and never deleted",
        workspaceProtected: "Authorized work folders",
        legacyProtected: "Older Penglai 0.4.1 data (read-only protection)",
        credentialsConfirm:
          "Separately confirm deletion of local account credentials. This cannot be undone.",
        sensitiveConfirm:
          "Separately confirm deletion of local voice references or long-term memory. This cannot be undone.",
        completePhrase:
          "When every category is selected, enter the exact phrase: DELETE PENGLAI DATA",
        prepareDelete: "Stop services and prepare exact deletion preview",
        previewTitle: "Review before deleting",
        previewExpires: "Expires",
        executeConfirm:
          "I checked every path, type, entry count, and size and confirm immediate deletion of the selected categories.",
        executeDelete: "Delete and quit Penglai",
        cancelDelete: "Cancel deletion and restore services",
        exportPreview: "Preview diagnostic export",
        exportRedacted:
          "The export preview is redacted and excludes credentials, chat bodies, and QR data.",
        uninstallGuide: "Application uninstall guide",
        appWillQuit:
          "Penglai quits after deletion. On macOS, then move Penglai.app to Trash.",
        deleteError:
          "Deletion stopped on failure. Penglai will not widen paths or retry with elevated permissions.",
        categoryLabels: {
          cache: "Runtime cache and logs",
          settings: "Settings and onboarding",
          dsh: "Conversations and task history",
          im: "Messaging connections and pending messages",
          credentials: "Local account credentials",
          "asr-models": "Speech recognition models",
          "tts-models": "Voice generation models",
          "local-voices": "Local voice references",
          "voice-temp": "Voice temporary data",
          "context-indexes": "Authorized sources and derived indexes",
          memory: "Penglai Memory, skills, and authorized sources",
          budget: "Usage and budget settings",
          companion: "Companion settings and history",
        },
        centerTitle: "Penglai Plugin Center",
        centerHint:
          "Built-in Office and Memory features are on by default. Other features can be installed or enabled when you need them. Penglai verifies the source and integrity of online plugins.",
        centerRefresh: "Refresh signed catalog",
        centerRegistry: "Catalog source",
        centerOffline: "offline last-good catalog",
        centerSource: "source",
        centerVersion: "version",
        centerDsh: "Compatibility",
        centerPermissions: "permissions",
        linkRepo: "Source",
        linkHome: "Website",
        linkDocs: "Docs",
        linkIssues: "Issues",
        centerNoPermissions: "no extra permissions",
        centerLocalPermissions: "uses required on-device features (see Advanced / diagnostics)",
        centerSignature: "signature",
        centerSignatureOk: "verified",
        centerSignatureBad: "failed",
        centerSignatureBundled: "bundled",
        centerUpdated: "updated",
        centerDownload: "Download",
        centerAdvanced: "Advanced / diagnostics",
        centerInstallDisabled: "Install disabled",
        centerStatusRevoked: "Revoked",
        centerStatusIncompatible: "Incompatible version or platform",
        centerActionDownloaded: "Downloaded.",
        centerActionInstalled: "Installed disabled.",
        centerActionRefreshed: "Catalog refreshed.",
        centerLoading: "Loading the plugin list…",
        centerError: "The plugin list is temporarily unavailable.",
        cardCenter: "Penglai Plugin Center",
        cardCenterHint: "Manage actual state of signed local plugins.",
        cardIm: "Messaging",
        cardImHint: "Manage private-chat connections for nine messaging platforms in one place.",
        cardAsr: "Penglai Speech Recognition",
        cardAsrHint:
          "Local SenseVoice. Open Penglai Speech Recognition to download the model and test transcription.",
        cardTts: "Penglai Voice Generation",
        cardTtsHint:
          "Local MOSS-TTS. Open Penglai Speech Synthesis to download the model and preview a voice.",
        cardMemory: "Penglai Memory",
        cardMemoryHint:
          "Local layered memory with project isolation, authorized sources, provenance, and visualization. Remember and forget require visible confirmation.",
        cardOffice: "Penglai Office",
        cardOfficeHint: "Inspect, create, and edit DOCX, XLSX, PPTX, and PDF.",
        cardBudget: "Usage budget",
        cardBudgetHint: "A hard limit blocks new conversations.",
        cardCompanion: "Penglai Companion",
        cardCompanionHint:
          "Off by default. Sends only through bound IM routes.",
        centerActual: "Current status",
        centerDesired: "Your choice",
        centerInstalled: "Installed",
        centerHealthy: "Running",
        centerErrorLabel: "error",
        centerEnable: "Enable",
        centerInstallEnable: "Install and enable",
        centerDisable: "Disable",
        centerVerifyUpdate: "Verify and update",
        centerRollback: "Rollback",
        centerStatusHealthy: "Healthy",
        centerStatusAttention: "Needs attention",
        centerStatusInactive: "Inactive",
        centerStatusNotInstalled: "Not installed",
        centerActionWorking: "Applying the change and checking plugin status…",
        centerActionEnabled: "Enabled.",
        centerActionInstalledEnabled: "Installed and enabled.",
        centerActionDisabled: "Disabled.",
        centerActionUpdated: "Verified and updated.",
        centerActionRolledBack: "Rolled back.",
        centerActionDone: "Completed.",
        centerActionReloading: "Reloading the in-app settings surface; open the plugin from the left navigation next.",
        centerActionFailed: "Action failed",
      },
    };

    function localeCopy() {
      const id = String(document.documentElement.lang ?? "zh");
      return COPY[id.startsWith("en") ? "en" : "zh"];
    }

    const PENGLAI_SETTINGS_CSS = `
      .penglai-settings-page{container-type:inline-size;display:flex;min-width:0;max-width:760px;color:var(--dsw-alias-label-primary);flex-direction:column;gap:14px}
      .penglai-settings-root{min-height:520px}
      .penglai-settings-intro{display:flex;align-items:center;gap:12px;padding:2px 2px 14px;border-bottom:1px solid var(--dsw-alias-border-l2)}
      .penglai-settings-intro-copy{min-width:0}.penglai-settings-eyebrow{margin:0 0 2px;color:var(--dsw-alias-state-business-primary);font-size:10px;font-weight:700;letter-spacing:.12em}
      .penglai-settings-intro h2{margin:0;font-size:20px;line-height:28px}.penglai-settings-intro p:last-child{margin:3px 0 0;color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px}
      .penglai-settings-page>section{display:flex;flex-direction:column;gap:12px}.penglai-settings-page h3{margin:0;font-size:18px;line-height:26px}.penglai-settings-page h4{margin:12px 0 0;font-size:14px}.penglai-settings-page p{margin:0;color:var(--dsw-alias-label-secondary);font-size:12px;line-height:19px}
      .penglai-settings-page label{display:flex;align-items:center;gap:8px;color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px}.penglai-settings-page fieldset{border:1px solid var(--dsw-alias-border-l2);border-radius:12px;padding:12px}.penglai-settings-page legend{padding:0 5px;font-size:12px}
      .penglai-settings-page input:not([type=checkbox]):not([type=radio]),.penglai-settings-page select,.penglai-settings-page textarea{box-sizing:border-box;min-height:34px;max-width:100%;padding:7px 10px;border:1px solid var(--dsw-alias-border-l2);border-radius:9px;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font:inherit}.penglai-settings-page textarea{width:100%;min-height:92px;resize:vertical}
      .penglai-settings-page button,.penglai-card-actions button{min-height:32px;padding:6px 11px;border:1px solid var(--dsw-alias-border-l2);border-radius:9px;background:var(--dsw-alias-bg-module-platform);color:var(--dsw-alias-label-primary);font:inherit;font-size:12px;cursor:pointer}.penglai-settings-page button:hover:not(:disabled),.penglai-card-actions button:hover:not(:disabled){border-color:var(--dsw-alias-state-business-primary);color:var(--dsw-alias-state-business-primary)}.penglai-settings-page button:disabled{opacity:.45;cursor:default}
      .penglai-settings-page dl{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;margin:0}.penglai-settings-page dl>div{padding:9px 10px;border-radius:10px;background:var(--dsw-alias-bg-module-platform)}.penglai-settings-page dt{color:var(--dsw-alias-label-caption);font-size:10px}.penglai-settings-page dd{margin:3px 0 0;font-size:12px;overflow-wrap:anywhere}
      .penglai-capability-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;margin:0;padding:0;list-style:none}.penglai-capability-card{display:flex;flex-direction:column;gap:9px;padding:14px;border:1px solid var(--dsw-alias-border-l2);border-radius:14px;background:var(--dsw-alias-bg-base)}
      .penglai-capability-card header{display:grid;grid-template-columns:34px minmax(0,1fr) auto;gap:9px;align-items:center}.penglai-capability-icon{display:grid;place-items:center;width:34px;height:34px;border-radius:10px;background:color-mix(in srgb,var(--dsw-alias-state-business-primary) 11%,transparent);color:var(--dsw-alias-state-business-primary)}.penglai-capability-heading{display:flex;flex-direction:column;min-width:0}.penglai-capability-heading strong{font-size:13px}.penglai-capability-heading code{margin-top:1px;color:var(--dsw-alias-label-caption);font-size:9px;overflow:hidden;text-overflow:ellipsis}
      .penglai-status{padding:3px 6px;border-radius:999px;font-size:9px;white-space:nowrap}.penglai-status-good{background:color-mix(in srgb,#22c55e 14%,transparent);color:#16803c}.penglai-status-warn{background:color-mix(in srgb,#f59e0b 14%,transparent);color:#a35d00}.penglai-status-muted{background:var(--dsw-alias-bg-module-platform);color:var(--dsw-alias-label-caption)}.penglai-card-actions{display:flex;flex-wrap:wrap;gap:6px;margin-top:auto}.penglai-card-actions button{min-height:28px;padding:4px 8px;font-size:10px}
      [data-penglai-plugin-action-status=working]{color:var(--dsw-alias-state-business-primary)}[data-penglai-plugin-action-status=success]{color:var(--dsw-alias-state-success-primary)}[data-penglai-plugin-action-status=error]{color:var(--dsw-alias-state-error-primary)}
      .penglai-brand-mark{position:relative;display:inline-grid;place-items:center;flex:none;overflow:hidden;border-radius:22%;background:linear-gradient(145deg,#183329,#0c1512 58%,#b79245);box-shadow:inset 0 0 0 1px color-mix(in srgb,#d7b865 55%,transparent),0 3px 12px #0002;color:#f0d991;font-family:ui-rounded,system-ui,sans-serif;font-weight:800}.penglai-brand-mark img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}.penglai-brand-fallback{font-size:.48em;line-height:1}.penglai-brand-mark[data-image-ready=true] .penglai-brand-fallback{visibility:hidden}
      @container(max-width:560px){.penglai-capability-grid{grid-template-columns:1fr}.penglai-capability-card header{grid-template-columns:34px minmax(0,1fr) auto}}
      @media(max-width:720px){.penglai-capability-grid{grid-template-columns:1fr}}
      @media(prefers-reduced-motion:no-preference){.penglai-settings-page{animation:penglai-panel-in .16s ease-out}@keyframes penglai-panel-in{from{opacity:.6;transform:translateY(3px)}to{opacity:1;transform:none}}}
    `;

    function installPenglaiStyles(ctx) {
      ctx.effect(() => {
        if (typeof document === "undefined") return () => undefined;
        const tag = document.createElement("style");
        tag.setAttribute("data-penglai-settings-style", "1");
        tag.textContent = PENGLAI_SETTINGS_CSS;
        document.head.appendChild(tag);
        return () => tag.remove();
      }, "penglai settings visual system");
    }

    function PenglaiOverviewSection(props) {
      const t = localeCopy();
      return jsx.jsxs("div", {
        className: "penglai-settings-page penglai-settings-root",
        "data-penglai-settings": "overview",
        children: [
          jsx.jsxs("header", {
            className: "penglai-settings-intro",
            children: [
              jsx.jsx(PenglaiBrandMark, { size: 44 }),
              jsx.jsxs("div", {
                className: "penglai-settings-intro-copy",
                children: [
                  jsx.jsx("p", {
                    className: "penglai-settings-eyebrow",
                    children: t.penglaiSettingsEyebrow,
                  }),
                  jsx.jsx("h2", { children: t.penglaiSettingsTitle }),
                  jsx.jsx("p", { children: t.penglaiSettingsHint }),
                ],
              }),
            ],
          }),
          jsx.jsx(CenterTab, props),
        ],
      });
    }

    function desktopCall(method, input) {
      const api = typeof window !== "undefined" ? window.penglai : undefined;
      if (!api || typeof api[method] !== "function") {
        return Promise.reject(
          new Error("Penglai desktop lifecycle API unavailable"),
        );
      }
      return Promise.resolve(
        input === undefined ? api[method]() : api[method](input),
      );
    }

    function formatBytes(value) {
      const bytes = Number(value || 0);
      if (!Number.isFinite(bytes) || bytes < 0) return "—";
      if (bytes < 1024) return `${bytes} B`;
      const units = ["KiB", "MiB", "GiB", "TiB"];
      let scaled = bytes;
      let index = -1;
      do {
        scaled /= 1024;
        index += 1;
      } while (scaled >= 1024 && index < units.length - 1);
      return `${scaled.toFixed(scaled >= 10 ? 1 : 2)} ${units[index]}`;
    }

    function errorText(error) {
      return String(error && error.message ? error.message : error);
    }

    function PenglaiBrandMark(props = {}) {
      const size = Number.isFinite(Number(props.size))
        ? Number(props.size)
        : 24;
      const [ready, setReady] = React.useState(false);
      const [failed, setFailed] = React.useState(false);
      return jsx.jsxs("span", {
        "data-penglai-brand-mark": "1",
        "data-image-ready": ready && !failed ? "true" : "false",
        className: `penglai-brand-mark${props.className ? ` ${props.className}` : ""}`,
        role: "img",
        "aria-label": "蓬莱 Penglai",
        style: {
          width: `${size}px`,
          height: `${size}px`,
          fontSize: `${size}px`,
        },
        children: [
          jsx.jsx("span", {
            className: "penglai-brand-fallback",
            "aria-hidden": "true",
            children: "P",
          }),
          failed
            ? null
            : jsx.jsx("img", {
                src:
                  size > 64
                    ? "/penglai-brand/logo-256.png"
                    : "/penglai-brand/logo-64.png",
                alt: "",
                width: size,
                height: size,
                onLoad: () => setReady(true),
                onError: () => setFailed(true),
              }),
        ],
      });
    }

    function PenglaiBrandName() {
      return jsx.jsx("span", {
        "data-penglai-brand-name": "1",
        children: "蓬莱 Penglai",
      });
    }

    function applyView(ctx) {
      installPenglaiStyles(ctx);
      const unwrapRemote = (result) => {
        if (result && typeof result === "object" && "ok" in result) {
          if (result.ok === false)
            throw new Error((result.error && result.error.message) || "remote");
          return result.value;
        }
        return result;
      };
      const fallbackCatalog = () =>
        FIRST_PARTY_CARDS.map((card) => ({
          id: card.id,
          loaded: false,
          desired: "enabled",
          installed: "unknown",
          healthy: false,
        }));
      const centerInjected = () => {
        const centerRemote = ctx.remote.penglaiCenter;
        const inventoryRemote = ctx.remote.pluginInventory;
        const list = async () => {
          if (centerRemote?.list) {
            try {
              const snapshot = unwrapRemote(await centerRemote.list());
              if (
                snapshot &&
                (Array.isArray(snapshot.catalog) || snapshot.inventory)
              )
                return snapshot;
            } catch {
              /* keep fallback */
            }
          }
          if (inventoryRemote?.list) {
            try {
              return {
                inventory: unwrapRemote(await inventoryRemote.list()),
                catalog: fallbackCatalog(),
              };
            } catch {
              /* keep fallback */
            }
          }
          return {
            inventory: [],
            catalog: fallbackCatalog(),
            degraded: true,
          };
        };
        const mutate = async (id, action) => {
          if (!centerRemote) throw new Error("penglaiCenter remote missing");
          if (
            action === "enable" ||
            action === "update" ||
            action === "installDisabled" ||
            action === "installEnable" ||
            action === "disable" ||
            action === "rollback"
          ) {
            const api = window.penglai;
            if (!api || typeof api.confirmPluginAction !== "function") {
              throw new Error("native owner capability is required");
            }
            const cap = await api.confirmPluginAction({ id, action });
            if (!cap || typeof cap.actionId !== "string" || typeof cap.receipt !== "string") {
              throw new Error("native owner capability is required");
            }
            const proof = { id, actionId: cap.actionId, receipt: cap.receipt };
            if (action === "enable")
              return unwrapRemote(await centerRemote.enable(proof));
            if (action === "installEnable") {
              if (typeof centerRemote.installEnable !== "function") {
                throw new Error("installEnable remote missing");
              }
              return unwrapRemote(
                await centerRemote.installEnable(proof),
              );
            }
            if (action === "update") {
              const result = unwrapRemote(
                await centerRemote.update(proof),
              );
              if (result?.restartRequired === true) {
                if (typeof api.restartPluginRuntime !== "function") {
                  throw new Error("native plugin runtime restart is required");
                }
                await api.restartPluginRuntime({ id });
              }
              return result;
            }
            if (action === "disable")
              return unwrapRemote(await centerRemote.disable(proof));
            if (action === "rollback")
              return unwrapRemote(
                await centerRemote.rollback(proof),
              );
            return unwrapRemote(
              await centerRemote.installDisabled(proof),
            );
          }
          if (action === "download")
            return unwrapRemote(await centerRemote.download({ id }));
          if (action === "refreshRegistry")
            return unwrapRemote(await centerRemote.refreshRegistry());
          throw new Error("unknown action");
        };
        return { list, mutate };
      };
      function UpdateSection() {
        const t = localeCopy();
        const [view, setView] = React.useState({
          value: null,
          busy: false,
          error: "",
          confirmed: false,
        });
        const refresh = React.useCallback(() => {
          desktopCall("getUpdateStatus")
            .then((value) =>
              setView((current) => ({ ...current, value, error: "" })),
            )
            .catch((error) =>
              setView((current) => ({
                ...current,
                error: errorText(error),
              })),
            );
        }, []);
        React.useEffect(() => {
          refresh();
        }, [refresh]);
        const run = (method, input) => {
          setView((current) => ({ ...current, busy: true, error: "" }));
          desktopCall(method, input)
            .then((value) =>
              setView((current) => ({
                ...current,
                value,
                busy: false,
                error: "",
              })),
            )
            .catch((error) =>
              setView((current) => ({
                ...current,
                busy: false,
                error: errorText(error),
              })),
            );
        };
        const value = view.value || {};
        const state = String(value.state || "IDLE");
        const stateLabel = t.updateStates[state] || t.updateStates.UNKNOWN;
        const checking = state === "CHECKING" || state === "DOWNLOADING";
        const canCheck = [
          "IDLE",
          "CURRENT",
          "FAILED",
          "ROLLED_BACK",
          "COMMITTED",
        ].includes(state);
        const canDownload = state === "AVAILABLE";
        const canInstall = state === "READY_FOR_USER";
        return jsx.jsxs("section", {
          "data-penglai-update": "1",
          "data-penglai-update-state": state,
          "data-penglai-update-channel": "desktop-v0.5",
          role: "region",
          "aria-label": t.updateTitle,
          children: [
            jsx.jsx("h3", { children: t.updateTitle }),
            jsx.jsx("p", { children: t.updateHint }),
            jsx.jsxs("dl", {
              children: [
                jsx.jsxs(
                  "div",
                  {
                    children: [
                      jsx.jsx("dt", { children: t.updateState }),
                      jsx.jsx("dd", { children: stateLabel }),
                    ],
                  },
                  "state",
                ),
                value.version
                  ? jsx.jsxs(
                      "div",
                      {
                        children: [
                          jsx.jsx("dt", { children: t.updateVersion }),
                          jsx.jsx("dd", {
                            children: String(value.version),
                          }),
                        ],
                      },
                      "version",
                    )
                  : null,
                Number.isFinite(value.size)
                  ? jsx.jsxs(
                      "div",
                      {
                        children: [
                          jsx.jsx("dt", { children: t.updateSize }),
                          jsx.jsx("dd", {
                            children: formatBytes(value.size),
                          }),
                        ],
                      },
                      "size",
                    )
                  : null,
                value.notesUrl
                  ? jsx.jsxs(
                      "div",
                      {
                        children: [
                          jsx.jsx("dt", { children: t.updateNotes }),
                          jsx.jsx("dd", {
                            children: jsx.jsx("a", {
                              href: String(value.notesUrl),
                              target: "_blank",
                              rel: "noreferrer",
                              children: t.updateNotesOpen,
                            }),
                          }),
                        ],
                      },
                      "notes",
                    )
                  : null,
                jsx.jsxs(
                  "div",
                  {
                    children: [
                      jsx.jsx("dt", { children: t.updateVerification }),
                      jsx.jsx("dd", { children: t.updateVerificationReady }),
                    ],
                  },
                  "trust",
                ),
              ],
            }),
            value.requiresSystemInstallerConfirmation
              ? jsx.jsx("p", { children: t.updateSystemConfirm })
              : null,
            view.error
              ? jsx.jsxs("p", {
                  role: "alert",
                  "data-penglai-update-error": "1",
                  children: [t.updateError, ": ", view.error],
                })
              : null,
            jsx.jsxs("div", {
              children: [
                canCheck
                  ? jsx.jsx(
                      "button",
                      {
                        type: "button",
                        disabled: view.busy,
                        onClick: () => run("checkForUpdate"),
                        children: t.updateCheck,
                      },
                      "check",
                    )
                  : null,
                canDownload
                  ? jsx.jsx(
                      "button",
                      {
                        type: "button",
                        disabled: view.busy,
                        onClick: () => run("downloadUpdate"),
                        children: t.updateDownload,
                      },
                      "download",
                    )
                  : null,
                checking
                  ? jsx.jsx(
                      "button",
                      {
                        type: "button",
                        onClick: () => run("cancelUpdate"),
                        children: t.updateCancel,
                      },
                      "cancel",
                    )
                  : null,
              ],
            }),
            canInstall
              ? jsx.jsxs("div", {
                  children: [
                    jsx.jsxs("label", {
                      children: [
                        jsx.jsx("input", {
                          type: "checkbox",
                          checked: view.confirmed,
                          onChange: (event) =>
                            setView((current) => ({
                              ...current,
                              confirmed: Boolean(event.target.checked),
                            })),
                        }),
                        t.updateConfirm,
                      ],
                    }),
                    jsx.jsx("button", {
                      type: "button",
                      "data-penglai-update-confirm": "1",
                      disabled: view.busy || !view.confirmed,
                      onClick: () => run("confirmUpdate", { confirmed: true }),
                      children: t.updateInstall,
                    }),
                  ],
                })
              : null,
          ],
        });
      }
      function UninstallSection() {
        const t = localeCopy();
        const [view, setView] = React.useState({
          inventory: null,
          guide: null,
          busy: false,
          error: "",
          exportReady: false,
        });
        const [selected, setSelected] = React.useState({});
        const [confirmCredentials, setConfirmCredentials] =
          React.useState(false);
        const [confirmSensitive, setConfirmSensitive] = React.useState(false);
        const [phrase, setPhrase] = React.useState("");
        const [preview, setPreview] = React.useState(null);
        const [executeConfirmed, setExecuteConfirmed] = React.useState(false);
        const refresh = React.useCallback(() => {
          setView((current) => ({ ...current, busy: true, error: "" }));
          Promise.all([
            desktopCall("getStorageInventory"),
            desktopCall("getUninstallGuide"),
          ])
            .then(([inventory, guide]) =>
              setView({
                inventory,
                guide,
                busy: false,
                error: "",
                exportReady: false,
              }),
            )
            .catch((error) =>
              setView((current) => ({
                ...current,
                busy: false,
                error: errorText(error),
              })),
            );
        }, []);
        React.useEffect(() => {
          refresh();
        }, [refresh]);
        const categories =
          view.inventory && Array.isArray(view.inventory.categories)
            ? view.inventory.categories
            : [];
        const selectedIds = categories
          .filter((row) => selected[row.category])
          .map((row) => row.category);
        const allSelected =
          categories.length > 0 &&
          categories.every((row) => selected[row.category]);
        const needsCredentials = selectedIds.includes("credentials");
        const needsSensitive =
          selectedIds.includes("local-voices") ||
          selectedIds.includes("memory");
        const canPrepare =
          selectedIds.length > 0 &&
          (!needsCredentials || confirmCredentials) &&
          (!needsSensitive || confirmSensitive) &&
          (!allSelected || phrase === "DELETE PENGLAI DATA");
        const prepare = () => {
          setView((current) => ({ ...current, busy: true, error: "" }));
          desktopCall("prepareDataDeletion", {
            categories: selectedIds,
            confirmCredentials,
            confirmSensitive,
            ...(allSelected ? { completeDeletePhrase: phrase } : {}),
          })
            .then((result) => {
              setPreview(result && result.preview ? result.preview : null);
              setView((current) => ({
                ...current,
                guide: result && result.guide ? result.guide : current.guide,
                busy: false,
                error: "",
              }));
            })
            .catch((error) =>
              setView((current) => ({
                ...current,
                busy: false,
                error: errorText(error),
              })),
            );
        };
        const cancel = () => {
          if (!preview) return;
          setView((current) => ({ ...current, busy: true, error: "" }));
          desktopCall("cancelDataDeletion", {
            operationId: preview.operationId,
          })
            .then(() => {
              setPreview(null);
              setExecuteConfirmed(false);
              setView((current) => ({
                ...current,
                busy: false,
                error: "",
              }));
            })
            .catch((error) =>
              setView((current) => ({
                ...current,
                busy: false,
                error: errorText(error),
              })),
            );
        };
        const execute = () => {
          if (!preview || !executeConfirmed) return;
          setView((current) => ({ ...current, busy: true, error: "" }));
          desktopCall("executeDataDeletion", {
            operationId: preview.operationId,
            confirmed: true,
          }).catch((error) =>
            setView((current) => ({
              ...current,
              busy: false,
              error: errorText(error),
            })),
          );
        };
        const rows = categories.map((row) =>
          jsx.jsxs(
            "li",
            {
              "data-penglai-data-category": row.category,
              children: [
                jsx.jsxs("label", {
                  children: [
                    jsx.jsx("input", {
                      type: "checkbox",
                      disabled:
                        view.busy || Boolean(preview) || row.deletable !== true,
                      checked: Boolean(selected[row.category]),
                      onChange: (event) =>
                        setSelected((current) => ({
                          ...current,
                          [row.category]: Boolean(event.target.checked),
                        })),
                    }),
                    String(t.categoryLabels[row.category] || row.category),
                  ],
                }),
                row.deletable === true
                  ? ` · ${formatBytes(row.totalBytes)} · ${Number(row.entryCount || 0)} ${t.storageEntries}`
                  : ` · ${t.storageUnavailable}: ${String(row.inspectionError || "UNKNOWN")}`,
                row.targets && row.targets.length
                  ? jsx.jsx("ul", {
                      "aria-label": t.storageTargets,
                      children: row.targets.map((target) =>
                        jsx.jsx(
                          "li",
                          {
                            children: jsx.jsx("code", {
                              children: `${target.path} · ${target.type} · ${target.entryCount} · ${formatBytes(target.totalBytes)}`,
                            }),
                          },
                          target.path,
                        ),
                      ),
                    })
                  : null,
              ],
            },
            row.category,
          ),
        );
        const protectedRows = [];
        for (const path of (view.inventory && view.inventory.workspaceRoots) ||
          []) {
          protectedRows.push(
            jsx.jsx(
              "li",
              {
                "data-penglai-never-delete": "workspace-protected",
                children: jsx.jsxs("span", {
                  children: [
                    `${t.workspaceProtected}: `,
                    jsx.jsx("code", { children: path }),
                  ],
                }),
              },
              `ws-${path}`,
            ),
          );
        }
        for (const legacy of (view.inventory && view.inventory.legacy) || []) {
          protectedRows.push(
            jsx.jsx(
              "li",
              {
                "data-penglai-never-delete": "legacy-protected",
                children: jsx.jsxs("span", {
                  children: [
                    `${t.legacyProtected}: `,
                    jsx.jsx("code", { children: legacy.path }),
                    ` · ${legacy.present ? "present" : "absent"}`,
                  ],
                }),
              },
              `legacy-${legacy.path}`,
            ),
          );
        }
        return jsx.jsxs("section", {
          "data-penglai-uninstall": "1",
          role: "region",
          "aria-label": t.uninstallTitle,
          children: [
            jsx.jsx("h3", { children: t.uninstallTitle }),
            jsx.jsx("p", { children: t.uninstallHint }),
            view.inventory
              ? jsx.jsx("ul", { children: rows })
              : jsx.jsx("p", { children: t.storageLoading }),
            jsx.jsx("h4", { children: t.neverDeleteTitle }),
            jsx.jsx("ul", { children: protectedRows }),
            !preview && needsCredentials
              ? jsx.jsxs("label", {
                  children: [
                    jsx.jsx("input", {
                      type: "checkbox",
                      checked: confirmCredentials,
                      onChange: (event) =>
                        setConfirmCredentials(Boolean(event.target.checked)),
                    }),
                    t.credentialsConfirm,
                  ],
                })
              : null,
            !preview && needsSensitive
              ? jsx.jsxs("label", {
                  children: [
                    jsx.jsx("input", {
                      type: "checkbox",
                      checked: confirmSensitive,
                      onChange: (event) =>
                        setConfirmSensitive(Boolean(event.target.checked)),
                    }),
                    t.sensitiveConfirm,
                  ],
                })
              : null,
            !preview && allSelected
              ? jsx.jsxs("label", {
                  children: [
                    t.completePhrase,
                    jsx.jsx("input", {
                      type: "text",
                      value: phrase,
                      autoComplete: "off",
                      onChange: (event) =>
                        setPhrase(String(event.target.value)),
                    }),
                  ],
                })
              : null,
            view.error
              ? jsx.jsxs("p", {
                  role: "alert",
                  "data-penglai-uninstall-error": "1",
                  children: [t.deleteError, " ", view.error],
                })
              : null,
            !preview
              ? jsx.jsxs("div", {
                  children: [
                    jsx.jsx("button", {
                      type: "button",
                      disabled: view.busy,
                      onClick: refresh,
                      children: t.storageRefresh,
                    }),
                    jsx.jsx("button", {
                      type: "button",
                      disabled: view.busy || !canPrepare,
                      "data-penglai-uninstall-confirm": "1",
                      onClick: prepare,
                      children: t.prepareDelete,
                    }),
                    jsx.jsx("button", {
                      type: "button",
                      disabled: view.busy,
                      onClick: () =>
                        desktopCall("exportPreview")
                          .then(() =>
                            setView((current) => ({
                              ...current,
                              exportReady: true,
                            })),
                          )
                          .catch((error) =>
                            setView((current) => ({
                              ...current,
                              error: errorText(error),
                            })),
                          ),
                      children: t.exportPreview,
                    }),
                  ],
                })
              : jsx.jsxs("div", {
                  "data-penglai-deletion-preview": preview.operationId,
                  children: [
                    jsx.jsx("h4", { children: t.previewTitle }),
                    jsx.jsxs("p", {
                      children: [
                        `${t.previewExpires}: `,
                        new Date(preview.expiresAt).toLocaleString(),
                      ],
                    }),
                    jsx.jsx("ul", {
                      children: preview.targets.map((target) =>
                        jsx.jsx(
                          "li",
                          {
                            children: jsx.jsx("code", {
                              children: `${target.path} · ${target.type} · ${target.entryCount} · ${formatBytes(target.totalBytes)}`,
                            }),
                          },
                          target.path,
                        ),
                      ),
                    }),
                    jsx.jsxs("label", {
                      children: [
                        jsx.jsx("input", {
                          type: "checkbox",
                          checked: executeConfirmed,
                          onChange: (event) =>
                            setExecuteConfirmed(Boolean(event.target.checked)),
                        }),
                        t.executeConfirm,
                      ],
                    }),
                    jsx.jsx("button", {
                      type: "button",
                      disabled: view.busy || !executeConfirmed,
                      onClick: execute,
                      children: t.executeDelete,
                    }),
                    jsx.jsx("button", {
                      type: "button",
                      disabled: view.busy,
                      onClick: cancel,
                      children: t.cancelDelete,
                    }),
                    jsx.jsx("p", { children: t.appWillQuit }),
                  ],
                }),
            view.exportReady
              ? jsx.jsx("p", { children: t.exportRedacted })
              : null,
            view.guide
              ? jsx.jsxs("div", {
                  children: [
                    jsx.jsx("h4", { children: t.uninstallGuide }),
                    jsx.jsx("ol", {
                      children: (view.guide.steps || []).map((step) =>
                        jsx.jsx("li", { children: step }, step),
                      ),
                    }),
                  ],
                })
              : null,
          ],
        });
      }
      function UpdateSettingsSection() {
        return jsx.jsx("div", {
          className: "penglai-settings-page",
          "data-penglai-settings": "update",
          children: jsx.jsx(UpdateSection, {}),
        });
      }
      function UninstallSettingsSection() {
        return jsx.jsx("div", {
          className: "penglai-settings-page",
          "data-penglai-settings": "uninstall",
          children: jsx.jsx(UninstallSection, {}),
        });
      }
      ctx.slots.inject("sidebar.brand.mark", () =>
        ctx.slots.register({ name: "sidebar.brand.mark", priority: -100 }, PenglaiBrandMark),
      );
      ctx.slots.inject("sidebar.brand.name", () =>
        ctx.slots.register({ name: "sidebar.brand.name", priority: -100 }, PenglaiBrandName),
      );
      ctx.slots.inject("conversation.hero.brand.mark", () =>
        ctx.slots.register(
          { name: "conversation.hero.brand.mark", priority: -100 },
          PenglaiBrandMark,
        ),
      );
      ctx.slots.inject("settings.section", () =>
        ctx.slots.register(
          {
            name: "settings.section",
            id: "penglai-center",
            order: 18,
            label: () => localeCopy().penglaiSettingsTitle,
            inject: centerInjected,
          },
          PenglaiOverviewSection,
        ),
      );
      ctx.slots.inject("settings.section", function* () {
        yield ctx.slots.register(
          {
            name: "settings.section",
            id: "penglai-update",
            order: 18.8,
            label: () => localeCopy().updateTitle,
          },
          UpdateSettingsSection,
        );
        yield ctx.slots.register(
          {
            name: "settings.section",
            id: "penglai-uninstall",
            order: 18.9,
            label: () => localeCopy().uninstallTitle,
          },
          UninstallSettingsSection,
        );
      });
    }

    async function apply(ctx) {
      try {
        window.__PENGLAI_CENTER_APPLY = true;
      } catch {
        /* window may be missing in tests */
      }
      const disposeRemote = await ctx.remote.$mount(
        PENGLAI_REMOTE_CONTRIBUTION,
      );
      const viewFiber = ctx.inject(
        [
          "slots",
          "connection",
          "locale",
          "remote.penglaiCenter",
          "remote.pluginInventory",
        ],
        applyView,
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
