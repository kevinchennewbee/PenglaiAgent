window.__ModuleLoader__.load({
  id: "@penglai/office",
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
        throw new TypeError("Office Remote requires bounded JSON");
      if (seen.has(value))
        throw new TypeError("Office Remote rejects cyclic JSON");
      seen.add(value);
      const entries = Array.isArray(value) ? value : Object.entries(value);
      if (entries.length > 4096)
        throw new TypeError("Office Remote JSON is too large");
      if (Array.isArray(value))
        value.forEach((item) => strictJson(item, depth + 1, seen));
      else
        for (const [key, item] of entries) {
          if (["__proto__", "prototype", "constructor"].includes(key))
            throw new TypeError("Office Remote rejects unsafe fields");
          strictJson(item, depth + 1, seen);
        }
      seen.delete(value);
      return value;
    }
    const remoteCodec = (kind) => ({
      mode: "strict",
      typeSymbol: `@penglai/office/client#${kind}`,
      schema: {
        parse(value) {
          if (
            kind === "input" &&
            (!value || typeof value !== "object" || Array.isArray(value))
          )
            throw new TypeError("Office Remote input must be an object");
          return value === undefined ? value : strictJson(value);
        },
      },
    });
    const remoteDescriptor = (method, hasInput = false) => ({
      id: `@penglai/office#penglaiOfficeSettings/${method}`,
      service: "penglaiOfficeSettings",
      namespace: "penglaiOfficeSettings",
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
      package: "@penglai/office",
      descriptors: ["health", "templates", "inspect", "create", "edit", "preview", "approve", "commit"].map((method) =>
        remoteDescriptor(method, method !== "health" && method !== "templates"),
      ),
    };
    const COPY = {
      zh: {
        title: "蓬莱办公",
        hint: "直接在对话里告诉蓬莱你要创建或修改什么。蓬莱会先给你预览，只有你确认后才保存或发回消息平台。",
        ready: "办公能力已就绪",
        unavailable: "办公能力暂时不可用",
        formats: "支持的文件",
        templates: "内置模板",
        examples: "可以这样对蓬莱说",
        safety: "文档默认留在本机；宏、嵌入程序、外部链接和加密文档会被拒绝。原文件不会被静默覆盖。",
        copied: "已复制到剪贴板",
        docx: "Word 文档",
        xlsx: "Excel 表格",
        pptx: "PowerPoint 演示",
        pdf: "PDF 文档",
      },
      en: {
        title: "Penglai Office",
        hint: "Tell Penglai what you want to create or change in chat. Penglai shows a preview first and saves or returns the file only after you confirm.",
        ready: "Office tools are ready",
        unavailable: "Office tools are temporarily unavailable",
        formats: "Supported files",
        templates: "Built-in templates",
        examples: "Try saying this to Penglai",
        safety: "Documents stay local by default. Macros, embedded programs, external links, and encrypted documents are refused. Original files are never silently overwritten.",
        copied: "Copied to clipboard",
        docx: "Word document",
        xlsx: "Excel workbook",
        pptx: "PowerPoint deck",
        pdf: "PDF document",
      },
    };
    function localeCopy() {
      const lang = String(document?.documentElement?.lang ?? "zh");
      return COPY[lang.startsWith("en") ? "en" : "zh"];
    }
    function unwrapRemote(result) {
      if (result && typeof result === "object" && "ok" in result) {
        if (result.ok === false) {
          const failure = result.error;
          if (failure?.isDSHRemoteError === true && typeof failure.code === "string") throw failure;
          if (failure instanceof Error) throw failure;
          throw new Error((failure && failure.message) || "remote");
        }
        return result.value;
      }
      return result;
    }

    function OfficeSection({ remote }) {
      const t = localeCopy();
      const api = remote?.penglaiOfficeSettings;
      const [view, setView] = React.useState({ status: "loading", templates: [], error: "", copied: "" });
      React.useEffect(() => {
        if (!api?.health || !api?.templates) {
          setView({ status: "error", templates: [], error: t.unavailable, copied: "" });
          return;
        }
        Promise.all([api.health(), api.templates()])
          .then(([health, templates]) => {
            const seen = unwrapRemote(health) || {};
            const rows = unwrapRemote(templates);
            setView({
              status: seen.state === "active" || seen.healthy === true ? "ready" : "error",
              templates: Array.isArray(rows) ? rows : [],
              error: "",
              copied: "",
            });
          })
          .catch(() => setView({
            status: "error",
            templates: [],
            error: t.unavailable,
            copied: "",
          }));
      }, [api]);
      const examples = String(document.documentElement.lang || "zh").startsWith("en")
        ? [
            "Create a project report in Word with a summary, progress, risks, and action table.",
            "Turn the attached data into a two-sheet Excel workbook and add a SUM formula.",
            "Create a five-slide product launch deck, show me the preview, and do not save yet.",
            "Merge the two attached PDFs and let me review the page count before saving.",
          ]
        : [
            "帮我创建一份项目周报 Word，包含摘要、进展、风险和行动项表格。",
            "把附件数据整理成两个工作表的 Excel，并添加合计公式。",
            "做一份 5 页产品发布 PPT，先给我预览，不要直接保存。",
            "合并这两个 PDF，先告诉我总页数，确认后再保存。",
          ];
      const copyExample = (text) => {
        const clipboard = typeof navigator !== "undefined" ? navigator.clipboard : undefined;
        if (!clipboard?.writeText) return;
        Promise.resolve(clipboard.writeText(text))
          .then(() => setView((current) => ({ ...current, copied: text })))
          .catch(() => undefined);
      };
      return jsx.jsxs("section", {
        className: "penglai-settings-page",
        "data-penglai-office": "1",
        "data-penglai-settings": "office",
        "data-penglai-office-status": view.status,
        children: [
          jsx.jsx("h3", { children: t.title }),
          jsx.jsx("p", { children: t.hint }),
          jsx.jsx("p", {
            role: "status",
            "aria-live": "polite",
            children: view.status === "ready" ? t.ready : view.status === "loading" ? "…" : t.unavailable,
          }),
          jsx.jsx("h4", { children: t.formats }),
          jsx.jsx("ul", {
            "data-penglai-office-formats": "1",
            className: "penglai-capability-grid",
            children: ["docx", "xlsx", "pptx", "pdf"].map((format) =>
              jsx.jsxs("li", {
                "data-penglai-office-format": format,
                children: [jsx.jsx("strong", { children: t[format] }), jsx.jsx("span", { children: ` .${format}` })],
              }, format),
            ),
          }),
          jsx.jsx("h4", { children: t.templates }),
          jsx.jsx("ul", {
            "data-penglai-office-templates": String(view.templates.length),
            children: view.templates.map((template) => jsx.jsx("li", {
              children: String(
                String(document.documentElement.lang || "zh").startsWith("en")
                  ? template.title?.en || template.id
                  : template.title?.["zh-CN"] || template.id,
              ),
            }, template.id)),
          }),
          jsx.jsx("h4", { children: t.examples }),
          jsx.jsx("ul", {
            children: examples.map((example, index) => jsx.jsx("li", {
              children: jsx.jsx("button", {
                type: "button",
                "data-penglai-office-example": String(index + 1),
                onClick: () => copyExample(example),
                children: example,
              }),
            }, example)),
          }),
          view.copied ? jsx.jsx("p", { role: "status", children: t.copied }) : null,
          jsx.jsx("p", { "data-penglai-office-safety": "1", children: t.safety }),
        ],
      });
    }

    async function apply(ctx) {
      const disposeRemote = await ctx.remote.$mount(REMOTE);
      const viewFiber = ctx.inject(
        ["slots", "remote.penglaiOfficeSettings"],
        (viewCtx) => {
          const pageRemote = { penglaiOfficeSettings: viewCtx.remote.penglaiOfficeSettings };
          viewCtx.slots.inject("settings.section", () =>
            viewCtx.slots.register(
              {
                name: "settings.section",
                id: "penglai-office",
                order: 18.1,
                label: () => localeCopy().title,
                inject: () => ({ remote: pageRemote }),
              },
              OfficeSection,
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
