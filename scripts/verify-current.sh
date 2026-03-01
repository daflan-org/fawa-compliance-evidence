#!/usr/bin/env bash
set -euo pipefail

EVIDENCE_URL="${EVIDENCE_URL:-https://raw.githubusercontent.com/daflan-org/fawa-compliance-evidence/main/current/evidence.json}"
SCHEMA_URL="${SCHEMA_URL:-https://raw.githubusercontent.com/daflan-org/fawa-compliance-evidence/main/schemas/evidence.schema.json}"
RAW_BASE_URL="${RAW_BASE_URL:-https://raw.githubusercontent.com/daflan-org/fawa-compliance-evidence/main}"
RUN_COSIGN="${RUN_COSIGN:-0}"

WORK_DIR="$(mktemp -d)"
trap 'rm -rf "${WORK_DIR}"' EXIT

echo "Downloading evidence payload..."
curl -fsSL "${EVIDENCE_URL}" -o "${WORK_DIR}/evidence.json"
curl -fsSL "${SCHEMA_URL}" -o "${WORK_DIR}/evidence.schema.json"

echo "Checking required top-level fields..."
jq -e '.schemaVersion == "1.0.0"' "${WORK_DIR}/evidence.json" >/dev/null
jq -e '.source.owner and .source.repo and .source.ref and .source.commitSha' "${WORK_DIR}/evidence.json" >/dev/null
jq -e '.testEvidence | type == "array"' "${WORK_DIR}/evidence.json" >/dev/null
jq -e '.documents | type == "array"' "${WORK_DIR}/evidence.json" >/dev/null
jq -e '.verificationCommands | type == "array"' "${WORK_DIR}/evidence.json" >/dev/null

echo "Verifying test evidence artifacts by SHA256..."
while IFS=$'\t' read -r artifact_path artifact_sha; do
  if [[ -z "${artifact_path}" || -z "${artifact_sha}" ]]; then
    continue
  fi
  artifact_url="${RAW_BASE_URL}/${artifact_path}"
  artifact_target="${WORK_DIR}/$(basename "${artifact_path}")"
  curl -fsSL "${artifact_url}" -o "${artifact_target}"
  echo "${artifact_sha}  ${artifact_target}" | shasum -a 256 -c -
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
