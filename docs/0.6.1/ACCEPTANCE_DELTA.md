# Penglai 0.6.1 acceptance delta

This delta is for Penglai **0.6.1**. It does not replace
`docs/0.6.0/ACCEPTANCE_DELTA.md` or earlier versioned deltas. Published
**v0.5.10**, **v0.5.11**, **v0.5.12**, and **v0.6.0** tags and assets stay
immutable.

Owner authorization: 2026-09-10, reaffirmed for the full 0.6.1 publication
workflow. Codex is PM and GUI acceptance operator and independently accepts
consequential evidence. Grok 4.6 xhigh owns product implementation, source
technical review, and ordinary repair. This worker phase ends at local source
plus the current native-lifecycle contract. Later manager-reviewed phases own
PR/main freeze, the exact four-target native set, immutable publication, and
public-byte readback. Per-phase source-only limits are sequencing, not a new
authorization question.

Public README and website download tables remain on immutable `v0.6.0` until
immutable `v0.6.1` GitHub Release bytes exist. Staged 0.6.1 public copy lives
in `docs/0.6.1/` and is not a public download claim.

## In scope

- Official DSH successor freeze: complete npm `0.1.5-rc.1` with exact registry
  integrity. Tag `dsh-v0.1.5-rc.1`, commit
  `183f08e9c6dde7e36cd2318eaee70b0da08fb35e`. Package count is discovered from
  the actual graph (279). Mixed DSH generations are forbidden. Dist-tags at pin
  time: `next=0.1.5-rc.1`, `alpha=0.1.5-alpha.2`, `latest=0.1.2-rc.1`. Penglai
  does not silently follow `latest` or consume `alpha.2`.
- Class-level repairs with regression tests: IM completed-turn cold-session
  recovery through official `SessionHandle` / inspect; `describeSessionModels`
  existence proof; runtime HTTP liveness bound to current process inventory;
  native aggregate and publication input for exact four targets and eleven
  assets; UOS Node closure identity and dependency/preflight truth; signed
  catalog identity+digest plugin preservation; official `deepseek-flash`
  onboarding without model-id exceptions.
- Desktop workspace directory selection uses the official DSH browse
  interaction (`dsh-host-directory-picker-browse` plus
  `dsh-client-ui-directory-picker-browse`) pinned in the product web overlay.
  Auto would mount Darwin `osascript choose folder` from the embedded DSH Node
  child with a renderless client face. Browse keeps Add workspace and the
  new-conversation flow visible and cancelable inside Penglai, on official
  workspace adoption/permission. The wizard Owner folder picker stays
  wizard-only. Cohort bytes stay exact; no upstream patch or parallel picker.
- IM 0.6.1 current-dsh-im adaptation (D-072): WeChat/Feishu inbound non-image
  files onto official `FileBlock`; online bot aliases from unpublished
  `606ced1` (not npm 4.18.1 bytes); official RemoteError/preset classification;
  optional Darwin-only iMessage private text default off. Telegram Rich Draft,
  dsh-im management HTTP, WhatsApp, wecom-app, and Office-as-IM stay out.
- Four targets remain `darwin-aarch64`, `darwin-x86_64`, `win32-x86_64`,
  `linux-loong64` UOS 20 old-world. Deterministic `test:soak` remains required.
  Two-hour installed soak remains excluded. Old-version installed upgrade
  acceptance is `OWNER_EXCLUDED`; the current workflow does not fetch previous
  installers and must not relabel unrun upgrades PASS. Current Mac/Windows
  native lifecycle is `verify:fresh-install-uninstall`: exact candidate
  installer SHA, clean source SHA, isolated dedicated destination, fresh boot,
  restart/resume, process cleanup, default NSIS/Mac uninstall, and independent
  owner-data preservation. UOS native install/startup/function is
  `OWNER_POST_RELEASE`: Owner will test the published installer. Package/ABI
  evidence is distinct and still required. The 0.6.0 UOS `OWNER_POST_RELEASE`
  record is not a 0.6.1 native PASS and is not a blanket future exception.
  Four exact targets remain required. Credential-free wizard-to-API-boundary
  evidence needs no personal account credentials; real provider-account
  acceptance stays supplemental per `docs/ACCEPTANCE.md`.

## Out of scope for this source phase

- PR, `main` merge, four-target native CI dispatch, release tag, asset upload,
  or website public-byte deploy.
- Live IM messages and Owner/PM live credential tests.
- Claiming UOS native install/startup/function PASS.
- Rewriting published 0.5.x or 0.6.0 tags, assets, or historical docs.

## Cohort freeze (development)

Development pins match `packages/release-identity/src/pins.ts`,
`release-contract.json`, `release-info.json`, and
`docs/0.6.1/DSH_NPM_COHORT.json`: official DSH `0.1.5-rc.1` /
`183f08e9…` / 279 packages. Experimental Agent Teams packages are in the
complete npm graph and are not enabled in the Penglai product profile.
