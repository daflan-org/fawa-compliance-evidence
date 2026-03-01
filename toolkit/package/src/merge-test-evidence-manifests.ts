import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

type AssertionStatus = "passed" | "failed";

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
  artifacts: Array<{ format: "json" | "junit"; path: string; sha256: string }>;
  verificationCommand: string;
  assertions: TestAssertion[];
}

interface Manifest {
  generatedAt?: string;
  testEvidence?: TestEvidenceEntry[];
}

const requiredTestIds = [
  "permission-analyzer-unit",
  "ttl-indexes-persistence-unit",
  "ttl-indexes-api-unit",
  "device-sync-e2e",
  "sos-e2e",
];

function ensure(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

function validateEntry(entry: TestEvidenceEntry, sourceFile: string): void {
  ensure(
    typeof entry.testId === "string" && entry.testId.length > 0,
    `${sourceFile}: testId is required.`,
  );
  ensure(
    entry.suiteType === "unit" || entry.suiteType === "e2e",
    `${sourceFile}/${entry.testId}: suiteType must be unit|e2e.`,
  );
  ensure(
    entry.result === "passed" || entry.result === "failed",
    `${sourceFile}/${entry.testId}: result must be passed|failed.`,
  );
  ensure(
    typeof entry.executedAt === "string" &&
      Number.isFinite(Date.parse(entry.executedAt)),
    `${sourceFile}/${entry.testId}: executedAt must be a valid ISO datetime.`,
  );
  ensure(
    Array.isArray(entry.assertions) && entry.assertions.length > 0,
    `${sourceFile}/${entry.testId}: assertions must be a non-empty array.`,
  );

  const failedAssertionCount = entry.assertions.filter(
    (assertion) => assertion.status === "failed",
  ).length;
  ensure(
    failedAssertionCount === 0,
    `${sourceFile}/${entry.testId}: found failed assertions (${failedAssertionCount}).`,
  );

  const assertionIds = new Set<string>();
  for (const assertion of entry.assertions) {
    ensure(
      typeof assertion.assertionId === "string" &&
        assertion.assertionId.length > 0,
      `${sourceFile}/${entry.testId}: assertionId is required.`,
    );
    ensure(
      !assertionIds.has(assertion.assertionId),
      `${sourceFile}/${entry.testId}: duplicate assertionId '${assertion.assertionId}'.`,
    );
    assertionIds.add(assertion.assertionId);
  }
}

function collectManifestFiles(dir: string): string[] {
  const entries = readdirSync(dir, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const absolutePath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectManifestFiles(absolutePath));
      continue;
    }

    if (entry.name === "compliance-test-evidence-manifest.json") {
      files.push(absolutePath);
    }
  }

  return files;
}

export function runMergeTestEvidenceManifests(): void {
  const rootDir = process.cwd();
  const inputRoot = path.join(rootDir, "out/test-evidence");
  const outputPath = path.join(
    inputRoot,
    "compliance-test-evidence-manifest.json",
  );

  const manifestFiles = collectManifestFiles(inputRoot).sort((a, b) =>
    a.localeCompare(b),
  );

  const mergedEntries: TestEvidenceEntry[] = [];
  const seenTestIds = new Set<string>();
  for (const filePath of manifestFiles) {
    const parsed = JSON.parse(readFileSync(filePath, "utf-8")) as Manifest;
    if (Array.isArray(parsed.testEvidence)) {
      for (const entry of parsed.testEvidence) {
        validateEntry(entry, filePath);
        ensure(
          !seenTestIds.has(entry.testId),
          `Duplicate testId across manifests: '${entry.testId}' (${filePath})`,
        );
        seenTestIds.add(entry.testId);
        mergedEntries.push(entry);
      }
    }
  }

  for (const requiredTestId of requiredTestIds) {
    ensure(
      seenTestIds.has(requiredTestId),
      `Required testId is missing from merged manifests: ${requiredTestId}`,
    );
  }

  const output = {
    generatedAt: new Date().toISOString(),
    testEvidence: mergedEntries,
  };

  mkdirSync(inputRoot, { recursive: true });
  writeFileSync(outputPath, `${JSON.stringify(output, null, 2)}\n`, "utf-8");
}
