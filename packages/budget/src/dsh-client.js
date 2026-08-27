window.__ModuleLoader__.load({
  id: "@penglai/budget",
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
        throw new TypeError("Budget Remote requires bounded JSON");
      if (seen.has(value))
        throw new TypeError("Budget Remote rejects cyclic JSON");
      seen.add(value);
      const entries = Array.isArray(value) ? value : Object.entries(value);
      if (entries.length > 4096)
        throw new TypeError("Budget Remote JSON is too large");
      if (Array.isArray(value))
        value.forEach((item) => strictJson(item, depth + 1, seen));
      else
        for (const [key, item] of entries) {
          if (["__proto__", "prototype", "constructor"].includes(key))
            throw new TypeError("Budget Remote rejects unsafe fields");
          strictJson(item, depth + 1, seen);
        }
      seen.delete(value);
      return value;
    }
    const remoteCodec = (kind) => ({
      mode: "strict",
      typeSymbol: `@penglai/budget/client#${kind}`,
      schema: {
        parse(value) {
          if (
            kind === "input" &&
            (!value || typeof value !== "object" || Array.isArray(value))
          )
            throw new TypeError("Budget Remote input must be an object");
          return value === undefined ? value : strictJson(value);
        },
      },
    });
    const descriptor = (method, input) => ({
      id: `@penglai/budget#penglaiBudgetSettings/${method}`,
      service: "penglaiBudgetSettings",
      namespace: "penglaiBudgetSettings",
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
      package: "@penglai/budget",
      descriptors: [descriptor("status", false), descriptor("proposePolicy", true), descriptor("setPolicy", true)],
    };
    const COPY = {
      zh: {
        title: "Token 预算",
        hint: "数据来自官方 TokenMeter。无可信价格时只显示 token，不估算金额；硬上限会在新 Turn 调用模型前阻断。",
        day: "账期",
        actual: "已用 token",
        reserved: "预留 token",
        money: "金额",
        unavailableMoney: "无可信价格，不显示",
        scope: "策略范围",
        global: "全局",
        workspace: "工作区",
        provider: "提供商",
        model: "模型路由",
        unlimited: "不限额",
        hard: "每日硬上限",
        warn: "提醒比例",
        confirm: "我确认更新预算策略",
        save: "保存策略",
        policies: "当前策略",
        none: "尚未设置限制（默认不限额）",
        unavailable: "预算服务暂时不可用。",
        busy: "处理中…",
      },
      en: {
        title: "Token Budget",
        hint: "Usage comes from the official TokenMeter. Money is omitted without trusted pricing; hard limits block a new Turn before model invocation.",
        day: "Day",
        actual: "Used tokens",
        reserved: "Reserved tokens",
        money: "Money",
        unavailableMoney: "Not shown without trusted pricing",
        scope: "Policy scope",
        global: "Global",
        workspace: "Workspace",
        provider: "Provider",
        model: "Model route",
        unlimited: "Unlimited",
        hard: "Daily hard limit",
        warn: "Warn ratio",
        confirm: "I confirm this budget policy update",
        save: "Save policy",
        policies: "Current policies",
        none: "No limits configured (unlimited by default)",
        unavailable: "Budget service is temporarily unavailable.",
        busy: "Working…",
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
    function BudgetTab({ remote }) {
      const t = copy();
      const api = remote?.penglaiBudgetSettings;
      const [v, set] = React.useState({
        phase: "loading",
        status: null,
        scope: "global",
        key: "*",
        hard: "",
        unlimited: true,
        warn: "0.8",
        confirmed: false,
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
          .then((status) =>
            set((x) => ({
              ...x,
              phase: "ready",
              status,
              error: "",
              key:
                x.scope === "global"
                  ? "*"
                  : x.key || optionKeys(status, x.scope)[0] || "",
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
      const optionKeys = (status, scope) =>
        scope === "workspace"
          ? (status?.options?.workspaces || []).map((x) => x.id)
          : scope === "provider"
            ? status?.options?.providers || []
            : scope === "model"
              ? (status?.options?.models || []).map((x) => x.key)
              : ["*"];
      const changeScope = (scope) =>
        set((x) => ({
          ...x,
          scope,
          key: optionKeys(x.status, scope)[0] || "",
          confirmed: false,
        }));
      const save = () => {
        set((x) => ({ ...x, busy: true, error: "", notice: "" }));
        const payload = {
          scope: v.scope,
          key: v.key,
          hardTokens: v.unlimited ? null : Number(v.hard),
          warnRatio: Number(v.warn),
        };
        const approve = window.penglai && window.penglai.requestOwnerApproval;
        Promise.resolve(
          api.proposePolicy
            ? api.proposePolicy(payload)
            : { actionId: undefined },
        )
          .then((proposed) => {
            if (!approve || !proposed || !proposed.actionId) {
              throw new Error("owner approval required");
            }
            return Promise.resolve(approve({ actionId: proposed.actionId })).then((decided) => {
              if (!decided || decided.decision !== "approved") throw new Error("owner denied");
              return api.setPolicy({
                ...payload,
                actionId: proposed.actionId,
                receipt: decided.receipt,
              });
            });
          })
          .then(unwrap)
          .then(() => {
            set((x) => ({ ...x, busy: false, confirmed: false, notice: "✓" }));
            refresh();
          })
          .catch((e) =>
            set((x) => ({ ...x, busy: false, error: String(e?.message || e) })),
          );
      };
      if (v.phase !== "ready")
        return jsx.jsxs("section", {
          "data-penglai-budget": "1",
          children: [
            v.phase === "unavailable" ? t.unavailable : t.busy,
            " ",
            v.error,
          ],
        });
      const s = v.status;
      const keys = optionKeys(s, v.scope);
      return jsx.jsxs("section", {
        "data-penglai-budget": "1",
        "data-penglai-budget-status": "ready",
        children: [
          jsx.jsx("h3", { children: t.title }),
          jsx.jsx("p", { children: t.hint }),
          jsx.jsxs("dl", {
            children: [
              jsx.jsx("dt", { children: t.day }),
              jsx.jsx("dd", { children: s.day }),
              jsx.jsx("dt", { children: t.actual }),
              jsx.jsx("dd", { children: s.tokens }),
              jsx.jsx("dt", { children: t.reserved }),
              jsx.jsx("dd", { children: s.reservedTokens }),
              jsx.jsx("dt", { children: t.money }),
              jsx.jsx("dd", { children: t.unavailableMoney }),
            ],
          }),
          jsx.jsxs("label", {
            children: [
              t.scope,
              " ",
              jsx.jsxs("select", {
                value: v.scope,
                onChange: (e) => changeScope(String(e.target.value)),
                children: [
                  jsx.jsx("option", { value: "global", children: t.global }),
                  jsx.jsx("option", {
                    value: "workspace",
                    children: t.workspace,
                  }),
                  jsx.jsx("option", {
                    value: "provider",
                    children: t.provider,
                  }),
                  jsx.jsx("option", { value: "model", children: t.model }),
                ],
              }),
            ],
          }),
          v.scope !== "global"
            ? jsx.jsx("select", {
                value: v.key,
                onChange: (e) =>
                  set((x) => ({
                    ...x,
                    key: String(e.target.value),
                    confirmed: false,
                  })),
                children: keys.map((key) =>
                  jsx.jsx("option", { value: key, children: key }, key),
                ),
              })
            : null,
          jsx.jsxs("label", {
            children: [
              jsx.jsx("input", {
                type: "checkbox",
                checked: v.unlimited,
                onChange: (e) =>
                  set((x) => ({
                    ...x,
                    unlimited: e.target.checked,
                    confirmed: false,
                  })),
              }),
              t.unlimited,
            ],
          }),
          !v.unlimited
            ? jsx.jsxs("label", {
                children: [
                  t.hard,
                  " ",
                  jsx.jsx("input", {
                    type: "number",
                    min: 1,
                    step: 1,
                    value: v.hard,
                    onChange: (e) =>
                      set((x) => ({
                        ...x,
                        hard: String(e.target.value),
                        confirmed: false,
                      })),
                  }),
                ],
              })
            : null,
          jsx.jsxs("label", {
            children: [
              t.warn,
              " ",
              jsx.jsx("input", {
                type: "number",
                min: "0.01",
                max: "0.99",
                step: "0.01",
                value: v.warn,
                onChange: (e) =>
                  set((x) => ({
                    ...x,
                    warn: String(e.target.value),
                    confirmed: false,
                  })),
              }),
            ],
          }),
          jsx.jsxs("label", {
            children: [
              jsx.jsx("input", {
                type: "checkbox",
                checked: v.confirmed,
                onChange: (e) =>
                  set((x) => ({ ...x, confirmed: e.target.checked })),
              }),
              t.confirm,
            ],
          }),
          jsx.jsx("button", {
            type: "button",
            disabled:
              v.busy ||
              !v.confirmed ||
              !v.key ||
              (!v.unlimited &&
                (!Number.isSafeInteger(Number(v.hard)) || Number(v.hard) <= 0)),
            onClick: save,
            children: t.save,
          }),
          jsx.jsx("h4", { children: t.policies }),
          s.policies.length
            ? jsx.jsx("ul", {
                children: s.policies.map((p) =>
                  jsx.jsx(
                    "li",
                    {
                      children: `${p.scope}:${p.key} · ${p.hardTokens === null ? t.unlimited : p.hardTokens} · ${p.warnRatio}`,
                    },
                    `${p.scope}:${p.key}`,
                  ),
                ),
              })
            : jsx.jsx("p", { children: t.none }),
          v.notice
            ? jsx.jsx("p", { role: "status", children: v.notice })
            : null,
          v.error ? jsx.jsx("p", { role: "alert", children: v.error }) : null,
        ],
      });
    }
    function BudgetSettingsSection(props) {
      return jsx.jsx("div", {
        className: "penglai-settings-page",
        "data-penglai-settings": "budget",
        children: jsx.jsx(BudgetTab, props),
      });
    }
    async function apply(ctx) {
      const disposeRemote = await ctx.remote.$mount(REMOTE);
      const viewFiber = ctx.inject(
        ["slots", "remote.penglaiBudgetSettings"],
        (viewCtx) => {
          const pageRemote = {
            penglaiBudgetSettings: viewCtx.remote.penglaiBudgetSettings,
          };
          viewCtx.slots.inject("settings.section", () =>
            viewCtx.slots.register(
              {
                name: "settings.section",
                id: "penglai-budget",
                order: 18.6,
                label: () => copy().title,
                inject: () => ({ remote: pageRemote }),
              },
              BudgetSettingsSection,
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
