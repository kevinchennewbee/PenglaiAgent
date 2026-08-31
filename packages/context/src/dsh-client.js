function createPenglaiMemorySourcesClient(require) {
    const React = require("react");
    const jsx = require("react/jsx-runtime");

    const COPY = {
      zh: {
        title: "本地资料来源",
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
        unavailable: "蓬莱记忆的本地资料服务暂时不可用。",
        actionFailed: "操作未完成。请刷新状态后重试。",
        busy: "处理中…",
      },
      en: {
        title: "Local sources",
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
        unavailable: "Penglai Memory local sources are temporarily unavailable.",
        actionFailed: "The operation did not complete. Refresh the status and retry.",
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
        if (value.ok === false) {
          const failure = value.error;
          if (failure?.isDSHRemoteError === true && typeof failure.code === "string") throw failure;
          if (failure instanceof Error) throw failure;
          throw new Error((failure && failure.message) || "remote");
        }
        return value.value;
      }
      return value;
    };
    const operationErrorText = () => copy().actionFailed;
    const desktopPick = () => {
      const api = typeof window !== "undefined" ? window.penglai : undefined;
      if (!api || typeof api.pickContextFolder !== "function")
        return Promise.reject(new Error("Penglai folder picker unavailable"));
      return Promise.resolve(api.pickContextFolder());
    };

    function ContextTab({ remote, connectionGeneration, embedded = false }) {
      const t = copy();
      const memory = remote?.penglaiMemorySettings;
      const api = React.useMemo(
        () =>
          memory
            ? {
                status: memory.sourcesStatus,
                ingestCapability: memory.sourcesIngestCapability,
                reindex: memory.sourcesReindex,
                revoke: memory.sourcesRevoke,
                search: memory.sourcesSearch,
              }
            : undefined,
        [memory],
      );
      const generationRef = React.useRef(connectionGeneration);
      generationRef.current = connectionGeneration;
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
        const expectedGeneration = generationRef.current;
        if (expectedGeneration === undefined || !api?.status) {
          setView((current) => ({ ...current, phase: "unavailable" }));
          return;
        }
        Promise.resolve(api.status({}))
          .then((value) => {
            if (generationRef.current !== expectedGeneration) return;
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
          .catch(() => {
            if (generationRef.current !== expectedGeneration) return;
            setView((current) => ({
              ...current,
              phase: "unavailable",
              error: "",
            }));
          });
      }, [api]);
      React.useEffect(() => {
        refresh();
      }, [refresh, connectionGeneration]);
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
          .catch(() =>
            setView((current) => ({
              ...current,
              busy: false,
              error: operationErrorText(),
            })),
          );
      };
      const ownerRun = (root) => {
        if (!api?.revoke || !memory?.proposeAction) return Promise.resolve();
        setView((current) => ({ ...current, busy: true, error: "", notice: "" }));
        return Promise.resolve(
          memory.proposeAction({
            action: "memory.sources-revoke",
            objectId: "source-grant",
            sourceText: root,
          }),
        )
          .then(unwrap)
          .then((proposed) => {
            const approve = window.penglai && window.penglai.requestOwnerApproval;
            if (!approve || !proposed?.actionId) throw new Error("owner approval required");
            return Promise.resolve(approve({ actionId: proposed.actionId })).then((decided) => {
              if (!decided || decided.decision !== "approved") throw new Error("owner denied");
              return api.revoke({ root, actionId: proposed.actionId, receipt: decided.receipt });
            });
          })
          .then(unwrap)
          .then((result) => {
            setView((current) => ({
              ...current,
              busy: false,
              notice: result?.sourceUntouched ? t.sourceUntouched : "",
              revokeRoot: "",
            }));
            refresh();
            return result;
          })
          .catch(() => {
            setView((current) => ({ ...current, busy: false, error: operationErrorText() }));
            return undefined;
          });
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
          .catch(() =>
            setView((current) => ({
              ...current,
              busy: false,
              error: operationErrorText(),
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
          .catch(() =>
            setView((current) => ({
              ...current,
              busy: false,
              error: operationErrorText(),
            })),
          );
      };
      if (view.phase === "loading")
        return jsx.jsx("section", {
          "data-penglai-memory-sources-panel": "1",
          "data-penglai-memory-sources-status": "loading",
          children: t.loading,
        });
      if (view.phase === "unavailable")
        return jsx.jsxs("section", {
          "data-penglai-memory-sources-panel": "1",
          "data-penglai-memory-sources-status": "unavailable",
          children: t.unavailable,
        });
      const grants = view.snapshot.grants || [];
      const workspaces = view.snapshot.workspaces || [];
      return jsx.jsxs("section", {
        "data-penglai-memory-sources-panel": "1",
        "data-penglai-memory-sources-status": "ready",
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
                      "data-penglai-memory-source-grant": grant.root,
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
                          onClick: () => ownerRun(grant.root),
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
                "data-penglai-memory-source-results": "1",
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
                "data-penglai-memory-source-error": "1",
                children: view.error,
              })
            : null,
        ],
      });
    }
    return { ContextTab };
}
