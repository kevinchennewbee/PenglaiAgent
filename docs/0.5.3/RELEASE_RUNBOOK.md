# Penglai 0.5.3 three-target release runbook

1. From a clean `main` equal to `origin/main`, run every source, contract, security, identity, dependency, export, secret, and release-key gate.
2. Prove the regression at coordinator level: default-disabled IM commits after all core facts pass; failed core facts remain closed; a newer manual overlay reconciles a superseded 0.5.2 recovery journal without writing a false signed ledger.
3. On the local Apple Silicon host, install the exact candidate over the retained affected 0.5.2 profile and verify the stale recovery state becomes current. Separately exercise the candidate with the retained completed 0.5.1 data and verify official DSH Web, Workspace, and onboarding facts remain usable.
4. On native Apple Silicon, Intel Mac, and Windows x64 runners, build the exact installer named in `release-contract.json`; run installed welcome/process and the four-phase seven-plugin compatibility check against that installer.
5. Collect the three installer bytes without rebuilding. Create `release-manifest.json`, SBOM, notices, public-export manifest, and detached installer signatures. Create and sign `update-manifest-v1.json` with `minimumSourceVersion: 0.5.1`.
6. Create draft Release `v0.5.3`, upload exactly ten assets, and verify names, sizes, hashes, signatures, source SHA, public-export tree, release-manifest binding, and target architectures. Publish immutable only after every pre-publication gate is green.
7. Restore the untouched public 0.5.1 Apple Silicon app and completed data. Through its own updater, discover, download, verify, confirm, and install public 0.5.3. Verify installed version, official DSH Web, preserved Workspace/onboarding facts, default-disabled optional plugins, and a `COMMITTED` ledger.
8. Run remote immutable read-back. Only then update README and the bilingual website with the final links, hashes, run evidence, correction notice, and screenshots from the released 0.5.3 application.
9. Remove the temporary provider credential from live data and every exact test backup, clear in-memory copies, run the final secret/privacy scan, and ask the owner to revoke the credential.

Any failed hard gate stops publication. Cross-build, source-only, draft, or simulated evidence cannot be reported as public native installed PASS.
