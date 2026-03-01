#!/usr/bin/env bash
set -euo pipefail

EVIDENCE_URL="${EVIDENCE_URL:-https://raw.githubusercontent.com/daflan-org/fawa-compliance-evidence/main/current/evidence.json}"
SCHEMA_URL="${SCHEMA_URL:-https://raw.githubusercontent.com/daflan-org/fawa-compliance-evidence/main/schemas/evidence.schema.json}"
TEST_ARTIFACT_SCHEMA_URL="${TEST_ARTIFACT_SCHEMA_URL:-https://raw.githubusercontent.com/daflan-org/fawa-compliance-evidence/main/schemas/test-artifact.schema.json}"
RAW_BASE_URL="${RAW_BASE_URL:-https://raw.githubusercontent.com/daflan-org/fawa-compliance-evidence/main}"
RUN_COSIGN="${RUN_COSIGN:-0}"

WORK_DIR="$(mktemp -d)"
trap 'rm -rf "${WORK_DIR}"' EXIT

echo "Downloading evidence payload..."
curl -fsSL "${EVIDENCE_URL}" -o "${WORK_DIR}/evidence.json"
curl -fsSL "${SCHEMA_URL}" -o "${WORK_DIR}/evidence.schema.json"
curl -fsSL "${TEST_ARTIFACT_SCHEMA_URL}" -o "${WORK_DIR}/test-artifact.schema.json"

if ! command -v npx >/dev/null 2>&1; then
  echo "npx is required for JSON schema validation."
  exit 1
fi

echo "Validating evidence payload against JSON schema..."
npx --yes ajv-cli@5.0.0 validate --spec=draft2020 --strict=false \
  -s "${WORK_DIR}/evidence.schema.json" \
  -d "${WORK_DIR}/evidence.json"

echo "Checking assertion completeness..."
jq -e '.testEvidence | type == "array" and length > 0' "${WORK_DIR}/evidence.json" >/dev/null
jq -e '[.testEvidence[].assertions | type == "array" and length > 0] | all' "${WORK_DIR}/evidence.json" >/dev/null
jq -e '[.testEvidence[].assertions[].status == "passed"] | all' "${WORK_DIR}/evidence.json" >/dev/null
jq -e '.assertionSummary.total >= .assertionSummary.passed and .assertionSummary.failed == 0' "${WORK_DIR}/evidence.json" >/dev/null

echo "Verifying test evidence artifacts by SHA256..."
while IFS=$'\t' read -r artifact_path artifact_sha; do
  if [[ -z "${artifact_path}" || -z "${artifact_sha}" ]]; then
    continue
  fi
  artifact_url="${RAW_BASE_URL}/${artifact_path}"
  artifact_target="${WORK_DIR}/$(basename "${artifact_path}")"
  curl -fsSL "${artifact_url}" -o "${artifact_target}"
  echo "${artifact_sha}  ${artifact_target}" | shasum -a 256 -c -
  if [[ "${artifact_path}" == current/tests/*.json ]]; then
    npx --yes ajv-cli@5.0.0 validate --spec=draft2020 --strict=false \
      -s "${WORK_DIR}/test-artifact.schema.json" \
      -d "${artifact_target}"
    jq -e '.assertions | type == "array" and length > 0 and ([.[]?.status == "passed"] | all)' "${artifact_target}" >/dev/null
  fi
done < <(jq -r '.testEvidence[]? | .artifacts[]? | [.path, .sha256] | @tsv' "${WORK_DIR}/evidence.json")

echo "Verifying public policy package checksum..."
policy_file_path="$(jq -r '.policyPackage.filePath // empty' "${WORK_DIR}/evidence.json")"
policy_sha="$(jq -r '.policyPackage.sha256 // empty' "${WORK_DIR}/evidence.json")"
if [[ -n "${policy_file_path}" && -n "${policy_sha}" ]]; then
  curl -fsSL "${RAW_BASE_URL}/${policy_file_path}" -o "${WORK_DIR}/policy.rego"
  echo "${policy_sha}  ${WORK_DIR}/policy.rego" | shasum -a 256 -c -
fi

if [[ "${RUN_COSIGN}" == "1" ]]; then
  if command -v cosign >/dev/null 2>&1; then
    echo "Running cosign verification commands..."
    while IFS= read -r cmd; do
      if [[ -z "${cmd}" ]]; then
        continue
      fi
      bash -lc "${cmd}"
    done < <(jq -r '.verificationCommands[]?.command' "${WORK_DIR}/evidence.json")
  else
    echo "cosign binary not found, skipping cosign verification."
  fi
else
  echo "Skipping cosign verification (set RUN_COSIGN=1 to enable)."
fi

echo "Evidence verification completed successfully."
