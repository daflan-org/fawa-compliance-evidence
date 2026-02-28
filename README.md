# fawa-compliance-evidence

Public, machine-readable compliance evidence for Fawa.

## Repository Layout

- `schemas/evidence.schema.json`: canonical JSON schema for published evidence payloads.
- `current/evidence.json`: latest public evidence snapshot consumed by web clients.
- `current/trust-evidence.md`: latest trust/compliance summary.
- `current/store-compliance.md`: latest store-compliance summary.
- `current/tests/*.json|*.junit.xml`: sanitized compliance test evidence reports.
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
yarn policy:build-input && \
conftest test policy-input.json -p policy/repo
```

```bash
curl -fsSL "https://raw.githubusercontent.com/daflan-org/fawa-compliance-evidence/main/current/evidence.json" \
  -o /tmp/evidence.json

TEST_ID="ttl-indexes-persistence-unit"
ARTIFACT_PATH=$(jq -r --arg id "$TEST_ID" '.testEvidence[] | select(.testId==$id) | .artifacts[] | select(.format=="json") | .path' /tmp/evidence.json)
ARTIFACT_SHA=$(jq -r --arg id "$TEST_ID" '.testEvidence[] | select(.testId==$id) | .artifacts[] | select(.format=="json") | .sha256' /tmp/evidence.json)

curl -fsSL "https://raw.githubusercontent.com/daflan-org/fawa-compliance-evidence/main/${ARTIFACT_PATH}" -o /tmp/test-evidence.json
echo "${ARTIFACT_SHA}  /tmp/test-evidence.json" | shasum -a 256 -c -
```

## Publishing Model

This repository is updated automatically by Falcon CI/CD via GitHub App authentication.
