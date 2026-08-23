window.__ModuleLoader__.load({
  id: "@penglai/memory",
  factory: (require) => {
    const module = { exports: {} };
    const React = require("react");
    const jsx = require("react/jsx-runtime");
    const ContextModule = require("@penglai/context");
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
        throw new TypeError("Memory Remote requires bounded JSON");
      if (seen.has(value))
        throw new TypeError("Memory Remote rejects cyclic JSON");
      seen.add(value);
      const entries = Array.isArray(value) ? value : Object.entries(value);
      if (entries.length > 4096)
        throw new TypeError("Memory Remote JSON is too large");
      if (Array.isArray(value))
        value.forEach((item) => strictJson(item, depth + 1, seen));
      else
        for (const [key, item] of entries) {
          if (["__proto__", "prototype", "constructor"].includes(key))
            throw new TypeError("Memory Remote rejects unsafe fields");
          strictJson(item, depth + 1, seen);
        }
      seen.delete(value);
      return value;
    }
    const remoteCodec = (kind) => ({
      mode: "strict",
      typeSymbol: `@penglai/memory/client#${kind}`,
      schema: {
        parse(value) {
          if (
            kind === "input" &&
            (!value || typeof value !== "object" || Array.isArray(value))
          )
            throw new TypeError("Memory Remote input must be an object");
          return value === undefined ? value : strictJson(value);
        },
      },
    });
    const remoteDescriptor = (method) => ({
      id: `@penglai/memory#penglaiMemorySettings/${method}`,
      service: "penglaiMemorySettings",
      namespace: "penglaiMemorySettings",
      method,
      implementation: method,
      invocation: { kind: "direct" },
      parameters: [
        {
          name: "input",
          wire: "input",
          source: "json",
          codec: remoteCodec("input"),
        },
      ],
      result: remoteCodec("result"),
    });
    const REMOTE = {
      package: "@penglai/memory",
      descriptors: [
        "status",
        "write",
        "deleteScope",
        "promoteSop",
        "why",
        "correct",
        "forget",
        "graph",
        "export",
        "importPreview",
        "importConfirm",
      ].map(remoteDescriptor),
    };
    const COPY = {
      zh: {
        title: "蓬莱记忆",
        hint: "候选记忆、工作区记忆与全局 L1 分层保存。模型不能直接写全局记忆；全局写入和删除均需你确认。",
        scope: "范围",
        global: "全局 L1",
        workspace: "工作区",
        candidate: "会话候选",
        add: "保存记忆",
        text: "记忆内容",
        confirm: "我已检查下方变更并确认",
        diff: "可见变更",
        del: "删除当前范围",
        delConfirm: "我确认删除当前范围内的派生记忆",
        empty: "当前范围没有记忆。",
        sop: "提升为官方 DSH Skill",
        name: "Skill 名称（kebab-case）",
        description: "说明",
        body: "SOP 内容",
        promote: "确认提升",
        unavailable: "记忆服务暂时不可用。",
        busy: "处理中…",
        graph: "知识图谱",
        includePersonal: "叠加个人记忆",
        why: "解释",
        correct: "更正",
        forget: "忘记",
        importPreview: "预览 0.5.3 迁移",
        importConfirm: "确认迁移旧记忆",
      },
      en: {
        title: "Penglai Memory",
        hint: "Session candidates, Workspace memory, and global L1 remain separate. Models cannot write global memory; global writes and deletion require your confirmation.",
        scope: "Scope",
        global: "Global L1",
        workspace: "Workspace",
        candidate: "Session candidates",
        add: "Save memory",
        text: "Memory text",
        confirm: "I reviewed the visible diff and confirm",
        diff: "Visible diff",
        del: "Delete current scope",
        delConfirm: "I confirm deletion of derived memory in this scope",
        empty: "No memory in this scope.",
        sop: "Promote to official DSH Skill",
        name: "Skill name (kebab-case)",
        description: "Description",
        body: "SOP body",
        promote: "Confirm promotion",
        unavailable: "Memory service is temporarily unavailable.",
        busy: "Working…",
        graph: "Knowledge graph",
        includePersonal: "Overlay personal memory",
        why: "Why",
        correct: "Correct",
        forget: "Forget",
        importPreview: "Preview 0.5.3 migration",
        importConfirm: "Import legacy memory",
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
        if (v.ok === false) throw new Error(v.error?.message || "remote");
        return v.value;
      }
      return v;
    };
    const message = (e) => String(e?.message || e);
    function MemoryTab({ remote }) {
      const t = copy();
      const api = remote?.penglaiMemorySettings;
      const [v, set] = React.useState({
        phase: "loading",
        scope: "global",
        workspaceId: "",
        rows: [],
        workspaces: [],
        text: "",
        confirmed: false,
        deleteConfirmed: false,
        skillName: "",
        skillDescription: "",
        skillBody: "",
        busy: false,
        error: "",
        notice: "",
        graph: { nodes: [], edges: [] },
        includePersonal: false,
        selectedId: "",
        whyText: "",
        correctText: "",
        importNote: "",
      });
      const refresh = React.useCallback(() => {
        if (!api?.status) {
          set((x) => ({ ...x, phase: "unavailable" }));
          return;
        }
        Promise.resolve(
          api.status({
            scope: v.scope,
            ...(v.scope === "workspace" ? { workspaceId: v.workspaceId } : {}),
          }),
        )
          .then((raw) => {
            const x = unwrap(raw) || {};
            set((s) => ({
              ...s,
              phase: "ready",
              rows: x.rows || [],
              workspaces: x.workspaces || [],
              workspaceId: s.workspaceId || x.workspaces?.[0]?.id || "",
              error: "",
            }));
          })
          .catch((e) =>
            set((x) => ({ ...x, phase: "unavailable", error: message(e) })),
          );
      }, [api, v.scope, v.workspaceId]);
      React.useEffect(() => {
        refresh();
      }, [refresh]);
      const run = (method, input, done) => {
        set((x) => ({ ...x, busy: true, error: "", notice: "" }));
        Promise.resolve(api[method](input))
          .then(unwrap)
          .then((result) => {
            set((x) => ({
              ...x,
              busy: false,
              notice: done || "✓",
              text: method === "write" ? "" : x.text,
              confirmed: false,
              deleteConfirmed: false,
            }));
            refresh();
            return result;
          })
          .catch((e) => set((x) => ({ ...x, busy: false, error: message(e) })));
      };
      if (v.phase === "loading")
        return jsx.jsx("section", {
          "data-penglai-memory": "1",
          children: t.busy,
        });
      if (v.phase === "unavailable")
        return jsx.jsxs("section", {
          "data-penglai-memory": "1",
          children: [t.unavailable, " ", v.error],
        });
      const diff = `+ ${v.text.trim()}`;
      return jsx.jsxs("section", {
        "data-penglai-memory": "1",
        "data-penglai-memory-status": "ready",
        children: [
          jsx.jsx("h3", { children: t.title }),
          jsx.jsx("p", { children: t.hint }),
          jsx.jsxs("label", {
            children: [
              t.scope,
              " ",
              jsx.jsxs("select", {
                value: v.scope,
                onChange: (e) =>
                  set((x) => ({
                    ...x,
                    scope: String(e.target.value),
                    rows: [],
                    confirmed: false,
                  })),
                children: [
                  jsx.jsx("option", { value: "global", children: t.global }),
                  jsx.jsx("option", {
                    value: "workspace",
                    children: t.workspace,
                  }),
                  jsx.jsx("option", {
                    value: "candidate",
                    children: t.candidate,
                  }),
                ],
              }),
            ],
          }),
          v.scope === "workspace"
            ? jsx.jsx("select", {
                value: v.workspaceId,
                onChange: (e) =>
                  set((x) => ({ ...x, workspaceId: String(e.target.value) })),
                children: v.workspaces.map((w) =>
                  jsx.jsx("option", { value: w.id, children: w.title }, w.id),
                ),
              })
            : null,
          jsx.jsx("ul", {
            children: v.rows.length
              ? v.rows.map((r) =>
                  jsx.jsxs(
                    "li",
                    {
                      children: [
                        String(r.content || r.text || r.id),
                        " ",
                        jsx.jsx("button", {
                          type: "button",
                          "data-penglai-memory-why": String(r.id),
                          onClick: () => {
                            set((x) => ({ ...x, selectedId: String(r.id) }));
                            run("why", {
                              id: String(r.id),
                              ...(v.scope === "workspace" ? { workspaceId: v.workspaceId } : {}),
                            });
                          },
                          children: t.why,
                        }),
                        jsx.jsx("button", {
                          type: "button",
                          "data-penglai-memory-forget": String(r.id),
                          onClick: () =>
                            run("forget", {
                              id: String(r.id),
                              ownerConfirmed: true,
                              ...(v.scope === "workspace" ? { workspaceId: v.workspaceId } : {}),
                            }),
                          children: t.forget,
                        }),
                      ],
                    },
                    r.id,
                  ),
                )
              : jsx.jsx("li", { children: t.empty }),
          }),
          jsx.jsxs("label", {
            children: [
              jsx.jsx("input", {
                type: "checkbox",
                checked: v.includePersonal,
                onChange: (e) =>
                  set((x) => ({ ...x, includePersonal: e.target.checked })),
              }),
              t.includePersonal,
            ],
          }),
          jsx.jsx("button", {
            type: "button",
            "data-penglai-memory-graph": "1",
            onClick: () =>
              Promise.resolve(
                api.graph({
                  includePersonal: v.includePersonal,
                  ...(v.scope === "workspace" ? { workspaceId: v.workspaceId } : {}),
                }),
              )
                .then(unwrap)
                .then((graph) => set((x) => ({ ...x, graph: graph || { nodes: [], edges: [] } })))
                .catch((e) => set((x) => ({ ...x, error: message(e) }))),
            children: t.graph,
          }),
          jsx.jsxs("div", {
            "data-penglai-memory-graph-wrap": "1",
            children: [
              v.graph.truncated
                ? jsx.jsx("p", {
                    "data-penglai-memory-graph-truncated": "1",
                    children: "truncated",
                  })
                : null,
              jsx.jsxs("svg", {
                "data-penglai-memory-graph-svg": "1",
                width: "360",
                height: "220",
                viewBox: "0 0 360 220",
                children: [
                  (v.graph.edges || []).slice(0, 64).map((edge, index) => {
                    const nodes = v.graph.nodes || [];
                    const from = nodes.findIndex((n) => n.id === edge.from);
                    const to = nodes.findIndex((n) => n.id === edge.to);
                    if (from < 0 || to < 0) return null;
                    const x1 = 24 + (from % 8) * 42;
                    const y1 = 24 + Math.floor(from / 8) * 52;
                    const x2 = 24 + (to % 8) * 42;
                    const y2 = 24 + Math.floor(to / 8) * 52;
                    return jsx.jsx(
                      "line",
                      {
                        x1,
                        y1,
                        x2,
                        y2,
                        stroke: "#888",
                        strokeWidth: "1",
                      },
                      `${edge.from}-${edge.to}-${index}`,
                    );
                  }),
                  (v.graph.nodes || []).slice(0, 24).map((node, index) =>
                    jsx.jsxs(
                      "g",
                      {
                        children: [
                          jsx.jsx("circle", {
                            cx: 24 + (index % 8) * 42,
                            cy: 24 + Math.floor(index / 8) * 52,
                            r: 8,
                            fill: node.scope === "personal" ? "#5b8" : "#58b",
                            onClick: () => {
                              set((x) => ({ ...x, selectedId: String(node.id) }));
                              run("why", {
                                id: String(node.id),
                                ...(v.scope === "workspace" ? { workspaceId: v.workspaceId } : {}),
                              });
                            },
                          }),
                          jsx.jsx("title", { children: String(node.summary || node.id) }),
                        ],
                      },
                      node.id,
                    ),
                  ),
                ],
              }),
            ],
          }),
          jsx.jsx("input", {
            "data-penglai-memory-correct": "1",
            value: v.correctText,
            placeholder: t.correct,
            onChange: (e) => set((x) => ({ ...x, correctText: String(e.target.value) })),
          }),
          jsx.jsx("button", {
            type: "button",
            disabled: !v.selectedId || !v.correctText.trim(),
            onClick: () =>
              run("correct", {
                id: v.selectedId,
                text: v.correctText,
                ...(v.scope === "workspace" ? { workspaceId: v.workspaceId } : {}),
              }),
            children: t.correct,
          }),
          jsx.jsx("button", {
            type: "button",
            "data-penglai-memory-import-preview": "1",
            onClick: () =>
              Promise.resolve(api.importPreview())
                .then(unwrap)
                .then((preview) =>
                  set((x) => ({
                    ...x,
                    importNote: preview ? JSON.stringify(preview) : t.empty,
                  })),
                )
                .catch((e) => set((x) => ({ ...x, error: message(e) }))),
            children: t.importPreview,
          }),
          jsx.jsx("button", {
            type: "button",
            "data-penglai-memory-import-confirm": "1",
            onClick: () => run("importConfirm", { ownerConfirmed: true }),
            children: t.importConfirm,
          }),
          v.importNote ? jsx.jsx("pre", { children: v.importNote }) : null,
          v.scope !== "candidate"
            ? jsx.jsxs("div", {
                children: [
                  jsx.jsx("textarea", {
                    value: v.text,
                    placeholder: t.text,
                    onChange: (e) =>
                      set((x) => ({
                        ...x,
                        text: String(e.target.value),
                        confirmed: false,
                      })),
                  }),
                  v.scope === "global"
                    ? jsx.jsxs(React.Fragment, {
                        children: [
                          jsx.jsxs("pre", { children: [t.diff, "\n", diff] }),
                          jsx.jsxs("label", {
                            children: [
                              jsx.jsx("input", {
                                type: "checkbox",
                                checked: v.confirmed,
                                onChange: (e) =>
                                  set((x) => ({
                                    ...x,
                                    confirmed: e.target.checked,
                                  })),
                              }),
                              t.confirm,
                            ],
                          }),
                        ],
                      })
                    : null,
                  jsx.jsx("button", {
                    type: "button",
                    disabled:
                      v.busy ||
                      !v.text.trim() ||
                      (v.scope === "global" && !v.confirmed) ||
                      (v.scope === "workspace" && !v.workspaceId),
                    onClick: () =>
                      run("write", {
                        scope: v.scope,
                        text: v.text,
                        ...(v.scope === "workspace"
                          ? { workspaceId: v.workspaceId }
                          : {}),
                        ...(v.scope === "global"
                          ? { ownerConfirmed: true, visibleDiff: diff }
                          : {}),
                      }),
                    children: t.add,
                  }),
                ],
              })
            : null,
          jsx.jsxs("label", {
            children: [
              jsx.jsx("input", {
                type: "checkbox",
                checked: v.deleteConfirmed,
                onChange: (e) =>
                  set((x) => ({ ...x, deleteConfirmed: e.target.checked })),
              }),
              t.delConfirm,
            ],
          }),
          jsx.jsx("button", {
            type: "button",
            disabled:
              v.busy ||
              !v.deleteConfirmed ||
              (v.scope === "workspace" && !v.workspaceId),
            onClick: () =>
              run("deleteScope", {
                scope: v.scope,
                workspaceId: v.workspaceId,
                ownerConfirmed: true,
              }),
            children: t.del,
          }),
          jsx.jsx("h4", { children: t.sop }),
          jsx.jsx("input", {
            value: v.skillName,
            placeholder: t.name,
            onChange: (e) =>
              set((x) => ({
                ...x,
                skillName: String(e.target.value),
                confirmed: false,
              })),
          }),
          jsx.jsx("input", {
            value: v.skillDescription,
            placeholder: t.description,
            onChange: (e) =>
              set((x) => ({
                ...x,
                skillDescription: String(e.target.value),
                confirmed: false,
              })),
          }),
          jsx.jsx("textarea", {
            value: v.skillBody,
            placeholder: t.body,
            onChange: (e) =>
              set((x) => ({
                ...x,
                skillBody: String(e.target.value),
                confirmed: false,
              })),
          }),
          jsx.jsxs("pre", {
            children: [t.diff, "\n+ skills/", v.skillName || "…", "/SKILL.md"],
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
              !v.skillName ||
              !v.skillDescription ||
              !v.skillBody,
            onClick: () =>
              run(
                "promoteSop",
                {
                  name: v.skillName,
                  description: v.skillDescription,
                  body: v.skillBody,
                  visibleDiff: `+ skills/${v.skillName}/SKILL.md`,
                  ownerConfirmed: true,
                },
                "official-dsh-skills",
              ),
            children: t.promote,
          }),
          v.busy ? jsx.jsx("p", { children: t.busy }) : null,
          v.notice
            ? jsx.jsx("p", { role: "status", children: v.notice })
            : null,
          v.error ? jsx.jsx("p", { role: "alert", children: v.error }) : null,
        ],
      });
    }
    function MemorySettingsSection(props) {
      return jsx.jsx("div", {
        className: "penglai-settings-page",
        "data-penglai-settings": "memory",
        children: jsx.jsxs(React.Fragment, {
          children: [
            jsx.jsx(MemoryTab, props),
            ContextModule?.ContextTab
              ? jsx.jsx(ContextModule.ContextTab, props)
              : null,
          ],
        }),
      });
    }
    async function apply(ctx) {
      const disposeRemote = await ctx.remote.$mount(REMOTE);
      const viewFiber = ctx.inject(
        ["slots", "remote.penglaiMemorySettings", "remote.penglaiContextSettings"],
        (viewCtx) => {
          const pageRemote = {
            penglaiMemorySettings: viewCtx.remote.penglaiMemorySettings,
            penglaiContextSettings: viewCtx.remote.penglaiContextSettings,
          };
          viewCtx.slots.inject("settings.section", () =>
            viewCtx.slots.register(
              {
                name: "settings.section",
                id: "penglai-memory",
                order: 18.5,
                label: () => copy().title,
                inject: () => ({ remote: pageRemote }),
              },
              MemorySettingsSection,
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
