# Penglai 0.5.2 three-target release runbook

1. From a clean `main` equal to `origin/main`, run all source, contract, security, identity, dependency, export, secret, and release-key gates.
2. On native Apple Silicon, Intel Mac, and Windows x64 runners, build the exact installer named in `release-contract.json`; run installed welcome/process and first-party-plugin compatibility checks against that installer.
3. On Apple Silicon, install the candidate over the real completed 0.5.1 data generation and verify it enters official DSH Web. Then run one clean onboarding with the temporary BYOK through model test, Workspace, first official Turn, and final transition. Record only redacted verdicts and digests.
4. Collect the three installer bytes without rebuilding. Create `release-manifest.json`, SBOM, notices, public-export manifest, and detached signatures. Create `update-manifest-v1.json` with `minimumSourceVersion: 0.5.1`, then sign its exact bytes using the existing offline updater key.
5. Create a draft `v0.5.2` Release, upload the exact ten assets, verify names, sizes, hashes, signatures, source SHA, and target architectures, then publish immutable.
6. Reinstall the exact public 0.5.1 Apple Silicon app without deleting `Penglai/0.5`. Through its own updater, discover, download, verify, confirm, and install the public 0.5.2 DMG. Verify the installed version, official DSH Web, preserved Workspace, preserved onboarding facts, and update ledger.
7. Run remote immutable read-back. Only then update README/website current-download links and publication evidence. Remove the temporary provider credential from local storage and ask the owner to revoke it.

Any failed hard gate stops publication. Cross-build or source-only evidence cannot be reported as native installed PASS.
