# Security policy

ApplyOnce handles students' personal and financial details. Treat every report seriously.

**Please do not open a public issue for a vulnerability.** Email the maintainer via the address on the GitHub profile of [@LSUDOKO](https://github.com/LSUDOKO), or use GitHub's private vulnerability reporting on this repository.

In scope:
- Any way to make a tool submit, pay, or click a final action control.
- Any path by which profile data (Aadhaar, PAN, bank, documents) leaves the local machine or appears unmasked in logs or tool responses.
- Credential handling, session misuse, or circumvention of the anti-bot stop behaviour.

Dependencies are audited weekly. Production dependencies must carry zero known vulnerabilities; the `security` workflow blocks merges otherwise.
