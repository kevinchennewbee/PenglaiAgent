# 0.6.0 native aggregate collector path

Native run [34376799819](https://github.com/kevinchennewbee/PenglaiAgent/actions/runs/34376799819) on freeze `7dd68b4ab08bbe4edf4dfac7f82abb6b164cb316`:

| Job | Conclusion |
| --- | --- |
| npm cohort | SUCCESS |
| darwin-aarch64 | SUCCESS |
| darwin-x86_64 | SUCCESS |
| win32-x86_64 | SUCCESS |
| linux-loong64 UOS `.deb` packaging | SUCCESS |
| Exact four-target evidence aggregate | FAILED |
| Signed Plugin Center distribution | skipped (`mode: native`) |

The aggregate job failed at `test -s .native/linux-loong64/Penglai_0.6.0_uos_loong64.deb`. Artifact `penglai-0.6.0-linux-loong64` stores `dist/Penglai_0.6.0_uos_loong64.deb` (SHA-256 `a541e9fa9b06626750b4a87859cc76ff3df51b5a0eb8960de08e8eba20cad430`, 292702128 bytes). This is a collector path defect, not a missing installer.

That GitHub aggregate job remains FAILED. It is not PASS and is not waived. Local collection of the four original artifacts produced `verify:release` PASS, `dryRun=false`, bound to the freeze SHA. This commit collects the `.deb` from anywhere under `.native/linux-loong64` so a later native run does not repeat the same collection failure. It does not rebuild 0.6.0 natives.
