# fawa-compliance-evidence

Public, machine-readable compliance evidence for Fawa.

## Repository Layout

- `schemas/evidence.schema.json`: canonical JSON schema for published evidence payloads.
- `current/evidence.json`: latest public evidence snapshot consumed by web clients.
- `current/trust-evidence.md`: latest trust/compliance summary.
- `current/store-compliance.md`: latest store-compliance summary.
- `history/<timestamp>-<sha>/`: immutable historical snapshots.

## Verification Examples

```bash
cosign verify ghcr.io/<org>/<image>@sha256:<digest> \
  --certificate-identity-regexp "https://github.com/<org>/falcon/.github/workflows/.*" \
  --certificate-oidc-issuer "https://token.actions.githubusercontent.com"
```

```bash
cosign verify-attestation ghcr.io/<org>/<image>@sha256:<digest> \
  --certificate-identity-regexp "https://github.com/<org>/falcon/.github/workflows/.*" \
  --certificate-oidc-issuer "https://token.actions.githubusercontent.com"
```

```bash
CHANGED_FILES_JSON='["packages/socket-contracts/src/app-events.ts"]' \
GITHUB_REF_NAME='daf-418-store-compliance-backend-evidence-for-daf-307' \
GITHUB_EVENT_NAME='pull_request' \
node scripts/policy/build-policy-input.mjs && \
conftest test policy-input.json -p policy/repo
```

## Publishing Model

This repository is updated automatically by Falcon CI/CD via GitHub App authentication.
