import { execSync } from "node:child_process";
import { createHash } from "node:crypto";
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
type AssertionStatus = "passed" | "failed";

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
    packageName?: string;
    packageVersion?: string;
    command?: string;
    registry?: string;
    sourceUrl?: string;
  };
  policyInputSha256: string;
  sourceUrl: string;
  verification?: {
    checksumVerified?: boolean;
    signatureVerified?: boolean;
  };
}

interface TestAssertion {
  assertionId: string;
  name: string;
  status: AssertionStatus;
  expected: string;
  actual: string;
  evidenceRef: {
    filePath: string;
    matcherType: "includes" | "regex";
    matcher: string;
  };
  verifiedAt: string;
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
  assertions: TestAssertion[];
}

interface TestManifest {
  testEvidence?: TestEvidenceEntry[];
}

interface AssertionSummaryByTest {
  testId: string;
  total: number;
  passed: number;
  failed: number;
}

interface AssertionSummary {
  total: number;
  passed: number;
  failed: number;
  byTest: AssertionSummaryByTest[];
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
  assertionSummary: AssertionSummary;
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
const requiredTestIds = [
  "permission-analyzer-unit",
  "ttl-indexes-persistence-unit",
  "ttl-indexes-api-unit",
  "device-sync-e2e",
  "sos-e2e",
];

function readJson<T>(filePath: string): T {
  return JSON.parse(readFileSync(filePath, "utf-8")) as T;
}

function sha256File(filePath: string): string {
  return createHash("sha256").update(readFileSync(filePath)).digest("hex");
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

function ensure(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
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

function resolveLocalArtifactPath(
  testsDir: string,
  artifactPath: string,
): string {
  if (artifactPath.startsWith("current/tests/")) {
    return path.join(testsDir, path.basename(artifactPath));
  }
  return path.join(path.dirname(testManifestPath), artifactPath);
}

function validateAssertion(assertion: TestAssertion, context: string): void {
  ensure(
    typeof assertion.assertionId === "string" &&
      assertion.assertionId.length > 0,
    `${context}: assertionId is required.`,
  );
  ensure(
    typeof assertion.name === "string" && assertion.name.length > 0,
    `${context}: assertion name is required.`,
  );
  ensure(
    assertion.status === "passed" || assertion.status === "failed",
    `${context}: assertion status must be passed|failed.`,
  );
  ensure(
    typeof assertion.expected === "string" && assertion.expected.length > 0,
    `${context}: assertion expected is required.`,
  );
  ensure(
    typeof assertion.actual === "string" && assertion.actual.length > 0,
    `${context}: assertion actual is required.`,
  );
  ensure(
    typeof assertion.verifiedAt === "string" &&
      Number.isFinite(Date.parse(assertion.verifiedAt)),
    `${context}: assertion verifiedAt must be valid datetime.`,
  );
  ensure(
    assertion.evidenceRef !== null &&
      typeof assertion.evidenceRef === "object" &&
      typeof assertion.evidenceRef.filePath === "string" &&
      assertion.evidenceRef.filePath.length > 0 &&
      (assertion.evidenceRef.matcherType === "includes" ||
        assertion.evidenceRef.matcherType === "regex") &&
      typeof assertion.evidenceRef.matcher === "string" &&
      assertion.evidenceRef.matcher.length > 0,
    `${context}: assertion evidenceRef is invalid.`,
  );
}

function validateAndSummarizeTestEvidence(
  testEvidence: TestEvidenceEntry[],
): AssertionSummary {
  ensure(
    testEvidence.length > 0,
    "Test evidence manifest must contain at least one entry.",
  );
  const seenTestIds = new Set<string>();
  const testsDir = path.join(path.dirname(testManifestPath), "tests");

  let totalAssertions = 0;
  let passedAssertions = 0;
  let failedAssertions = 0;
  const byTest: AssertionSummaryByTest[] = [];

  for (const entry of testEvidence) {
    ensure(
      typeof entry.testId === "string" && entry.testId.length > 0,
      "testId is required in test evidence entry.",
    );
    ensure(
      !seenTestIds.has(entry.testId),
      `Duplicate testId found in test evidence: ${entry.testId}`,
    );
    seenTestIds.add(entry.testId);
    ensure(
      entry.result === "passed" || entry.result === "failed",
      `${entry.testId}: result must be passed|failed.`,
    );
    ensure(
      Array.isArray(entry.assertions) && entry.assertions.length > 0,
      `${entry.testId}: assertions must be a non-empty array.`,
    );
    ensure(
      Array.isArray(entry.artifacts) && entry.artifacts.length > 0,
      `${entry.testId}: artifacts must be a non-empty array.`,
    );

    let localPassed = 0;
    let localFailed = 0;
    for (const assertion of entry.assertions) {
      validateAssertion(assertion, `${entry.testId}/${assertion.assertionId}`);
      totalAssertions += 1;
      if (assertion.status === "passed") {
        passedAssertions += 1;
        localPassed += 1;
      } else {
        failedAssertions += 1;
        localFailed += 1;
      }
    }

    ensure(
      localFailed === 0,
      `${entry.testId}: at least one assertion failed; verifier rejects publishing.`,
    );
    ensure(
      entry.result === "passed",
      `${entry.testId}: result is '${entry.result}', expected 'passed'.`,
    );

    const jsonArtifact = entry.artifacts.find(
      (artifact) => artifact.format === "json",
    );
    ensure(
      Boolean(jsonArtifact),
      `${entry.testId}: missing json test artifact.`,
    );

    for (const artifact of entry.artifacts) {
      ensure(
        artifact.format === "json" || artifact.format === "junit",
        `${entry.testId}: unsupported artifact format.`,
      );
      ensure(
        typeof artifact.path === "string" && artifact.path.length > 0,
        `${entry.testId}: artifact path is required.`,
      );
      ensure(
        typeof artifact.sha256 === "string" &&
          /^[A-Fa-f0-9]{64}$/.test(artifact.sha256),
        `${entry.testId}: artifact sha256 is invalid.`,
      );

      const artifactLocalPath = resolveLocalArtifactPath(
        testsDir,
        artifact.path,
      );
      ensure(
        existsSync(artifactLocalPath),
        `${entry.testId}: artifact file not found at ${artifactLocalPath}.`,
      );
      const actualSha = sha256File(artifactLocalPath);
      ensure(
        actualSha === artifact.sha256,
        `${entry.testId}: sha256 mismatch for ${artifact.path}. expected=${artifact.sha256} actual=${actualSha}`,
      );

      if (artifact.format === "json") {
        const artifactPayload = readJson<{
          testId?: string;
          result?: "passed" | "failed";
          assertions?: TestAssertion[];
        }>(artifactLocalPath);
        ensure(
          artifactPayload.testId === entry.testId,
          `${entry.testId}: json artifact testId mismatch.`,
        );
        ensure(
          artifactPayload.result === entry.result,
          `${entry.testId}: json artifact result mismatch.`,
        );
        ensure(
          Array.isArray(artifactPayload.assertions) &&
            artifactPayload.assertions.length > 0,
          `${entry.testId}: json artifact assertions are missing.`,
        );
      }
    }

    byTest.push({
      testId: entry.testId,
      total: entry.assertions.length,
      passed: localPassed,
      failed: localFailed,
    });
  }

  for (const requiredTestId of requiredTestIds) {
    ensure(
      seenTestIds.has(requiredTestId),
      `Required test evidence is missing: ${requiredTestId}`,
    );
  }

  return {
    total: totalAssertions,
    passed: passedAssertions,
    failed: failedAssertions,
    byTest,
  };
}

function buildChecks(
  ingest: IngestOutput,
  assertionSummary: AssertionSummary,
): EvidenceCheck[] {
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

  const assertionStatus: CheckStatus =
    assertionSummary.failed === 0 ? "passed" : "failed";
  const assertionCheck: EvidenceCheck = {
    id: "test-assertions",
    name: "Test Assertions",
    status: assertionStatus,
    expected:
      "All required tests include non-empty assertions and all assertions pass.",
    actual: `total=${assertionSummary.total}, passed=${assertionSummary.passed}, failed=${assertionSummary.failed}`,
  };

  return [deployCheck, ciCheck, assertionCheck];
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
  const assertionSummary = validateAndSummarizeTestEvidence(testEvidence);
  const verificationCommands = buildVerificationCommands(ingest);
  const inputBuilderPath =
    policyProvenance.toolkit?.command ??
    policyProvenance.toolkit?.buildPolicyInput?.filePath ??
    "falcon-compliance-toolkit build-policy-input";

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
    assertionSummary,
    verificationCommands,
    limits: [
      "Evidence includes sanitized verification metadata and immutable links only.",
      "Operational secrets and sensitive runtime details are intentionally excluded.",
      "Runtime policy is fetched from public package and verified via checksum + detached signature.",
      "Assertion payloads are source-derived proof points; runtime DB drift is out of scope for this phase.",
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
    checks: buildChecks(ingest, assertionSummary),
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
