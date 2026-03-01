import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

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
}

interface Manifest {
  generatedAt?: string;
  testEvidence?: TestEvidenceEntry[];
}

const rootDir = process.cwd();
const inputRoot = path.join(rootDir, "out/test-evidence");
const outputPath = path.join(
  inputRoot,
  "compliance-test-evidence-manifest.json",
);

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

function run(): void {
  const manifestFiles = collectManifestFiles(inputRoot).sort((a, b) =>
    a.localeCompare(b),
  );

  const mergedEntries: TestEvidenceEntry[] = [];
  for (const filePath of manifestFiles) {
    const parsed = JSON.parse(readFileSync(filePath, "utf-8")) as Manifest;
    if (Array.isArray(parsed.testEvidence)) {
      mergedEntries.push(...parsed.testEvidence);
    }
  }

  const deduped = new Map<string, TestEvidenceEntry>();
  for (const entry of mergedEntries) {
    deduped.set(entry.testId, entry);
  }

  const output = {
    generatedAt: new Date().toISOString(),
    testEvidence: Array.from(deduped.values()),
  };

  mkdirSync(inputRoot, { recursive: true });
  writeFileSync(outputPath, `${JSON.stringify(output, null, 2)}\n`, "utf-8");
}

run();
