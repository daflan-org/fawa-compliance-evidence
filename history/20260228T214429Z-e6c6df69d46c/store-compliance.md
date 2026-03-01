# DAF-418 Backend Evidence (DAF-307)

Bu dokuman, App Store / Play Store submission surecinde backend tarafi compliance kanitini tek yerde toplar.

## 1) Retention Enforcement Kaniti

- 90 gun retention: `family_activities.timestamp` TTL index
  - Kaynak: `packages/persistence/src/mongoose/activity/schemas/family-activity.schema.ts`
  - Tanim: `index: { expires: "90d" }`
- 30 gun retention:
  - `location_records.recordedAt`
  - `heartbeat_records.recordedAt`
  - Kaynaklar:
    - `packages/persistence/src/mongoose/device-sync/schemas/location-record.schema.ts`
    - `packages/persistence/src/mongoose/device-sync/schemas/heartbeat-record.schema.ts`
- Index olusumu: Mongoose `autoIndex: true`
  - Kaynak: `apps/api/src/modules/app.module.ts`

## 2) Privacy Veri Kategorileri -> Runtime Mapping

- Location (foreground/background):
  - API kabul noktasi: `POST /devices/sync/v1`
  - DTO: `DeviceSyncLocationDto.source`
  - Persistence: `location_records`
  - Socket: `FalconDeviceLocationUpdatedPayload`
- Notification state:
  - API: `DeviceSyncPermissionsDto.notifications`
  - Domain analizi: `PermissionAnalyzer`
  - Runtime event: `DeviceHealthChanged`
- Device activity sinyalleri:
  - API: heartbeat (`battery`, `network`, `low_power_mode`, `thermal_state`)
  - Persistence: `heartbeat_records`
- SOS payload:
  - API: `POST /device/sos/v1`
  - Domain event/workflow: `SosTriggeredEvent` -> workflow aktiviteleri
  - Audit: `DEVICE.SOS_TRIGGERED`

## 3) Test Kanitlari

- Device sync e2e:
  - `apps/api/test/device-sync.e2e.spec.ts`
- SOS e2e:
  - `apps/api/test/sos.e2e.spec.ts`
- Permission analyzer unit:
  - `packages/domain/src/device/services/permission-analyzer.service.spec.ts`
- TTL index coverage (unit):
  - `packages/persistence/src/mongoose/ttl-indexes.spec.ts`
  - `apps/api/src/schemas/ttl-indexes.spec.ts`

Public verifiable test kaniti:

- Public payload: `https://raw.githubusercontent.com/daflan-org/fawa-compliance-evidence/main/current/evidence.json`
- Public sanitize raporlar: `https://raw.githubusercontent.com/daflan-org/fawa-compliance-evidence/main/current/tests/`

Ornek dogrulama:

```bash
curl -fsSL "https://raw.githubusercontent.com/daflan-org/fawa-compliance-evidence/main/current/evidence.json" \
  -o /tmp/evidence.json

node -e 'const fs=require("fs");const e=JSON.parse(fs.readFileSync("/tmp/evidence.json","utf8"));const t=e.testEvidence.find(x=>x.testId==="ttl-indexes-persistence-unit");if(!t)throw new Error("test not found");const a=t.artifacts.find(x=>x.format==="json");console.log(a.path,a.sha256);'

curl -fsSL "https://raw.githubusercontent.com/daflan-org/fawa-compliance-evidence/main/current/tests/ttl-indexes-persistence-unit.json" \
  -o /tmp/ttl-indexes-persistence-unit.json

echo "<artifact_sha256_from_evidence_json>  /tmp/ttl-indexes-persistence-unit.json" | shasum -a 256 -c -
```

Cross-check:

- `evidence.json` icindeki `runId`, `jobName`, `sourceCommitSha` alanlarini CI run detayi ile karsilastirin.

## 4) Policy-as-Code Evidence (OPA/Conftest)

- Workflow: `.github/workflows/ci-tests.yml`
- Policy dosyasi: `policy/repo/ci.rego`
- Input olusturma: `scripts/policy/build-policy-input.ts`
- Artifact: `policy-input-<run_id>`

Lokal dogrulama:

```bash
CHANGED_FILES_JSON='["packages/socket-contracts/src/app-events.ts"]' \
GITHUB_REF_NAME='daf-418-store-compliance-backend-evidence-for-daf-307' \
GITHUB_EVENT_NAME='pull_request' \
yarn policy:build-input

conftest test policy-input.json -p policy/repo
```

## 5) Signed Attestation Evidence (cosign)

Deploy workflow'lari image digest uzerinden imza ve attestasyon uretir:

- `.github/workflows/deploy-preprod.yml`
- `.github/workflows/deploy-prod.yml`
- `.github/workflows/deploy-worker-preprod.yml`
- `.github/workflows/deploy-worker-prod.yml`

Ornek verify komutlari:

```bash
cosign verify ghcr.io/<org>/fawa-backend-api-preprod@sha256:<digest> \
  --certificate-identity-regexp "https://github.com/<org>/falcon/.github/workflows/.*" \
  --certificate-oidc-issuer "https://token.actions.githubusercontent.com"

cosign verify-attestation ghcr.io/<org>/fawa-backend-api-preprod@sha256:<digest> \
  --certificate-identity-regexp "https://github.com/<org>/falcon/.github/workflows/.*" \
  --certificate-oidc-issuer "https://token.actions.githubusercontent.com"
```

## 6) Kalan Riskler

- Mongo TTL silmeleri asenkron oldugu icin anlik silme garantisi yoktur.
- Under-13 policy enforcement backendte ayrica urun karari gerektirir; teknik enforce noktasi netlestirilmelidir.
- Web public evidence sayfasi bu repoda sadece referans olarak tanimlidir; web reposunda yayin gerekir.
