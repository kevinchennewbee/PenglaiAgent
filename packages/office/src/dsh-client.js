window.__ModuleLoader__.load({
  id: "@penglai/office",
  factory: (require) => {
    const module = { exports: {} };
    const React = require("react");
    const jsx = require("react/jsx-runtime");
    const inject = ["remote"];
    function apply(ctx) {
      ctx.slots.define({
        id: "penglai-office",
        slot: "settings.section",
        order: 46,
        render: () =>
          jsx.jsx("section", {
            "data-penglai-office": "1",
            children: "Penglai Office",
          }),
      });
    }
    module.exports = { apply, inject };
    return module.exports;
  },
});
