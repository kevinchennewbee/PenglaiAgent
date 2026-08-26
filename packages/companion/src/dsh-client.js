window.__ModuleLoader__.load({
  id: "@penglai/companion",
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
        throw new TypeError("Companion Remote requires bounded JSON");
      if (seen.has(value))
        throw new TypeError("Companion Remote rejects cyclic JSON");
      seen.add(value);
      const entries = Array.isArray(value) ? value : Object.entries(value);
      if (entries.length > 4096)
        throw new TypeError("Companion Remote JSON is too large");
      if (Array.isArray(value))
        value.forEach((item) => strictJson(item, depth + 1, seen));
      else
        for (const [key, item] of entries) {
          if (["__proto__", "prototype", "constructor"].includes(key))
            throw new TypeError("Companion Remote rejects unsafe fields");
          strictJson(item, depth + 1, seen);
        }
      seen.delete(value);
      return value;
    }
    const remoteCodec = (kind) => ({
      mode: "strict",
      typeSymbol: `@penglai/companion/client#${kind}`,
      schema: {
        parse(value) {
          if (
            kind === "input" &&
            (!value || typeof value !== "object" || Array.isArray(value))
          )
            throw new TypeError("Companion Remote input must be an object");
          return value === undefined ? value : strictJson(value);
        },
      },
    });
    const descriptor = (method, input) => ({
      id: `@penglai/companion#penglaiCompanionSettings/${method}`,
      service: "penglaiCompanionSettings",
      namespace: "penglaiCompanionSettings",
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
    const REMOTE = {
      package: "@penglai/companion",
      descriptors: [
        descriptor("status", false),
        descriptor("proposeEnable", true),
        descriptor("enable", true),
        descriptor("proposeDisable", false),
        descriptor("disable", true),
        descriptor("proposeReminder", true),
        descriptor("scheduleReminder", true),
      ],
    };
    const COPY = {
      zh: {
        title: "主动陪伴",
        hint: "默认关闭。只复用你选择的真实 IM 绑定、Workspace、Session 与官方 Schedule；不会伪造用户消息，也不会无人值守调用工具。",
        off: "已关闭",
        on: "已启用",
        binding: "IM 绑定",
        quiet: "安静时段",
        cap: "每日上限",
        recent: "最近互动暂停（分钟）",
        intensity: "频率",
        gentle: "轻柔",
        balanced: "均衡",
        frequent: "较频繁",
        delivery: "送达方式",
        text: "文本",
        voice: "语音",
        both: "文本+语音",
        locale: "消息语言",
        signals: "允许的触发",
        periodic: "周期关怀",
        reminder: "提醒",
        idle: "空闲",
        emotion: "情绪信号",
        permission: "权限：plan/no-unattended-tools（不可更改）",
        confirmEnable: "我确认以上范围并启用主动陪伴",
        enable: "启用",
        confirmDisable: "我确认停用并清理 owned schedules/listeners",
        disable: "停用",
        unavailable: "主动陪伴服务暂时不可用。",
        busy: "处理中…",
        noBinding: "请先连接消息平台。",
      },
      en: {
        title: "Proactive Companion",
        hint: "Off by default. It reuses an exact IM binding, Workspace, Session, and official Schedule. It never fabricates user messages or runs unattended tools.",
        off: "Disabled",
        on: "Enabled",
        binding: "IM binding",
        quiet: "Quiet hours",
        cap: "Daily cap",
        recent: "Recent-interaction pause (minutes)",
        intensity: "Intensity",
        gentle: "Gentle",
        balanced: "Balanced",
        frequent: "Frequent",
        delivery: "Delivery",
        text: "Text",
        voice: "Voice",
        both: "Text + voice",
        locale: "Message language",
        signals: "Allowed signals",
        periodic: "Periodic",
        reminder: "Reminder",
        idle: "Idle",
        emotion: "Emotion signal",
        permission: "Permission: plan/no-unattended-tools (immutable)",
        confirmEnable: "I confirm this exact scope and enable companion",
        enable: "Enable",
        confirmDisable:
          "I confirm disable and cleanup of owned schedules/listeners",
        disable: "Disable",
        unavailable: "Companion service is temporarily unavailable.",
        busy: "Working…",
        noBinding: "Connect a messaging platform first.",
      },
    };
    const copy = () =>
      COPY[
        String(document.documentElement.lang || "zh").startsWith("en")
          ? "en"
          : "zh"
      ];
    const unwrap = (v) => {
      if (v && typeof v === "object" && "ok" in v) {
        if (!v.ok) throw new Error(v.error?.message || "remote");
        return v.value;
      }
      return v;
    };
    function CompanionTab({ remote }) {
      const t = copy();
      const api = remote?.penglaiCompanionSettings;
      const [v, set] = React.useState({
        phase: "loading",
        snapshot: null,
        bindingId: "",
        quietStartHour: 22,
        quietEndHour: 8,
        dailyCap: 1,
        recentInteractionMinutes: 90,
        intensity: "gentle",
        deliveryMode: "text",
        locale: "zh",
        signals: ["periodic"],
        confirmed: false,
        disableConfirmed: false,
        busy: false,
        error: "",
        notice: "",
      });
      const refresh = React.useCallback(() => {
        if (!api?.status) {
          set((x) => ({ ...x, phase: "unavailable" }));
          return;
        }
        Promise.resolve(api.status())
          .then(unwrap)
          .then((snapshot) =>
            set((x) => ({
              ...x,
              phase: "ready",
              snapshot,
              bindingId:
                x.bindingId || snapshot.options?.bindings?.[0]?.id || "",
              error: "",
            })),
          )
          .catch((e) =>
            set((x) => ({
              ...x,
              phase: "unavailable",
              error: String(e?.message || e),
            })),
          );
      }, [api]);
      React.useEffect(() => {
        refresh();
      }, [refresh]);
      const run = (proposalMethod, method, input) => {
        set((x) => ({ ...x, busy: true, error: "", notice: "" }));
        const approve = window.penglai && window.penglai.requestOwnerApproval;
        Promise.resolve(
          proposalMethod === "proposeDisable"
            ? api[proposalMethod]()
            : api[proposalMethod](input),
        )
          .then(unwrap)
          .then((proposed) => {
            if (!approve || !proposed || !proposed.actionId) {
              throw new Error("owner approval required");
            }
            return Promise.resolve(approve({ actionId: proposed.actionId })).then((decided) => {
              if (!decided || decided.decision !== "approved") throw new Error("owner denied");
              return api[method]({
                ...(input || {}),
                actionId: proposed.actionId,
                receipt: decided.receipt,
              });
            });
          })
          .then(unwrap)
          .then(() => {
            set((x) => ({
              ...x,
              busy: false,
              confirmed: false,
              disableConfirmed: false,
              notice: "✓",
            }));
            refresh();
          })
          .catch((e) =>
            set((x) => ({ ...x, busy: false, error: String(e?.message || e) })),
          );
      };
      if (v.phase !== "ready")
        return jsx.jsxs("section", {
          "data-penglai-companion": "1",
          children: [
            v.phase === "unavailable" ? t.unavailable : t.busy,
            " ",
            v.error,
          ],
        });
      const config = v.snapshot.config;
      const bindings = v.snapshot.options?.bindings || [];
      const selected = bindings.find((b) => b.id === v.bindingId);
      const toggleSignal = (name, checked) =>
        set((x) => ({
          ...x,
          confirmed: false,
          signals: checked
            ? [...new Set([...x.signals, name])]
            : x.signals.filter((s) => s !== name),
        }));
      return jsx.jsxs("section", {
        "data-penglai-companion": "1",
        "data-penglai-companion-status": config.enabled
          ? "enabled"
          : "disabled",
        children: [
          jsx.jsx("h3", { children: t.title }),
          jsx.jsx("p", { children: t.hint }),
          jsx.jsx("strong", { children: config.enabled ? t.on : t.off }),
          config.enabled
            ? jsx.jsxs("dl", {
                children: [
                  jsx.jsx("dt", { children: t.binding }),
                  jsx.jsx("dd", {
                    children: `${config.bindingId} · ${config.workspaceId}/${config.boundSessionId}`,
                  }),
                  jsx.jsx("dt", { children: t.permission }),
                  jsx.jsx("dd", { children: config.permission }),
                ],
              })
            : jsx.jsxs("div", {
                children: [
                  bindings.length
                    ? jsx.jsxs("label", {
                        children: [
                          t.binding,
                          " ",
                          jsx.jsx("select", {
                            value: v.bindingId,
                            onChange: (e) =>
                              set((x) => ({
                                ...x,
                                bindingId: String(e.target.value),
                                confirmed: false,
                              })),
                            children: bindings.map((b) =>
                              jsx.jsx(
                                "option",
                                {
                                  value: b.id,
                                  children: `${b.channel} · ${b.workspaceId}/${b.sessionId}`,
                                },
                                b.id,
                              ),
                            ),
                          }),
                        ],
                      })
                    : jsx.jsx("p", { "data-penglai-companion-need-im": "1", children: t.noBinding }),
                  jsx.jsxs("label", {
                    children: [
                      t.quiet,
                      " ",
                      jsx.jsx("input", {
                        type: "number",
                        min: 0,
                        max: 23,
                        value: v.quietStartHour,
                        onChange: (e) =>
                          set((x) => ({
                            ...x,
                            quietStartHour: Number(e.target.value),
                            confirmed: false,
                          })),
                      }),
                      "–",
                      jsx.jsx("input", {
                        type: "number",
                        min: 0,
                        max: 23,
                        value: v.quietEndHour,
                        onChange: (e) =>
                          set((x) => ({
                            ...x,
                            quietEndHour: Number(e.target.value),
                            confirmed: false,
                          })),
                      }),
                    ],
                  }),
                  jsx.jsxs("label", {
                    children: [
                      t.cap,
                      " ",
                      jsx.jsx("input", {
                        type: "number",
                        min: 1,
                        max: 12,
                        value: v.dailyCap,
                        onChange: (e) =>
                          set((x) => ({
                            ...x,
                            dailyCap: Number(e.target.value),
                            confirmed: false,
                          })),
                      }),
                    ],
                  }),
                  jsx.jsxs("label", {
                    children: [
                      t.recent,
                      " ",
                      jsx.jsx("input", {
                        type: "number",
                        min: 0,
                        max: 1440,
                        value: v.recentInteractionMinutes,
                        onChange: (e) =>
                          set((x) => ({
                            ...x,
                            recentInteractionMinutes: Number(e.target.value),
                            confirmed: false,
                          })),
                      }),
                    ],
                  }),
                  jsx.jsxs("label", {
                    children: [
                      t.intensity,
                      " ",
                      jsx.jsxs("select", {
                        value: v.intensity,
                        onChange: (e) =>
                          set((x) => ({
                            ...x,
                            intensity: String(e.target.value),
                            confirmed: false,
                          })),
                        children: [
                          jsx.jsx("option", {
                            value: "gentle",
                            children: t.gentle,
                          }),
                          jsx.jsx("option", {
                            value: "balanced",
                            children: t.balanced,
                          }),
                          jsx.jsx("option", {
                            value: "frequent",
                            children: t.frequent,
                          }),
                        ],
                      }),
                    ],
                  }),
                  jsx.jsxs("label", {
                    children: [
                      t.delivery,
                      " ",
                      jsx.jsxs("select", {
                        value: v.deliveryMode,
                        onChange: (e) =>
                          set((x) => ({
                            ...x,
                            deliveryMode: String(e.target.value),
                            confirmed: false,
                          })),
                        children: [
                          jsx.jsx("option", {
                            value: "text",
                            children: t.text,
                          }),
                          jsx.jsx("option", {
                            value: "voice",
                            children: t.voice,
                          }),
                          jsx.jsx("option", {
                            value: "text+voice",
                            children: t.both,
                          }),
                        ],
                      }),
                    ],
                  }),
                  jsx.jsxs("label", {
                    children: [
                      t.locale,
                      " ",
                      jsx.jsxs("select", {
                        value: v.locale,
                        onChange: (e) =>
                          set((x) => ({
                            ...x,
                            locale: String(e.target.value),
                            confirmed: false,
                          })),
                        children: [
                          jsx.jsx("option", { value: "zh", children: "中文" }),
                          jsx.jsx("option", {
                            value: "en",
                            children: "English",
                          }),
                        ],
                      }),
                    ],
                  }),
                  jsx.jsx("fieldset", {
                    children: jsx.jsxs(React.Fragment, {
                      children: [
                        jsx.jsx("legend", { children: t.signals }),
                        ...["periodic", "reminder", "idle", "emotion"].map(
                          (name) =>
                            jsx.jsxs(
                              "label",
                              {
                                children: [
                                  jsx.jsx("input", {
                                    type: "checkbox",
                                    checked: v.signals.includes(name),
                                    onChange: (e) =>
                                      toggleSignal(name, e.target.checked),
                                  }),
                                  t[name],
                                ],
                              },
                              name,
                            ),
                        ),
                      ],
                    }),
                  }),
                  jsx.jsx("p", { children: t.permission }),
                  jsx.jsxs("label", {
                    children: [
                      jsx.jsx("input", {
                        type: "checkbox",
                        checked: v.confirmed,
                        onChange: (e) =>
                          set((x) => ({ ...x, confirmed: e.target.checked })),
                      }),
                      t.confirmEnable,
                    ],
                  }),
                  jsx.jsx("button", {
                    type: "button",
                    disabled:
                      v.busy || !v.confirmed || !selected || !v.signals.length,
                    onClick: () =>
                      run("proposeEnable", "enable", {
                        bindingId: selected.id,
                        workspaceId: selected.workspaceId,
                        sessionId: selected.sessionId,
                        quietStartHour: v.quietStartHour,
                        quietEndHour: v.quietEndHour,
                        dailyCap: v.dailyCap,
                        recentInteractionMinutes: v.recentInteractionMinutes,
                        intensity: v.intensity,
                        deliveryMode: v.deliveryMode,
                        locale: v.locale,
                        signals: v.signals,
                      }),
                    children: t.enable,
                  }),
                ],
              }),
          config.enabled
            ? jsx.jsxs("div", {
                children: [
                  jsx.jsxs("label", {
                    children: [
                      jsx.jsx("input", {
                        type: "checkbox",
                        checked: v.disableConfirmed,
                        onChange: (e) =>
                          set((x) => ({
                            ...x,
                            disableConfirmed: e.target.checked,
                          })),
                      }),
                      t.confirmDisable,
                    ],
                  }),
                  jsx.jsx("button", {
                    type: "button",
                    disabled: v.busy || !v.disableConfirmed,
                    onClick: () => run("proposeDisable", "disable", {}),
                    children: t.disable,
                  }),
                ],
              })
            : null,
          v.busy ? jsx.jsx("p", { children: t.busy }) : null,
          v.notice
            ? jsx.jsx("p", { role: "status", children: v.notice })
            : null,
          v.error ? jsx.jsx("p", { role: "alert", children: v.error }) : null,
        ],
      });
    }
    function CompanionSettingsSection(props) {
      return jsx.jsx("div", {
        className: "penglai-settings-page",
        "data-penglai-settings": "companion",
        children: jsx.jsx(CompanionTab, props),
      });
    }
    async function apply(ctx) {
      const disposeRemote = await ctx.remote.$mount(REMOTE);
      const viewFiber = ctx.inject(
        ["slots", "remote.penglaiCompanionSettings"],
        (viewCtx) => {
          const pageRemote = {
            penglaiCompanionSettings: viewCtx.remote.penglaiCompanionSettings,
          };
          viewCtx.slots.inject("settings.section", () =>
            viewCtx.slots.register(
              {
                name: "settings.section",
                id: "penglai-companion",
                order: 18.7,
                label: () => copy().title,
                inject: () => ({ remote: pageRemote }),
              },
              CompanionSettingsSection,
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
