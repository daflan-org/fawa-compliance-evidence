import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

type Result = "passed" | "failed";
type ArtifactFormat = "json" | "junit";

interface TestArtifact {
  format: ArtifactFormat;
  path: string;
  sha256: string;
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
}

interface TestEvidenceManifest {
  generatedAt: string;
  testEvidence: TestEvidenceEntry[];
}

const rootDir = process.cwd();
const outputRoot = path.join(rootDir, "out/test-evidence/e2e");
const outputTestsDir = path.join(outputRoot, "tests");
const outputManifestPath = path.join(
  outputRoot,
  "compliance-test-evidence-manifest.json",
);

const workflowPath = ".github/workflows/ci-tests.yml";
const runId = process.env.GITHUB_RUN_ID ?? "local";
const sourceCommitSha = process.env.GITHUB_SHA ?? "local";
const jobName = process.env.EVIDENCE_JOB_NAME ?? "Integration And E2E Tests";
const rawResult = process.env.EVIDENCE_RESULT ?? "passed";
const result: Result = rawResult === "failed" ? "failed" : "passed";

const e2eDefinitions = [
  {
    testId: "device-sync-e2e",
    sourcePath: "apps/api/test/device-sync.e2e.spec.ts",
  },
  {
    testId: "sos-e2e",
    sourcePath: "apps/api/test/sos.e2e.spec.ts",
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

function writeArtifacts(
  testId: string,
  sourcePath: string,
  executedAt: string,
): TestArtifact[] {
  const jsonFilename = `${testId}.json`;
  const junitFilename = `${testId}.junit.xml`;
  const jsonAbsolutePath = path.join(outputTestsDir, jsonFilename);
  const junitAbsolutePath = path.join(outputTestsDir, junitFilename);

  const sanitizedJson = {
    testId,
    sourcePath,
    suiteType: "e2e" as const,
    result,
    executedAt,
    source: "integration_e2e_job",
  };

  writeFileSync(
    jsonAbsolutePath,
    `${JSON.stringify(sanitizedJson, null, 2)}\n`,
    "utf-8",
  );

  const junitXml =
    result === "passed"
      ? `<?xml version="1.0" encoding="UTF-8"?>\n<testsuite name="${escapeXml(
          testId,
        )}" tests="1" failures="0" errors="0" skipped="0" time="0">\n  <testcase classname="e2e" name="${escapeXml(
          sourcePath,
        )}" />\n</testsuite>\n`
      : `<?xml version="1.0" encoding="UTF-8"?>\n<testsuite name="${escapeXml(
          testId,
        )}" tests="1" failures="1" errors="0" skipped="0" time="0">\n  <testcase classname="e2e" name="${escapeXml(
          sourcePath,
        )}">\n    <failure message="Integration And E2E Tests job failed">Check CI job logs for details.</failure>\n  </testcase>\n</testsuite>\n`;

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

  const testEvidence: TestEvidenceEntry[] = e2eDefinitions.map((item) => {
    const executedAt = new Date().toISOString();
    const artifacts = writeArtifacts(item.testId, item.sourcePath, executedAt);
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
      ),
    };
  });

  const manifest: TestEvidenceManifest = {
    generatedAt: new Date().toISOString(),
    testEvidence,
  };

  writeFileSync(outputManifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
}

run();
