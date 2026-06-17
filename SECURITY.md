# Security Policy

## Reporting a Vulnerability

Please do not post secrets, API keys, Feishu/WeChat credentials, cookies, private logs, or personal data in public issues.

To report a vulnerability, open a GitHub issue with sensitive values redacted, or contact the maintainer privately if the report requires non-public reproduction details. Include:

- affected PenglaiAgent version or commit
- install path, operating system, and runtime mode
- the smallest redacted reproduction you can provide
- whether the issue can expose `mykey.py`, `.env`, IM credentials, cookies, local files, or generated artifacts

Confirmed security-impacting fixes in upstream GenericAgent are evaluated for PenglaiAgent within 48 hours when they affect this distribution.
