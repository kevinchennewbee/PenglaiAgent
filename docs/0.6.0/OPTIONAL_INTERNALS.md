# Optional internals probing vs required native capability

Native Loongson execution is unrun. This is architecture-static policy from
official DSH `0.1.5-alpha.1` (`5dda764e…`) and Penglai production sources.
It is not a native UOS PASS.

## Official loader (npm `@deepseek-ai/cordis-plugin-loader` 1.0.3)

`node-addon-require-builtin` is an **optional peer**.
`ModuleLoader.requireInternal` tries `--expose-internals`, then the addon,
and **swallows both failures**. `fromInternal()` returns `undefined` when
the probe is empty. Plugin import then uses public `import(name)`.

The published JS package loads `createEntryApi` at module scope. The
unpublished name `node-addon-require-builtin-linux-loong64-gnu` is what a
glibc loong64 host would request. Official optionalDependencies list
darwin, linux-x64/arm64-gnu, and win32 only. Do not invent that package.

## HMR

`@deepseek-ai/cordis-plugin-hmr` throws if `loader.internal` is missing.
`@deepseek-ai/dsh-base` ships HMR `disabled: true`. Official `web` template
defaults `patchReload: live`, which would mount a watch-only HMR instance
after boot and fail closed without internals.

Penglai never passes `--expose-internals` (Electron also fuses off
`NODE_OPTIONS`). The product web profile is pinned to official
`patchReload: "startup"`. Plugin Center enable/disable/update uses the
loader public API (`create` / `update`), not HMR. Office and Memory stay
required-builtin.

## Packaging

| Class | Examples | linux-loong64 |
| --- | --- | --- |
| Required native capability | flock, pty, koffi, sharp, chrome-sandbox | still fail-closed when missing |
| Optional internals probing | require-builtin native | unpublished; omit; do not fabricate |

Mac/Windows still require the published require-builtin native packages.

## 中文

`require-builtin` 是官方可选 internals 探测，不是冻结启动的必装原生依赖。
未发布的 `node-addon-require-builtin-linux-loong64-gnu` 不得编造。蓬莱产品
web 配置使用官方 `patchReload: startup`。 flock / pty / koffi / sharp 仍为
必装原生能力。UOS 安装/启动/功能仍为 `OWNER_POST_RELEASE`。
