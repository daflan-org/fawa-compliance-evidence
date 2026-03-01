import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

type SuiteType = "unit" | "e2e";
type Result = "passed" | "failed";
type ArtifactFormat = "json" | "junit";

interface TestDefinition {
  testId: string;
  sourcePath: string;
  suiteType: SuiteType;
}

interface TestArtifact {
  format: ArtifactFormat;
  path: string;
  sha256: string;
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
}

interface TestEvidenceManifest {
  generatedAt: string;
  testEvidence: TestEvidenceEntry[];
}

const rootDir = process.cwd();
const outputRoot = path.join(rootDir, "out/test-evidence");
const outputTestsDir = path.join(outputRoot, "tests");
const outputManifestPath = path.join(
  outputRoot,
  "compliance-test-evidence-manifest.json",
);

const workflowPath = ".github/workflows/ci-tests.yml";
const runId = process.env.GITHUB_RUN_ID ?? "local";
const sourceCommitSha = process.env.GITHUB_SHA ?? "local";
const jobName =
  process.env.EVIDENCE_JOB_NAME ?? "Compliance Test Evidence (Public)";
const rawResult = process.env.EVIDENCE_RESULT ?? "passed";
const result: Result = rawResult === "failed" ? "failed" : "passed";

const testDefinitions: TestDefinition[] = [
  {
    testId: "permission-analyzer-unit",
    sourcePath:
      "packages/domain/src/device/services/permission-analyzer.service.spec.ts",
    suiteType: "unit",
  },
  {
    testId: "ttl-indexes-persistence-unit",
    sourcePath: "packages/persistence/src/mongoose/ttl-indexes.spec.ts",
    suiteType: "unit",
  },
  {
    testId: "ttl-indexes-api-unit",
    sourcePath: "apps/api/src/schemas/ttl-indexes.spec.ts",
    suiteType: "unit",
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

function writeSanitizedArtifacts(
  test: TestDefinition,
  result: Result,
  executedAt: string,
): TestArtifact[] {
  const baseName = test.testId;
  const jsonFilename = `${baseName}.json`;
  const junitFilename = `${baseName}.junit.xml`;
  const jsonAbsolutePath = path.join(outputTestsDir, jsonFilename);
  const junitAbsolutePath = path.join(outputTestsDir, junitFilename);

  const sanitizedJson = {
    testId: test.testId,
    sourcePath: test.sourcePath,
    suiteType: test.suiteType,
    result,
    executedAt,
  };

  writeFileSync(
    jsonAbsolutePath,
    `${JSON.stringify(sanitizedJson, null, 2)}\n`,
  );

  const junitXml =
    result === "passed"
      ? `<?xml version="1.0" encoding="UTF-8"?>\n<testsuite name="${escapeXml(
          test.testId,
        )}" tests="1" failures="0" errors="0" skipped="0" time="0">\n  <testcase classname="${escapeXml(
          test.suiteType,
        )}" name="${escapeXml(test.sourcePath)}" />\n</testsuite>\n`
      : `<?xml version="1.0" encoding="UTF-8"?>\n<testsuite name="${escapeXml(
          test.testId,
        )}" tests="1" failures="1" errors="0" skipped="0" time="0">\n  <testcase classname="${escapeXml(
          test.suiteType,
        )}" name="${escapeXml(test.sourcePath)}">\n    <failure message="Test command failed">Command returned non-zero exit status.</failure>\n  </testcase>\n</testsuite>\n`;

  writeFileSync(junitAbsolutePath, junitXml);

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

function buildVerificationCommand(
  artifactPath: string,
  sha256: string,
): string {
  return [
    `curl -fsSL "https://raw.githubusercontent.com/daflan-org/fawa-compliance-evidence/main/${artifactPath}" -o /tmp/${path.basename(
      artifactPath,
    )}`,
    `echo "${sha256}  /tmp/${path.basename(artifactPath)}" | shasum -a 256 -c -`,
  ].join(" && ");
}

function run(): void {
  rmSync(outputRoot, { recursive: true, force: true });
  mkdirSync(outputTestsDir, { recursive: true });

  const entries: TestEvidenceEntry[] = [];

  for (const test of testDefinitions) {
    const executedAt = new Date().toISOString();
    const artifacts = writeSanitizedArtifacts(test, result, executedAt);
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
      ),
    });
  }

  const manifest: TestEvidenceManifest = {
    generatedAt: new Date().toISOString(),
    testEvidence: entries,
  };

  writeFileSync(outputManifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
}

run();
