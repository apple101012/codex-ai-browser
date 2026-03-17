# Security Notes

This project is built to be safe to publish publicly, but browser automation is inherently high-risk. Use these controls before any internet-facing deployment.

## Included Safeguards

- Optional bearer token auth (`API_TOKEN`)
- Localhost defaults (`127.0.0.1`)
- Runtime/profile artifacts excluded from git
- `evaluate` command disabled by default
- Per-profile storage isolation
- Command-level error handling with explicit success/failure result reporting

## Recommended Production Hardening

- Put API behind a reverse proxy with TLS and strong auth.
- Use allowlists for target domains and network egress.
- Add explicit approval gates for high-risk actions (payments, account changes).
- Encrypt profile storage at rest.
- Add immutable audit logs for command history and outputs.
- Run browser workers in sandboxed containers/VMs.
- Rotate proxy credentials and API tokens regularly.

## Prompt-Injection Safety

- Treat webpage content as untrusted.
- Separate planning and execution stages.
- Validate all high-impact actions through policy before execution.

