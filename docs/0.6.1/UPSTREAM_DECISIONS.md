# Penglai 0.6.1 upstream decisions

Status: development freeze for 0.6.1 source work. Not a publication freeze.
Public download identity remains immutable `v0.6.0` until `v0.6.1` public
bytes exist.

Checked independently on 2026-09-10 against registry.npmjs.org and GitHub.

| Dependency | Published 0.6.0 pin | Probe (2026-09-10) | Decision |
| --- | --- | --- | --- |
| Official DSH | npm `0.1.5-alpha.1` / `dsh-v0.1.5-alpha.1` / `5dda764e…` / 272 packages | dist-tags `next=0.1.5-rc.1`, `alpha=0.1.5-alpha.2`, `latest=0.1.2-rc.1`. Root `@deepseek-ai/dsh@0.1.5-rc.1` integrity `sha512-rmNmzQCg3oIc1z8xH7izRSOuy1TNzq+/NILyfM+7e8DKOyV+yBtg47WEsqR2SiIe1ATec3L/rUa1YhIcfQ2XEg==`, shasum `6bcdb554bf2eef837666e37f5bd5fa494eb053e4`, tarball SHA-256 `1a79719f1c763918ac30e8194df783a9330c6b12d5f04c950731a3f8a1c3d9d0`. Tag commit `183f08e9c6dde7e36cd2318eaee70b0da08fb35e`, GitHub published 2026-09-10T03:09:00Z, npm 2026-09-10T03:12:53Z. rc.1 notes are cumulative since 0.1.2; actual diff is `dsh-v0.1.5-alpha.1...dsh-v0.1.5-rc.1`. Discovered cohort **279** (265 DSH + 9 vendor + 5 `node-addon-system@0.1.2`). Added `dsh-chunked-list`, `dsh-client-ui-sidebar-documentpreview`, `dsh-tool-present`, and experimental Agent Teams packages. Removed `dsh-client-ui-sidebar-textpreview`. Landlock run packages are still absent. | **Consume 0.1.5-rc.1** complete 279-package graph. Do not consume `alpha.2` or `latest`. Experimental Agent Teams stay in the graph and stay off in the Penglai profile. |
| Native DeepSeek adapter | `deepseek-v4-flash` / vision-exp catalog | Official adapter adds `DeepSeek-V41-Flash` (`deepseek-flash`) with text+image and in-history system-prompt updates; default for new Sessions; explicit existing settings stay authoritative. | **Consume the official adapter.** Fresh official onboarding lists/selects `deepseek-flash`. Preserve BYOK, custom IDs, and existing explicit models. Do not depend on temporary aliases. |
| DSH IM | rewrite-source `@xmanrui/dsh-im@4.17.1` | No new Owner-authorized IM runtime. Penglai remains `@penglai/im` through Connection `/api`. | **Keep rewrite integration.** No upstream dsh-im runtime, no extra `cordis.patch.yml` from dsh-im, no WhatsApp, no second Office. |
| Node / Electron / Mnemon / Office parsers | 0.6.0 pins | Unchanged majors. UOS Node remains vendor `22.16.0` old-world; Mac/Windows Node `22.23.2`. | **Keep.** Closure credential must record the actual target Node. |

## Freeze rule

After this inventory is written into `COHORT_FREEZE.json`, stop chasing newer
dist-tags for 0.6.1. A later DSH/IM release needs a new version authorization.
