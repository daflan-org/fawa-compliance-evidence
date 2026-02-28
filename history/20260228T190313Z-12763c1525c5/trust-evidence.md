# Trust And Compliance Evidence

Bu sayfa, 3rd-party tarafindan bagimsiz dogrulanabilir teknik compliance kanitlarini toplar.

## Ne Yayinliyoruz

- OPA/Conftest policy gate sonucunun CI artifact'i
- Build edilen container image digest degerleri
- Cosign imza ve attestasyon dogrulama komutlari
- Store-compliance backend evidence notu

Detayli backend kanitlari:

- `docs/STORE_COMPLIANCE_BACKEND_EVIDENCE_DAF-418.md`

## OPA/Conftest Dogrulama

CI workflow:

- `.github/workflows/ci-tests.yml`

Policy:

- `policy/repo/ci.rego`

Input builder:

- `scripts/policy/build-policy-input.mjs`

## Cosign Dogrulama

Sign/attest edilen workflow'lar:

- `.github/workflows/deploy-preprod.yml`
- `.github/workflows/deploy-prod.yml`
- `.github/workflows/deploy-worker-preprod.yml`
- `.github/workflows/deploy-worker-prod.yml`

Ornek:

```bash
cosign verify ghcr.io/<org>/<image>@sha256:<digest> \
  --certificate-identity-regexp "https://github.com/<org>/falcon/.github/workflows/.*" \
  --certificate-oidc-issuer "https://token.actions.githubusercontent.com"
```

## Web Public Page Notu

Bu repo teknik kaynak kanitlarini tutar. Müşteriye acik web sayfasi farkli bir repoda ise bu dosya kaynak referans olarak kullanilmalidir.
