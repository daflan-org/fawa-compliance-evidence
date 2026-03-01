import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

type Result = "passed" | "failed";
type AssertionStatus = "passed" | "failed";
type ArtifactFormat = "json" | "junit";

interface AssertionEvidenceRef {
  filePath: string;
  matcherType: "includes" | "regex";
  matcher: string;
}

interface TestAssertion {
  assertionId: string;
  name: string;
  status: AssertionStatus;
  expected: string;
  actual: string;
  evidenceRef: AssertionEvidenceRef;
  verifiedAt: string;
}

interface TestArtifact {
  format: ArtifactFormat;
  path: string;
  sha256: string;
}

interface TestEvidenceEntry {
  testId: string;
  sourcePath: string;
  suiteType: "unit" | "e2e";
  result: Result;
  workflowPath: string;
  runId: string;
  jobName: string;
  sourceCommitSha: string;
  executedAt: string;
  artifacts: TestArtifact[];
  verificationCommand: string;
  assertions: TestAssertion[];
}

interface TestEvidenceManifest {
  generatedAt: string;
  testEvidence: TestEvidenceEntry[];
}

const defaultRequiredTestIds = [
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

function parseRequiredTestIds(): string[] {
  const raw = process.env.REQUIRED_TEST_IDS_JSON;
  if (!raw) {
    return [...defaultRequiredTestIds];
  }
  const parsed = JSON.parse(raw) as unknown;
  if (
    !Array.isArray(parsed) ||
    parsed.some((value) => typeof value !== "string")
  ) {
    throw new Error("REQUIRED_TEST_IDS_JSON must be a JSON string array.");
  }
  return parsed;
}

function ensure(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

function validateAssertion(assertion: TestAssertion, context: string): void {
  ensure(
    typeof assertion.assertionId === "string" &&
      assertion.assertionId.length > 0,
    `${context}: assertionId is required.`,
  );
  ensure(
    typeof assertion.name === "string" && assertion.name.length > 0,
    `${context}: name is required.`,
  );
  ensure(
    assertion.status === "passed" || assertion.status === "failed",
    `${context}: status must be passed|failed.`,
  );
  ensure(
    typeof assertion.expected === "string" && assertion.expected.length > 0,
    `${context}: expected is required.`,
  );
  ensure(
    typeof assertion.actual === "string" && assertion.actual.length > 0,
    `${context}: actual is required.`,
  );
  ensure(
    typeof assertion.verifiedAt === "string" &&
      Number.isFinite(Date.parse(assertion.verifiedAt)),
    `${context}: verifiedAt must be a valid ISO datetime.`,
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
    `${context}: evidenceRef must include filePath, matcherType and matcher.`,
  );
}

function resolveArtifactPath(testsDir: string, artifactPath: string): string {
  if (artifactPath.startsWith("current/tests/")) {
    return path.join(testsDir, path.basename(artifactPath));
  }
  if (path.isAbsolute(artifactPath)) {
    return artifactPath;
  }
  return path.join(process.cwd(), artifactPath);
}

export function runValidateTestEvidence(): void {
  const manifestPath =
    process.env.TEST_EVIDENCE_MANIFEST_PATH ??
    "out/test-evidence/compliance-test-evidence-manifest.json";
  const testsDir =
    process.env.TEST_EVIDENCE_TESTS_DIR ?? "out/test-evidence/tests";
  const requiredTestIds = parseRequiredTestIds();

  ensure(existsSync(manifestPath), `Manifest not found: ${manifestPath}`);
  const manifest = readJson<TestEvidenceManifest>(manifestPath);

  ensure(
    typeof manifest.generatedAt === "string" &&
      Number.isFinite(Date.parse(manifest.generatedAt)),
    "Manifest generatedAt must be a valid ISO datetime.",
  );
  ensure(
    Array.isArray(manifest.testEvidence),
    "Manifest testEvidence must be an array.",
  );
  ensure(
    manifest.testEvidence.length > 0,
    "Manifest testEvidence must not be empty.",
  );

  const seenTestIds = new Set<string>();
  let artifactCount = 0;

  for (const entry of manifest.testEvidence) {
    ensure(
      typeof entry.testId === "string" && entry.testId.length > 0,
      "testId is required.",
    );
    ensure(
      !seenTestIds.has(entry.testId),
      `Duplicate testId in manifest: ${entry.testId}`,
    );
    seenTestIds.add(entry.testId);

    ensure(
      typeof entry.sourcePath === "string" && entry.sourcePath.length > 0,
      `${entry.testId}: sourcePath is required.`,
    );
    ensure(
      entry.suiteType === "unit" || entry.suiteType === "e2e",
      `${entry.testId}: suiteType must be unit|e2e.`,
    );
    ensure(
      entry.result === "passed" || entry.result === "failed",
      `${entry.testId}: result must be passed|failed.`,
    );
    ensure(
      typeof entry.workflowPath === "string" && entry.workflowPath.length > 0,
      `${entry.testId}: workflowPath is required.`,
    );
    ensure(
      typeof entry.runId === "string" && entry.runId.length > 0,
      `${entry.testId}: runId is required.`,
    );
    ensure(
      typeof entry.jobName === "string" && entry.jobName.length > 0,
      `${entry.testId}: jobName is required.`,
    );
    ensure(
      typeof entry.sourceCommitSha === "string" &&
        entry.sourceCommitSha.length >= 7,
      `${entry.testId}: sourceCommitSha is invalid.`,
    );
    ensure(
      typeof entry.executedAt === "string" &&
        Number.isFinite(Date.parse(entry.executedAt)),
      `${entry.testId}: executedAt must be a valid ISO datetime.`,
    );
    ensure(
      typeof entry.verificationCommand === "string" &&
        entry.verificationCommand.length > 0,
      `${entry.testId}: verificationCommand is required.`,
    );
    ensure(
      Array.isArray(entry.assertions) && entry.assertions.length > 0,
      `${entry.testId}: assertions must be a non-empty array.`,
    );

    let failedAssertions = 0;
    for (const assertion of entry.assertions) {
      validateAssertion(assertion, `${entry.testId}/${assertion.assertionId}`);
      if (assertion.status === "failed") {
        failedAssertions += 1;
      }
    }
    if (entry.result === "passed") {
      ensure(
        failedAssertions === 0,
        `${entry.testId}: result=passed but found failed assertions.`,
      );
    }

    ensure(
      Array.isArray(entry.artifacts) && entry.artifacts.length > 0,
      `${entry.testId}: artifacts must be a non-empty array.`,
    );
    const jsonArtifact = entry.artifacts.find(
      (artifact) => artifact.format === "json",
    );
    ensure(Boolean(jsonArtifact), `${entry.testId}: missing json artifact.`);

    for (const artifact of entry.artifacts) {
      ensure(
        artifact.format === "json" || artifact.format === "junit",
        `${entry.testId}: invalid artifact format.`,
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

      const artifactLocalPath = resolveArtifactPath(testsDir, artifact.path);
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
          result?: Result;
          assertions?: TestAssertion[];
        }>(artifactLocalPath);
        ensure(
          artifactPayload.testId === entry.testId,
          `${entry.testId}: artifact testId mismatch.`,
        );
        ensure(
          artifactPayload.result === entry.result,
          `${entry.testId}: artifact result mismatch.`,
        );
        const artifactAssertions = artifactPayload.assertions;
        if (
          !Array.isArray(artifactAssertions) ||
          artifactAssertions.length === 0
        ) {
          throw new Error(`${entry.testId}: artifact assertions missing.`);
        }
        for (const assertion of artifactAssertions) {
          validateAssertion(assertion, `${entry.testId}/artifact`);
        }
      }

      artifactCount += 1;
    }
  }

  for (const requiredTestId of requiredTestIds) {
    ensure(
      seenTestIds.has(requiredTestId),
      `Required testId is missing from manifest: ${requiredTestId}`,
    );
  }

  process.stdout.write(
    `[validate-test-evidence] Manifest validated successfully. tests=${seenTestIds.size} artifacts=${artifactCount}\n`,
  );
}
