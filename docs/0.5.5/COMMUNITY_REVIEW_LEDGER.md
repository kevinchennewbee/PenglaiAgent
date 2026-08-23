# Penglai 0.5.5 community review ledger

Candidates are not user-visible until `verdict: APPROVED`. Fresh profile does not load them.

| Candidate | repo | commit | license | DSH exact | verdict | reason |
|---|---|---|---|---|---|---|
| AnySearch | anysearch-team/anysearch-dsh | dce7a51c74b80f8fa51e53f510a572ab6dd60f28 | MIT | pending rc.2 installed | QUARANTINED | needs official credentials, network allowlist, and rc.2 installed PASS |
| Notification | omdsh-dev/dsh-notification | 0.1.3 | MIT | pending rc.2 installed | QUARANTINED | permission prompt and no-body-leak not proven on Penglai |
| Vision Router | ysr666/dsh-vision-router | latest | MIT | pending | QUARANTINED | CI failure + image exfil risk |
| Checkpoint Rewind | PerryLink/dsh-checkpoint-rewind | main | Apache-2.0 | pending | QUARANTINED | Git/disk budget and restore approval not wired |

Pipe-to-shell installs are forbidden. Community plugins stay out of the 0.5.5 client catalog.
