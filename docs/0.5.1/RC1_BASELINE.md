# Penglai 0.5.1 rc.1 implementation baseline

Recorded 2026-08-21 before DSH `0.1.1-rc.1` migration. Do not treat this file as a freeze.

## Git

- Branch: `0.5.1` (not pushed)
- HEAD: `4d11d970b58eaeb37479d062cc84efc4570d2eba`
- Ahead of `main` (`ebfea25`): 8 commits
- Remotes: `origin` = `kevinchennewbee/PenglaiAgent`; `private` = `penglai-new`; `fork`/`upstream` GenericAgent
- Dirty at start: 22 tracked `tsconfig.tsbuildinfo` files from local typecheck. Those files stay on disk; they are removed from Git tracking in a dedicated chore commit. No `reset`/`stash`/`clean`.

## Product identity at baseline

- Penglai `0.5.1`
- DSH pin still `0.1.0-rc.8` / commit `141eb6fef83422698aef7a981029e843e8161534`
- Release targets: Apple Silicon only
- Publication channel: `NOT_PUBLISHED_0_5_1`

## Next gates

1. Untrack build info; clean-clone via real local clone.
2. Freeze `@deepseek-ai/dsh@0.1.1-rc.1` from live npm (integrity + shasum). GitHub tag/Release for rc.1 is **not assumed**.
3. Migrate kernel/profile/plugins; then real onboarding, PPDP loader, PUDP, three-target packaging.
4. No push/tag/Release in this pass.
