import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

type Result = "passed" | "failed";
type ArtifactFormat = "json" | "junit";
type AssertionStatus = "passed" | "failed";
type MatcherType = "includes" | "regex";

interface AssertionDefinition {
  assertionId: string;
  name: string;
  filePath: string;
  matcherType: MatcherType;
  matcher: string;
  expected: string;
}

interface E2eDefinition {
  testId: string;
  sourcePath: string;
  assertions: AssertionDefinition[];
}

interface TestArtifact {
  format: ArtifactFormat;
  path: string;
  sha256: string;
}

interface AssertionEvidenceRef {
  filePath: string;
  matcherType: MatcherType;
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

interface TestEvidenceEntry {
  testId: string;
  sourcePath: string;
  suiteType: "e2e";
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

const workflowPath = ".github/workflows/ci-tests.yml";
const e2eDefinitions: E2eDefinition[] = [
  {
    testId: "device-sync-e2e",
    sourcePath: "apps/api/test/device-sync.e2e.spec.ts",
    assertions: [
      {
        assertionId: "device-sync-endpoint-exists",
        name: "Device sync endpoint assertion exists",
        filePath: "apps/api/test/device-sync.e2e.spec.ts",
        matcherType: "includes",
        matcher: '.post("/devices/sync/v1")',
        expected: "Device sync E2E test must call /devices/sync/v1 endpoint.",
      },
      {
        assertionId: "device-sync-durable-inbox-assertion",
        name: "Device sync durable inbox assertion exists",
        filePath: "apps/api/test/device-sync.e2e.spec.ts",
        matcherType: "includes",
        matcher: "expect(inbox).toBeDefined();",
        expected:
          "Device sync E2E test must assert durable inbox write with toBeDefined().",
      },
      {
        assertionId: "device-sync-record-processing-assertion",
        name: "Device sync record processing assertion exists",
        filePath: "apps/api/test/device-sync.e2e.spec.ts",
        matcherType: "includes",
        matcher: "expect(foundLocation).toBe(true);",
        expected:
          "Device sync E2E test must assert asynchronous location record processing.",
      },
    ],
  },
  {
    testId: "sos-e2e",
    sourcePath: "apps/api/test/sos.e2e.spec.ts",
    assertions: [
      {
        assertionId: "sos-endpoint-exists",
        name: "SOS endpoint assertion exists",
        filePath: "apps/api/test/sos.e2e.spec.ts",
        matcherType: "includes",
        matcher: '.post("/device/sos/v1")',
        expected: "SOS E2E test must call /device/sos/v1 endpoint.",
      },
      {
        assertionId: "sos-audit-action-assertion",
        name: "SOS audit action assertion exists",
        filePath: "apps/api/test/sos.e2e.spec.ts",
        matcherType: "includes",
        matcher: 'action: "DEVICE.SOS_TRIGGERED"',
        expected:
          "SOS E2E test must query audit log for DEVICE.SOS_TRIGGERED action.",
      },
      {
        assertionId: "sos-audit-presence-assertion",
        name: "SOS audit persistence assertion exists",
        filePath: "apps/api/test/sos.e2e.spec.ts",
        matcherType: "includes",
        matcher: "expect(sosAuditLog).toBeDefined();",
        expected:
          "SOS E2E test must assert persisted audit log with toBeDefined().",
      },
    ],
  },
];

function sha256File(filePath: string): string {
  return createHash("sha256").update(readFileSync(filePath)).digest("hex");
}

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function assertionMatches(
  definition: AssertionDefinition,
  source: string,
): boolean {
  if (definition.matcherType === "includes") {
    return source.includes(definition.matcher);
  }
  return new RegExp(definition.matcher, "m").test(source);
}

function evaluateAssertions(
  rootDir: string,
  definitions: AssertionDefinition[],
  verifiedAt: string,
): TestAssertion[] {
  const cache = new Map<string, string>();

  return definitions.map((definition) => {
    let source = cache.get(definition.filePath);
    if (!source) {
      source = readFileSync(path.join(rootDir, definition.filePath), "utf-8");
      cache.set(definition.filePath, source);
    }
    const matched = assertionMatches(definition, source);

    return {
      assertionId: definition.assertionId,
      name: definition.name,
      status: matched ? "passed" : "failed",
      expected: definition.expected,
      actual: matched
        ? `Matched ${definition.matcherType} assertion in ${definition.filePath}.`
        : `Matcher '${definition.matcher}' not found in ${definition.filePath}.`,
      evidenceRef: {
        filePath: definition.filePath,
        matcherType: definition.matcherType,
        matcher: definition.matcher,
      },
      verifiedAt,
    };
  });
}

function buildVerificationCommand(
  artifactPath: string,
  sha256: string,
  testId: string,
): string {
  const artifactName = path.basename(artifactPath);
  return [
    `curl -fsSL "https://raw.githubusercontent.com/daflan-org/fawa-compliance-evidence/main/${artifactPath}" -o /tmp/${artifactName}`,
    `echo "${sha256}  /tmp/${artifactName}" | shasum -a 256 -c -`,
    `jq -e '.testId == "${testId}" and (.assertions | type == "array" and length > 0) and ([.assertions[].status == "passed"] | all)' /tmp/${artifactName} >/dev/null`,
  ].join(" && ");
}

function writeArtifacts(
  outputTestsDir: string,
  entry: {
    testId: string;
    sourcePath: string;
    result: Result;
    executedAt: string;
    runId: string;
    jobName: string;
    sourceCommitSha: string;
    assertions: TestAssertion[];
  },
): TestArtifact[] {
  const jsonFilename = `${entry.testId}.json`;
  const junitFilename = `${entry.testId}.junit.xml`;
  const jsonAbsolutePath = path.join(outputTestsDir, jsonFilename);
  const junitAbsolutePath = path.join(outputTestsDir, junitFilename);

  const sanitizedJson = {
    schemaVersion: "1.1.0",
    testId: entry.testId,
    sourcePath: entry.sourcePath,
    suiteType: "e2e" as const,
    result: entry.result,
    executedAt: entry.executedAt,
    runId: entry.runId,
    jobName: entry.jobName,
    sourceCommitSha: entry.sourceCommitSha,
    workflowPath,
    assertions: entry.assertions,
  };

  writeFileSync(
    jsonAbsolutePath,
    `${JSON.stringify(sanitizedJson, null, 2)}\n`,
    "utf-8",
  );

  const junitXml =
    entry.result === "passed"
      ? `<?xml version="1.0" encoding="UTF-8"?>\n<testsuite name="${escapeXml(
          entry.testId,
        )}" tests="1" failures="0" errors="0" skipped="0" time="0">\n  <testcase classname="e2e" name="${escapeXml(
          entry.sourcePath,
        )}" />\n</testsuite>\n`
      : `<?xml version="1.0" encoding="UTF-8"?>\n<testsuite name="${escapeXml(
          entry.testId,
        )}" tests="1" failures="1" errors="0" skipped="0" time="0">\n  <testcase classname="e2e" name="${escapeXml(
          entry.sourcePath,
        )}">\n    <failure message="Assertion check failed">At least one compliance assertion did not pass.</failure>\n  </testcase>\n</testsuite>\n`;

  writeFileSync(junitAbsolutePath, junitXml, "utf-8");

  return [
    {
      format: "json",
      path: `current/tests/${jsonFilename}`,
      sha256: sha256File(jsonAbsolutePath),
    },
    {
      format: "junit",
      path: `current/tests/${junitFilename}`,
      sha256: sha256File(junitAbsolutePath),
    },
  ];
}

export function runE2eTestEvidence(): void {
  const rootDir = process.cwd();
  const outputRoot = path.join(rootDir, "out/test-evidence/e2e");
  const outputTestsDir = path.join(outputRoot, "tests");
  const outputManifestPath = path.join(
    outputRoot,
    "compliance-test-evidence-manifest.json",
  );

  const runId = process.env.GITHUB_RUN_ID ?? "local";
  const sourceCommitSha = process.env.GITHUB_SHA ?? "local";
  const jobName = process.env.EVIDENCE_JOB_NAME ?? "Integration And E2E Tests";
  const rawResult = process.env.EVIDENCE_RESULT ?? "passed";
  const jobResult: Result = rawResult === "failed" ? "failed" : "passed";

  rmSync(outputRoot, { recursive: true, force: true });
  mkdirSync(outputTestsDir, { recursive: true });

  const testEvidence: TestEvidenceEntry[] = e2eDefinitions.map((item) => {
    const executedAt = new Date().toISOString();
    const assertions = evaluateAssertions(rootDir, item.assertions, executedAt);
    const hasFailedAssertion = assertions.some(
      (assertion) => assertion.status === "failed",
    );
    const result: Result =
      jobResult === "passed" && !hasFailedAssertion ? "passed" : "failed";
    const artifacts = writeArtifacts(outputTestsDir, {
      testId: item.testId,
      sourcePath: item.sourcePath,
      result,
      executedAt,
      runId,
      jobName,
      sourceCommitSha,
      assertions,
    });
    const primaryArtifact = artifacts[0];

    return {
      testId: item.testId,
      sourcePath: item.sourcePath,
      suiteType: "e2e",
      result,
      workflowPath,
      runId,
      jobName,
      sourceCommitSha,
      executedAt,
      artifacts,
      verificationCommand: buildVerificationCommand(
        primaryArtifact.path,
        primaryArtifact.sha256,
        item.testId,
      ),
      assertions,
    };
  });

  const manifest: TestEvidenceManifest = {
    generatedAt: new Date().toISOString(),
    testEvidence,
  };

  writeFileSync(outputManifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
}
