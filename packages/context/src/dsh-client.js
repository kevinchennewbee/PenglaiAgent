window.__ModuleLoader__.load({
  id: "@penglai/context",
  factory: (require) => {
    const module = { exports: {} };
    const React = require("react");
    const jsx = require("react/jsx-runtime");
    const inject = ["remote"];

    function strictJson(value, depth = 0, seen = new Set()) {
      if (
        value === null ||
        typeof value === "string" ||
        typeof value === "boolean"
      )
        return value;
      if (typeof value === "number" && Number.isFinite(value)) return value;
      if (
        depth > 12 ||
        !value ||
        typeof value !== "object" ||
        (!Array.isArray(value) &&
          Object.prototype.toString.call(value) !== "[object Object]")
      )
        throw new TypeError("Context Remote requires bounded JSON");
      if (seen.has(value))
        throw new TypeError("Context Remote rejects cyclic JSON");
      seen.add(value);
      const entries = Array.isArray(value) ? value : Object.entries(value);
      if (entries.length > 4096)
        throw new TypeError("Context Remote JSON is too large");
      if (Array.isArray(value))
        value.forEach((item) => strictJson(item, depth + 1, seen));
      else
        for (const [key, item] of entries) {
          if (["__proto__", "prototype", "constructor"].includes(key))
            throw new TypeError("Context Remote rejects unsafe fields");
          strictJson(item, depth + 1, seen);
        }
      seen.delete(value);
      return value;
    }
    const remoteCodec = (kind) => ({
      mode: "strict",
      typeSymbol: `@penglai/context/client#${kind}`,
      schema: {
        parse(value) {
          if (
            kind === "input" &&
            (!value || typeof value !== "object" || Array.isArray(value))
          )
            throw new TypeError("Context Remote input must be an object");
          return value === undefined ? value : strictJson(value);
        },
      },
    });
    const remoteDescriptor = (method, hasInput = false) => ({
      id: `@penglai/context#penglaiContextSettings/${method}`,
      service: "penglaiContextSettings",
      namespace: "penglaiContextSettings",
      method,
      implementation: method,
      invocation: { kind: "direct" },
      parameters: hasInput
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
      package: "@penglai/context",
      descriptors: [
        "status",
        "ingestCapability",
        "reindex",
        "revoke",
        "search",
      ].map((method) => remoteDescriptor(method, method !== "status")),
    };

    const COPY = {
      zh: {
        title: "个人上下文",
        sourceTitle: "本地资料来源",
        hint: "只索引你通过系统文件夹选择器明确授权的目录。源文件始终只读；撤销只删除派生索引。",
        add: "授权并索引文件夹",
        scope: "范围",
        global: "全局",
        workspace: "工作区",
        documents: "文档",
        revision: "索引版本",
        reindex: "重新索引",
        revoke: "撤销并删除派生索引",
        revokeConfirm: "我确认只删除派生索引，不删除源文件",
        search: "测试搜索",
        searchPlaceholder: "输入要搜索的文字",
        noSources: "尚未授权任何来源。",
        sourceUntouched: "源文件未改动",
        loading: "正在读取授权来源…",
        unavailable: "个人上下文服务暂时不可用。",
        busy: "处理中…",
      },
      en: {
        title: "Personal Context",
        sourceTitle: "Local sources",
        hint: "Only folders explicitly authorized through the system picker are indexed. Source files stay read-only; revoke deletes derived indexes only.",
        add: "Authorize and index folder",
        scope: "Scope",
        global: "Global",
        workspace: "Workspace",
        documents: "Documents",
        revision: "Index revision",
        reindex: "Reindex",
        revoke: "Revoke and delete derived index",
        revokeConfirm:
          "I confirm this removes only the derived index, never source files",
        search: "Test search",
        searchPlaceholder: "Text to search",
        noSources: "No source is authorized yet.",
        sourceUntouched: "Source files untouched",
        loading: "Reading authorized sources…",
        unavailable: "Personal Context is temporarily unavailable.",
        busy: "Working…",
      },
    };
    const copy = () =>
      COPY[
        String(document.documentElement.lang || "zh").startsWith("en")
          ? "en"
          : "zh"
      ];
    const unwrap = (value) => {
      if (value && typeof value === "object" && "ok" in value) {
        if (value.ok === false)
          throw new Error((value.error && value.error.message) || "remote");
        return value.value;
      }
      return value;
    };
    const errorText = (error) =>
      String(error && error.message ? error.message : error);
    const desktopPick = () => {
      const api = typeof window !== "undefined" ? window.penglai : undefined;
      if (!api || typeof api.pickContextFolder !== "function")
        return Promise.reject(new Error("Penglai folder picker unavailable"));
      return Promise.resolve(api.pickContextFolder());
    };

    function ContextTab({ remote, embedded = false }) {
      const t = copy();
      const api = remote?.penglaiContextSettings;
      const [view, setView] = React.useState({
        phase: "loading",
        snapshot: { grants: [], workspaces: [] },
        scope: "global",
        workspaceId: "",
        query: "",
        hits: [],
        revokeRoot: "",
        busy: false,
        error: "",
        notice: "",
      });
      const refresh = React.useCallback(() => {
        if (!api?.status) {
          setView((current) => ({ ...current, phase: "unavailable" }));
          return;
        }
        Promise.resolve(api.status())
          .then((value) => {
            const snapshot = unwrap(value) || { grants: [], workspaces: [] };
            setView((current) => ({
              ...current,
              phase: "ready",
              snapshot,
              error: "",
              workspaceId:
                current.workspaceId ||
                (snapshot.workspaces &&
                  snapshot.workspaces[0] &&
                  snapshot.workspaces[0].id) ||
                "",
            }));
          })
          .catch((error) =>
            setView((current) => ({
              ...current,
              phase: "unavailable",
              error: errorText(error),
            })),
          );
      }, [api]);
      React.useEffect(() => {
        refresh();
      }, [refresh]);
      const run = (method, input, notice = "") => {
        if (!api?.[method]) return Promise.resolve();
        setView((current) => ({
          ...current,
          busy: true,
          error: "",
          notice: "",
        }));
        return Promise.resolve(api[method](input))
          .then((value) => {
            const result = unwrap(value);
            setView((current) => ({
              ...current,
              busy: false,
              notice: result?.sourceUntouched ? t.sourceUntouched : notice,
            }));
            refresh();
            return result;
          })
          .catch((error) =>
            setView((current) => ({
              ...current,
              busy: false,
              error: errorText(error),
            })),
          );
      };
      const add = () => {
        setView((current) => ({
          ...current,
          busy: true,
          error: "",
          notice: "",
        }));
        desktopPick()
          .then((picked) => {
            if (!picked) {
              setView((current) => ({ ...current, busy: false }));
              return undefined;
            }
            return run(
              "ingestCapability",
              {
                capabilityRef: picked.capabilityRef,
                scope: view.scope,
                ...(view.scope === "workspace"
                  ? { workspaceId: view.workspaceId }
                  : {}),
              },
              String(picked.displayName || ""),
            );
          })
          .catch((error) =>
            setView((current) => ({
              ...current,
              busy: false,
              error: errorText(error),
            })),
          );
      };
      const search = () => {
        if (!api?.search || !view.query.trim()) return;
        setView((current) => ({ ...current, busy: true, error: "", hits: [] }));
        Promise.resolve(
          api.search({
            query: view.query,
            ...(view.scope === "workspace"
              ? { workspaceId: view.workspaceId }
              : {}),
          }),
        )
          .then((value) =>
            setView((current) => ({
              ...current,
              busy: false,
              hits: unwrap(value) || [],
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
      if (view.phase === "loading")
        return jsx.jsx("section", {
          "data-penglai-context": "1",
          "data-penglai-context-status": "loading",
          children: t.loading,
        });
      if (view.phase === "unavailable")
        return jsx.jsxs("section", {
          "data-penglai-context": "1",
          "data-penglai-context-status": "unavailable",
          children: [t.unavailable, view.error ? ` ${view.error}` : ""],
        });
      const grants = view.snapshot.grants || [];
      const workspaces = view.snapshot.workspaces || [];
      return jsx.jsxs("section", {
        "data-penglai-context": "1",
        "data-penglai-context-status": "ready",
        role: "region",
        "aria-label": t.title,
        children: [
          jsx.jsx(embedded ? "h4" : "h3", {
            children: embedded ? t.sourceTitle : t.title,
          }),
          jsx.jsx("p", { children: t.hint }),
          jsx.jsxs("label", {
            children: [
              t.scope,
              " ",
              jsx.jsxs("select", {
                value: view.scope,
                disabled: view.busy,
                onChange: (event) =>
                  setView((current) => ({
                    ...current,
                    scope: String(event.target.value),
                  })),
                children: [
                  jsx.jsx("option", { value: "global", children: t.global }),
                  jsx.jsx("option", {
                    value: "workspace",
                    children: t.workspace,
                  }),
                ],
              }),
            ],
          }),
          view.scope === "workspace"
            ? jsx.jsx("select", {
                value: view.workspaceId,
                disabled: view.busy,
                onChange: (event) =>
                  setView((current) => ({
                    ...current,
                    workspaceId: String(event.target.value),
                  })),
                children: workspaces.map((row) =>
                  jsx.jsx(
                    "option",
                    { value: row.id, children: row.title || row.id },
                    row.id,
                  ),
                ),
              })
            : null,
          jsx.jsx("button", {
            type: "button",
            disabled:
              view.busy || (view.scope === "workspace" && !view.workspaceId),
            onClick: add,
            children: t.add,
          }),
          grants.length
            ? jsx.jsx("ul", {
                children: grants.map((grant) =>
                  jsx.jsxs(
                    "li",
                    {
                      "data-penglai-context-grant": grant.root,
                      children: [
                        jsx.jsx("code", { children: grant.root }),
                        ` · ${grant.scope}${grant.workspaceId ? `:${grant.workspaceId}` : ""} · ${t.documents}: ${grant.documents} · ${t.revision}: ${grant.revision} `,
                        jsx.jsx("button", {
                          type: "button",
                          disabled: view.busy,
                          onClick: () => run("reindex", { root: grant.root }),
                          children: t.reindex,
                        }),
                        " ",
                        jsx.jsxs("label", {
                          children: [
                            jsx.jsx("input", {
                              type: "checkbox",
                              checked: view.revokeRoot === grant.root,
                              onChange: (event) =>
                                setView((current) => ({
                                  ...current,
                                  revokeRoot: event.target.checked
                                    ? grant.root
                                    : "",
                                })),
                            }),
                            t.revokeConfirm,
                          ],
                        }),
                        " ",
                        jsx.jsx("button", {
                          type: "button",
                          disabled: view.busy || view.revokeRoot !== grant.root,
                          onClick: () =>
                            run(
                              "revoke",
                              { root: grant.root, ownerConfirmed: true },
                              t.sourceUntouched,
                            ),
                          children: t.revoke,
                        }),
                      ],
                    },
                    grant.root,
                  ),
                ),
              })
            : jsx.jsx("p", { children: t.noSources }),
          jsx.jsxs("div", {
            children: [
              jsx.jsx("input", {
                type: "search",
                value: view.query,
                placeholder: t.searchPlaceholder,
                onChange: (event) =>
                  setView((current) => ({
                    ...current,
                    query: String(event.target.value),
                  })),
              }),
              jsx.jsx("button", {
                type: "button",
                disabled: view.busy || !view.query.trim(),
                onClick: search,
                children: t.search,
              }),
            ],
          }),
          view.hits.length
            ? jsx.jsx("ul", {
                "data-penglai-context-results": "1",
                children: view.hits.map((hit) =>
                  jsx.jsxs(
                    "li",
                    {
                      children: [
                        jsx.jsx("code", { children: hit.path }),
                        ` · ${hit.status} · ${hit.excerpt || ""}`,
                      ],
                    },
                    `${hit.path}:${hit.digest}`,
                  ),
                ),
              })
            : null,
          view.busy ? jsx.jsx("p", { children: t.busy }) : null,
          view.notice
            ? jsx.jsx("p", { role: "status", children: view.notice })
            : null,
          view.error
            ? jsx.jsx("p", {
                role: "alert",
                "data-penglai-context-error": "1",
                children: view.error,
              })
            : null,
        ],
      });
    }
    function ContextSettingsSection(props) {
      return jsx.jsx("div", {
        className: "penglai-settings-page",
        "data-penglai-settings": "context",
        children: jsx.jsx(ContextTab, props),
      });
    }
    async function apply(ctx) {
      const disposeRemote = await ctx.remote.$mount(REMOTE);
      return async () => {
        await disposeRemote();
      };
    }
    module.exports = { apply, inject, ContextTab };
    return module.exports;
  },
});
