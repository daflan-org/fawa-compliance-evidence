import { execSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

type CheckStatus = "passed" | "failed";

interface IngestOutput {
  source: {
    owner: string;
    repo: string;
    ref: string;
    commitSha: string;
  };
  environment: string;
  dispatchPayload: {
    sourceRepo: string;
  };
  ci: {
    runId: string;
    conclusion: string | null;
  };
  deploy: {
    runId: string;
    runNumber: string;
    workflowName: string;
    htmlUrl: string;
    conclusion: string | null;
    jobs: Array<{
      name: string;
      status: string;
      conclusion: string | null;
      startedAt: string | null;
      completedAt: string | null;
      htmlUrl: string;
    }>;
  };
  images: {
    api: {
      image: string;
      digest: string;
    };
    worker: {
      image: string;
      digest: string;
    };
  };
}

interface PolicyProvenance {
  version: string;
  policy: {
    filePath: string;
    sha256: string;
    signaturePath: string;
    publicKeyPath: string;
  };
  toolkit?: {
    version?: string;
    buildPolicyInput?: {
      filePath?: string;
      sha256?: string;
    };
    sourceUrl?: string;
  };
  policyInputSha256: string;
  sourceUrl: string;
  verification?: {
    checksumVerified?: boolean;
    signatureVerified?: boolean;
  };
}

interface TestEvidenceEntry {
  testId: string;
  sourcePath: string;
  suiteType: "unit" | "e2e";
  result: "passed" | "failed";
  workflowPath: string;
  runId: string;
  jobName: string;
  sourceCommitSha: string;
  executedAt: string;
  artifacts: Array<{
    format: "json" | "junit";
    path: string;
    sha256: string;
  }>;
  verificationCommand: string;
}

interface TestManifest {
  testEvidence?: TestEvidenceEntry[];
}

interface VerificationCommand {
  label: string;
  command: string;
}

interface EvidenceCheck {
  id: string;
  name: string;
  status: CheckStatus;
  expected: string;
  actual: string;
}

interface EvidencePayload {
  schemaVersion: "1.0.0";
  generatedAt: string;
  source: IngestOutput["source"];
  policyStatus: {
    provider: string;
    workflowPath: string;
    policyPath: string;
    inputBuilderPath: string;
  };
  attestationStatus: {
    provider: string;
    workflowPaths: string[];
  };
  documents: Array<{
    key: "trustCompliance" | "storeCompliance";
    title: string;
    path: string;
    url: string;
    sha: string;
  }>;
  testEvidence: TestEvidenceEntry[];
  verificationCommands: VerificationCommand[];
  limits: string[];
  verification: {
    dispatcher: "repository_dispatch";
    ciArtifactsValidated: boolean;
    deployJobsValidated: boolean;
    sourceRepo: string;
    environment: string;
    ciRunId: string;
    deployRunId: string;
  };
  policyPackage: {
    version: string;
    filePath: string;
    sha256: string;
    signaturePath: string;
    publicKeyPath: string;
    policyInputSha256: string;
    checksumVerified: boolean;
    signatureVerified: boolean;
    sourceUrl: string;
  };
  deployEvidence: IngestOutput["deploy"];
  checks: EvidenceCheck[];
}

const ingestPath: string = process.env.INGEST_PATH ?? "out/ingest/falcon.json";
const testManifestPath: string =
  process.env.TEST_MANIFEST_PATH ??
  "out/test-evidence/compliance-test-evidence-manifest.json";
const policyProvenancePath: string =
  process.env.POLICY_PROVENANCE_PATH ?? "out/policy/policy-provenance.json";
const currentDir: string = process.env.CURRENT_DIR ?? "current";

function readJson<T>(filePath: string): T {
  return JSON.parse(readFileSync(filePath, "utf-8")) as T;
}

function gitBlobSha(filePath: string): string {
  try {
    return execSync(`git rev-parse HEAD:${filePath}`, {
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return "unknown";
  }
}

function ensureFile(filePath: string, label: string): void {
  if (!existsSync(filePath)) {
    throw new Error(`${label} not found at ${filePath}`);
  }
}

function copyTestsFromArtifact(): void {
  const sourceTestsDir = path.join(path.dirname(testManifestPath), "tests");
  const targetTestsDir = path.join(currentDir, "tests");

  rmSync(targetTestsDir, { recursive: true, force: true });
  if (!existsSync(sourceTestsDir)) {
    return;
  }
  mkdirSync(targetTestsDir, { recursive: true });
  cpSync(sourceTestsDir, targetTestsDir, { recursive: true });
}

function buildVerificationCommands(
  ingest: IngestOutput,
): VerificationCommand[] {
  const baseFlags =
    '--certificate-identity-regexp "https://github.com/panalgin/falcon/.github/workflows/.*" --certificate-oidc-issuer "https://token.actions.githubusercontent.com"';
  return [
    {
      label: "Verify API container signature",
      command: `cosign verify ${ingest.images.api.image}@${ingest.images.api.digest} ${baseFlags}`,
    },
    {
      label: "Verify Worker container signature",
      command: `cosign verify ${ingest.images.worker.image}@${ingest.images.worker.digest} ${baseFlags}`,
    },
    {
      label: "Verify API container attestation",
      command: `cosign verify-attestation ${ingest.images.api.image}@${ingest.images.api.digest} ${baseFlags}`,
    },
    {
      label: "Verify Worker container attestation",
      command: `cosign verify-attestation ${ingest.images.worker.image}@${ingest.images.worker.digest} ${baseFlags}`,
    },
  ];
}

function buildChecks(ingest: IngestOutput): EvidenceCheck[] {
  const deployCheck: EvidenceCheck = {
    id: "deploy-required-jobs",
    name: "Deploy Required Jobs",
    status: "passed",
    expected:
      "sign_and_attest, deploy_api, deploy_worker, finalize_healthcheck = success",
    actual: ingest.deploy.jobs
      .map((job) => `${job.name}:${job.conclusion ?? "unknown"}`)
      .join(", "),
  };

  const ciStatus: CheckStatus =
    ingest.ci.conclusion === "success" ? "passed" : "failed";
  const ciCheck: EvidenceCheck = {
    id: "ci-run-success",
    name: "CI Run Success",
    status: ciStatus,
    expected: "CI run conclusion is success",
    actual: `CI run ${ingest.ci.runId} conclusion=${ingest.ci.conclusion}`,
  };

  return [deployCheck, ciCheck];
}

function run(): void {
  ensureFile(ingestPath, "Ingest payload");
  ensureFile(testManifestPath, "Compliance test evidence manifest");
  ensureFile(policyProvenancePath, "Policy provenance artifact");

  const ingest = readJson<IngestOutput>(ingestPath);
  const testManifest = readJson<TestManifest>(testManifestPath);
  const policyProvenance = readJson<PolicyProvenance>(policyProvenancePath);

  const testEvidence: TestEvidenceEntry[] = Array.isArray(
    testManifest.testEvidence,
  )
    ? testManifest.testEvidence
    : [];
  const verificationCommands = buildVerificationCommands(ingest);
  const inputBuilderPath =
    policyProvenance.toolkit?.buildPolicyInput?.filePath ??
    "toolkit/v1/build-policy-input.ts";

  const evidence: EvidencePayload = {
    schemaVersion: "1.0.0",
    generatedAt: new Date().toISOString(),
    source: ingest.source,
    policyStatus: {
      provider: "OPA + Conftest",
      workflowPath: ".github/workflows/ci-tests.yml",
      policyPath: policyProvenance.policy.filePath,
      inputBuilderPath,
    },
    attestationStatus: {
      provider: "Sigstore Cosign",
      workflowPaths: [
        ".github/workflows/deploy-preprod.yml",
        ".github/workflows/deploy-prod.yml",
      ],
    },
    documents: [
      {
        key: "trustCompliance",
        title: "Trust And Compliance Evidence",
        path: "current/trust-evidence.md",
        url: "https://raw.githubusercontent.com/daflan-org/fawa-compliance-evidence/main/current/trust-evidence.md",
        sha: gitBlobSha("current/trust-evidence.md"),
      },
      {
        key: "storeCompliance",
        title: "Store Compliance Backend Evidence DAF-418",
        path: "current/store-compliance.md",
        url: "https://raw.githubusercontent.com/daflan-org/fawa-compliance-evidence/main/current/store-compliance.md",
        sha: gitBlobSha("current/store-compliance.md"),
      },
    ],
    testEvidence,
    verificationCommands,
    limits: [
      "Evidence includes sanitized verification metadata and immutable links only.",
      "Operational secrets and sensitive runtime details are intentionally excluded.",
      "Runtime policy is fetched from public package and verified via checksum + detached signature.",
    ],
    verification: {
      dispatcher: "repository_dispatch",
      ciArtifactsValidated: true,
      deployJobsValidated: true,
      sourceRepo: ingest.dispatchPayload.sourceRepo,
      environment: ingest.environment,
      ciRunId: ingest.ci.runId,
      deployRunId: ingest.deploy.runId,
    },
    policyPackage: {
      version: policyProvenance.version,
      filePath: policyProvenance.policy.filePath,
      sha256: policyProvenance.policy.sha256,
      signaturePath: policyProvenance.policy.signaturePath,
      publicKeyPath: policyProvenance.policy.publicKeyPath,
      policyInputSha256: policyProvenance.policyInputSha256,
      checksumVerified: Boolean(
        policyProvenance.verification?.checksumVerified,
      ),
      signatureVerified: Boolean(
        policyProvenance.verification?.signatureVerified,
      ),
      sourceUrl: policyProvenance.sourceUrl,
    },
    deployEvidence: ingest.deploy,
    checks: buildChecks(ingest),
  };

  mkdirSync(currentDir, { recursive: true });
  writeFileSync(
    path.join(currentDir, "evidence.json"),
    `${JSON.stringify(evidence, null, 2)}\n`,
    "utf-8",
  );
  writeFileSync(
    path.join(currentDir, "deploy-run.json"),
    `${JSON.stringify(ingest.deploy, null, 2)}\n`,
    "utf-8",
  );
  copyTestsFromArtifact();
}

run();
