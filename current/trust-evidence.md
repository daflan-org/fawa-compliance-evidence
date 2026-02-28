# Trust And Compliance Evidence

This public snapshot summarizes verifiable controls from Falcon.

## Included Controls

- Policy-as-code gate: OPA + Conftest
- Signed images and attestations: Sigstore Cosign
- Public evidence payload schema and generated metadata

## Source Paths

- `.github/workflows/ci-tests.yml`
- `policy/repo/ci.rego`
- `scripts/policy/build-policy-input.mjs`
- `.github/workflows/deploy-preprod.yml`
- `.github/workflows/deploy-prod.yml`
- `.github/workflows/deploy-worker-preprod.yml`
- `.github/workflows/deploy-worker-prod.yml`
