# PenglaiAgent 0.5.1 公开发布合同

0.5.1 is a three-target community release of official DSH `0.1.1-rc.1`. Publication is authorized only after the merged `main` SHA produces native-verified Apple Silicon, Intel Mac, and Windows x64 installers, a signed immutable app Release, and a signed immutable Plugin Registry catalog.

The public Release must consume the exact bytes accepted by the three native runners. Cross-built artifacts, renamed architectures, missing target evidence, mutable Releases, unsigned update manifests, or an unpublished plugin registry cannot be promoted to PASS.

The live website and README must remain honest while the candidate is incomplete. Before `v0.5.1` publication they may describe source-tested work and NOT_RUN boundaries; only after remote asset readback may the website switch its primary download links from 0.5.0 to the three 0.5.1 installers.

0.5.0 users upgrade manually by overlay on Apple Silicon with the `Penglai/0.5` data root preserved. 0.5.1 establishes the trust root for signed same-platform assisted updates beginning with a later release. macOS remains ad-hoc and not notarized; Windows remains without Authenticode.
