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
      id: `@penglai/office#penglaiOffice/${method}`,
      service: "penglaiOffice",
      namespace: "penglaiOffice",
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
      descriptors: ["health", "inspect", "create", "edit", "preview", "approve", "commit"].map((method) =>
        remoteDescriptor(method, method !== "health"),
      ),
    };
    const COPY = {
      zh: {
        title: "蓬莱办公",
        hint: "读取、创建，并用格式专属操作编辑 DOCX、XLSX、PPTX 与 PDF。PDF 不嵌入中文正文。提交需要 Owner 收据。",
        create: "创建",
        inspect: "查看",
        edit: "目标修改",
        result: "结果",
      },
      en: {
        title: "Penglai Office",
        hint: "Inspect, create, and apply typed operations to DOCX, XLSX, PPTX, and PDF. PDF does not embed CJK body text. Commit requires an Owner receipt.",
        create: "Create",
        inspect: "Inspect",
        edit: "Targeted edit",
        result: "Result",
      },
    };
    function localeCopy() {
      const lang = String(document?.documentElement?.lang ?? "zh");
      return COPY[lang.startsWith("en") ? "en" : "zh"];
    }
    function unwrapRemote(result) {
      if (result && typeof result === "object" && "ok" in result) {
        if (result.ok === false)
          throw new Error((result.error && result.error.message) || "remote");
        return result.value;
      }
      return result;
    }

    function OfficeSection({ remote }) {
      const t = localeCopy();
      const api = remote?.penglaiOffice;
      const [view, setView] = React.useState({
        format: "docx",
        text: "",
        replacement: "",
        bytesBase64: "",
        result: "",
        error: "",
      });
      const run = (method, input) => {
        if (!api?.[method]) return;
        setView((current) => ({ ...current, error: "" }));
        Promise.resolve(api[method](input))
          .then((value) => {
            const out = unwrapRemote(value);
            setView((current) => ({
              ...current,
              bytesBase64: String(out.bytesBase64 ?? current.bytesBase64),
              result: String(out.text ?? JSON.stringify(out)),
            }));
          })
          .catch((error) => {
            setView((current) => ({
              ...current,
              error: String(error && error.message ? error.message : error),
            }));
          });
      };
      return jsx.jsxs("section", {
        className: "penglai-settings-page",
        "data-penglai-office": "1",
        "data-penglai-settings": "office",
        children: [
          jsx.jsx("p", { children: t.hint }),
          jsx.jsx("select", {
            "data-penglai-office-format": "1",
            value: view.format,
            onChange: (event) =>
              setView((current) => ({ ...current, format: event.target.value })),
            children: ["docx", "xlsx", "pptx", "pdf"].map((format) =>
              jsx.jsx("option", { value: format, children: format }, format),
            ),
          }),
          jsx.jsx("textarea", {
            "data-penglai-office-text": "1",
            value: view.text,
            onChange: (event) =>
              setView((current) => ({ ...current, text: event.target.value })),
          }),
          jsx.jsx("button", {
            type: "button",
            "data-penglai-office-create": "1",
            onClick: () => run("create", { format: view.format, text: view.text }),
            children: t.create,
          }),
          jsx.jsx("button", {
            type: "button",
            "data-penglai-office-inspect": "1",
            onClick: () => run("inspect", { bytesBase64: view.bytesBase64 }),
            children: t.inspect,
          }),
          jsx.jsx("input", {
            "data-penglai-office-replacement": "1",
            value: view.replacement,
            onChange: (event) =>
              setView((current) => ({
                ...current,
                replacement: event.target.value,
              })),
          }),
          jsx.jsx("button", {
            type: "button",
            "data-penglai-office-edit": "1",
            onClick: () =>
              run("edit", {
                bytesBase64: view.bytesBase64,
                format: view.format,
                replacement: view.replacement,
                operation:
                  view.format === "xlsx"
                    ? { kind: "xlsx.setCell", cell: "B1", value: view.replacement }
                    : view.format === "pptx"
                      ? { kind: "pptx.replaceSlideText", slideIndex: 0, text: view.replacement }
                      : view.format === "pdf"
                        ? { kind: "pdf.watermark", text: view.replacement }
                        : { kind: "docx.replaceParagraph", paragraphIndex: 0, text: view.replacement },
              }),
            children: t.edit,
          }),
          jsx.jsx("pre", {
            "data-penglai-office-result": "1",
            children: view.error || view.result,
          }),
        ],
      });
    }

    async function apply(ctx) {
      const disposeRemote = await ctx.remote.$mount(REMOTE);
      const viewFiber = ctx.inject(
        ["slots", "remote.penglaiOffice"],
        (viewCtx) => {
          const pageRemote = { penglaiOffice: viewCtx.remote.penglaiOffice };
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
