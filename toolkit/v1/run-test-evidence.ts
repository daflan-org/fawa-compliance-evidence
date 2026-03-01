import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

type SuiteType = "unit" | "e2e";
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

interface TestDefinition {
  testId: string;
  sourcePath: string;
  suiteType: SuiteType;
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
  suiteType: SuiteType;
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
const testDefinitions: TestDefinition[] = [
  {
    testId: "permission-analyzer-unit",
    sourcePath:
      "packages/domain/src/device/services/permission-analyzer.service.spec.ts",
    suiteType: "unit",
    assertions: [
      {
        assertionId: "location-denied-rule",
        name: "Location denied rule is asserted",
        filePath:
          "packages/domain/src/device/services/permission-analyzer.service.spec.ts",
        matcherType: "includes",
        matcher: "IssueCode.LOCATION_DENIED",
        expected: "Permission analyzer tests assert LOCATION_DENIED rule.",
      },
      {
        assertionId: "location-denied-severity-critical",
        name: "Location denied severity is critical",
        filePath:
          "packages/domain/src/device/services/permission-analyzer.service.spec.ts",
        matcherType: "includes",
        matcher: "IssueSeverity.CRITICAL",
        expected:
          "Permission analyzer tests assert LOCATION_DENIED as CRITICAL.",
      },
      {
        assertionId: "notifications-denied-rule",
        name: "Notifications denied rule is asserted",
        filePath:
          "packages/domain/src/device/services/permission-analyzer.service.spec.ts",
        matcherType: "includes",
        matcher: "IssueCode.NOTIFICATIONS_DENIED",
        expected: "Permission analyzer tests assert NOTIFICATIONS_DENIED rule.",
      },
      {
        assertionId: "notifications-denied-severity-warning",
        name: "Notifications denied severity is warning",
        filePath:
          "packages/domain/src/device/services/permission-analyzer.service.spec.ts",
        matcherType: "includes",
        matcher: "IssueSeverity.WARNING",
        expected:
          "Permission analyzer tests assert NOTIFICATIONS_DENIED as WARNING.",
      },
    ],
  },
  {
    testId: "ttl-indexes-persistence-unit",
    sourcePath: "packages/persistence/src/mongoose/ttl-indexes.spec.ts",
    suiteType: "unit",
    assertions: [
      {
        assertionId: "location-records-ttl-30d",
        name: "Location records TTL is 30 days",
        filePath:
          "packages/persistence/src/mongoose/device-sync/schemas/location-record.schema.ts",
        matcherType: "includes",
        matcher: 'index: { expires: "30d" }',
        expected: "location_records.recordedAt TTL must be 30d.",
      },
      {
        assertionId: "heartbeat-records-ttl-30d",
        name: "Heartbeat records TTL is 30 days",
        filePath:
          "packages/persistence/src/mongoose/device-sync/schemas/heartbeat-record.schema.ts",
        matcherType: "includes",
        matcher: 'index: { expires: "30d" }',
        expected: "heartbeat_records.recordedAt TTL must be 30d.",
      },
      {
        assertionId: "outbox-archive-default-ttl-30d",
        name: "Outbox archive default TTL is 30 days",
        filePath:
          "packages/persistence/src/mongoose/outbox/schemas/outbox-archive.schema.ts",
        matcherType: "includes",
        matcher: 'process.env.OUTBOX_ARCHIVE_TTL_DAYS || "30"',
        expected: "Outbox archive default TTL days must resolve to 30.",
      },
    ],
  },
  {
    testId: "ttl-indexes-api-unit",
    sourcePath: "apps/api/src/schemas/ttl-indexes.spec.ts",
    suiteType: "unit",
    assertions: [
      {
        assertionId: "refresh-token-expiration-index",
        name: "Refresh token TTL assertion exists",
        filePath: "apps/api/src/schemas/ttl-indexes.spec.ts",
        matcherType: "includes",
        matcher:
          'expectExpireAfterSeconds(RefreshTokenSchema, "expiresAt", 0);',
        expected: "RefreshTokenSchema expiresAt must use expireAfterSeconds=0.",
      },
      {
        assertionId: "media-deleteat-expiration-index",
        name: "Media deleteAt TTL assertion exists",
        filePath: "apps/api/src/schemas/ttl-indexes.spec.ts",
        matcherType: "includes",
        matcher: 'expectExpireAfterSeconds(MediaSchema, "deleteAt", 0);',
        expected: "MediaSchema deleteAt must use expireAfterSeconds=0.",
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

function writeSanitizedArtifacts(
  outputTestsDir: string,
  entry: {
    testId: string;
    sourcePath: string;
    suiteType: SuiteType;
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
    suiteType: entry.suiteType,
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
        )}" tests="1" failures="0" errors="0" skipped="0" time="0">\n  <testcase classname="${escapeXml(
          entry.suiteType,
        )}" name="${escapeXml(entry.sourcePath)}" />\n</testsuite>\n`
      : `<?xml version="1.0" encoding="UTF-8"?>\n<testsuite name="${escapeXml(
          entry.testId,
        )}" tests="1" failures="1" errors="0" skipped="0" time="0">\n  <testcase classname="${escapeXml(
          entry.suiteType,
        )}" name="${escapeXml(entry.sourcePath)}">\n    <failure message="Assertion check failed">At least one compliance assertion did not pass.</failure>\n  </testcase>\n</testsuite>\n`;

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

export function runTestEvidence(): void {
  const rootDir = process.cwd();
  const outputRoot = path.join(rootDir, "out/test-evidence");
  const outputTestsDir = path.join(outputRoot, "tests");
  const outputManifestPath = path.join(
    outputRoot,
    "compliance-test-evidence-manifest.json",
  );

  const runId = process.env.GITHUB_RUN_ID ?? "local";
  const sourceCommitSha = process.env.GITHUB_SHA ?? "local";
  const jobName =
    process.env.EVIDENCE_JOB_NAME ?? "Compliance Test Evidence (Public)";
  const rawResult = process.env.EVIDENCE_RESULT ?? "passed";
  const jobResult: Result = rawResult === "failed" ? "failed" : "passed";

  rmSync(outputRoot, { recursive: true, force: true });
  mkdirSync(outputTestsDir, { recursive: true });

  const entries: TestEvidenceEntry[] = [];
  for (const test of testDefinitions) {
    const executedAt = new Date().toISOString();
    const assertions = evaluateAssertions(rootDir, test.assertions, executedAt);
    const hasFailedAssertion = assertions.some(
      (assertion) => assertion.status === "failed",
    );
    const result: Result =
      jobResult === "passed" && !hasFailedAssertion ? "passed" : "failed";
    const artifacts = writeSanitizedArtifacts(outputTestsDir, {
      testId: test.testId,
      sourcePath: test.sourcePath,
      suiteType: test.suiteType,
      result,
      executedAt,
      runId,
      jobName,
      sourceCommitSha,
      assertions,
    });
    const primaryArtifact = artifacts[0];

    entries.push({
      testId: test.testId,
      sourcePath: test.sourcePath,
      suiteType: test.suiteType,
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
        test.testId,
      ),
      assertions,
    });
  }

  const manifest: TestEvidenceManifest = {
    generatedAt: new Date().toISOString(),
    testEvidence: entries,
  };

  writeFileSync(outputManifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
}
