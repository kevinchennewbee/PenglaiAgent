# 0.6.0 native/lifecycle and publication plan

Execute **after** UOS old-world addon integration lands on one clean `main`
SHA. Do not dispatch native or publish workflows from this draft.

## Frozen SHA

All four installers, evidence, notes and both websites must use the same
`origin/main` commit. Do not rebuild Mac/Windows solely because version
strings moved; rebuild because that SHA contains the UOS payload and every
required provenance change.

Current development HEAD at this plan: `6d7b5917` plus this prep branch.
Final freeze SHA is **not** `6d7b5917` once addons merge.

## Dispatch once the freeze SHA is origin/main

Do this only after the addon `MANIFEST.json` is integrated and that merge
is `origin/main`. Do not dispatch from this prep PR.

```bash
# Confirm freeze identity first.
git fetch origin main
git rev-parse origin/main   # must equal the addon-integration merge SHA

# Four-target native/packaging set. Intel Mac uses macos-15-intel;
# Windows uses windows-2022. linux-loong64 packages only.
gh workflow run native-release-candidate.yml --ref main -f mode=native
```

Expected native jobs: `darwin-aarch64`, `darwin-x86_64`, `win32-x86_64`
(installed e2e, upgrade from published 0.5.12, default uninstall).
Expected packaging job: `linux-loong64` `.deb` +
`local-installer-linux-loong64.json` (`native: false`). Aggregate then
`verify:native-set` on Mac/Windows only and `verify:release`.

Do **not** run `deploy-website.yml` or `publish-release.yml` from this
step. Those stay blocked until the Electron 31.7.7 shipping decision and
immutable public bytes. 0.5.12 native evidence must not be relabeled.

## What is already accepted (do not rerun)

- PM ARM candidate `6d7b5917` zip `59738af2…`: same-path original 0.5.12
  profile upgrade PASS (sessions, custom Flash 4.1, credentials, attachment
  preview, quit/relaunch).
- f8ca9446 fresh install: invalid credential recovery, workspace error
  clearance, custom Flash 4.1 vision, restart persistence.
- Source CI / CodeQL on merged 0.6.0 identity and upgrade-copy PRs.

0.5.12 native evidence must not be relabeled as 0.6.0 runtime acceptance.

## Mac/Windows (native required)

Dispatch `.github/workflows/native-release-candidate.yml` `mode=native` on
the frozen SHA only.

| Target | Host | Installer | Gates |
| --- | --- | --- | --- |
| darwin-aarch64 | macos-15 | `Penglai_0.6.0_macos_aarch64.dmg` | public-export, build, closure, artifact, fuses, signing, profile matrix, installed e2e, u3 welcome/plugins, upgrade-uninstall from 0.5.12 |
| darwin-x86_64 | macos-15-intel | `Penglai_0.6.0_macos_x64.dmg` | same |
| win32-x86_64 | windows-2022 | `Penglai_0.6.0_windows_x64_setup.exe` | same + ZH NSIS UI proof; observe Defender, do not mutate |

Previous upgrade sources: published 0.5.12 installers.

## linux-loong64 (packaging required; native OWNER_POST_RELEASE)

Workflow job `linux` runs `pnpm build` then `pnpm package:linux-deb`. It
must fail closed without the full old-world payload (DSH 272, Node 22.16.0,
flock, pty, koffi, sharp, chrome-sandbox). require-builtin native is optional
internals and unpublished on loong64; Mac/Windows still require the published
packages. It must not run
`test:e2e:installed` or `verify:upgrade-uninstall`.

Owner native install/startup/function on UOS 20 Professional 1070 stays
`OWNER_POST_RELEASE`. No remote-access gate.

## Publication (blocked until all of the below)

1. Four contract installers from the frozen SHA.
2. Electron 31.7.7 shipping decision recorded by PM (disclosure vs hold).
   Source integration is not that acceptance.
3. Edit existing `website/{index,en/index,zh/index}.html` in place
   (English first, Chinese second) in the publication commit after
   public bytes exist. Bind installer names, sizes and SHA-256 to
   read-back bytes. `docs/0.6.0/website-draft/` is copy-deck for the
   limits/download section, not a tree to rsync over `website/`.
   Do not merge live download tables to 0.6.0 earlier.
4. `workflow_dispatch` `deploy-website.yml` with `tag=v0.6.0` after the
   GitHub Release exists. Do not auto-publish from this prep PR.
5. Never rewrite v0.5.10 / v0.5.11 / v0.5.12.

## Addon integration handoff

A separate old-world addon worker owns koffi and sharp (+ libvips).
`node-addon-require-builtin` native is optional internals and unpublished
on loong64; do not copy or fabricate it. This repo waits for the worker
`MANIFEST.json` for required natives. Do not duplicate those builds here.
