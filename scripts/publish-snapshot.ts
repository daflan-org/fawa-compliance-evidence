import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

interface EvidencePayload {
  generatedAt: string;
  source?: {
    ref?: string;
    commitSha?: string;
  };
  verification?: {
    ciRunId?: string;
    deployRunId?: string;
  };
}

interface HistorySnapshot {
  snapshot: string;
  generatedAt: string;
  sourceRef: string;
  sourceCommitSha: string;
  ciRunId: string;
  deployRunId: string;
}

interface HistoryIndex {
  snapshots: HistorySnapshot[];
}

const currentDir: string = process.env.CURRENT_DIR ?? "current";
const historyDir: string = process.env.HISTORY_DIR ?? "history";
const historyIndexPath: string = path.join(historyDir, "index.json");

function readJson<T>(filePath: string): T {
  return JSON.parse(readFileSync(filePath, "utf-8")) as T;
}

function formatSnapshotTimestamp(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Invalid generatedAt value: ${value}`);
  }
  return date
    .toISOString()
    .replaceAll("-", "")
    .replaceAll(":", "")
    .replace(".000", "");
}

function ensureCurrentEvidence(): EvidencePayload {
  const evidencePath = path.join(currentDir, "evidence.json");
  if (!existsSync(evidencePath)) {
    throw new Error(`Missing evidence file at ${evidencePath}`);
  }
  return readJson<EvidencePayload>(evidencePath);
}

function copyIfExists(sourcePath: string, destinationPath: string): boolean {
  if (!existsSync(sourcePath)) {
    return false;
  }
  mkdirSync(path.dirname(destinationPath), { recursive: true });
  cpSync(sourcePath, destinationPath, { recursive: true });
  return true;
}

function loadHistoryIndex(): HistoryIndex {
  if (!existsSync(historyIndexPath)) {
    return { snapshots: [] };
  }
  const parsed = readJson<Partial<HistoryIndex>>(historyIndexPath);
  if (!Array.isArray(parsed.snapshots)) {
    return { snapshots: [] };
  }
  return { snapshots: parsed.snapshots };
}

function run(): void {
  const evidence = ensureCurrentEvidence();
  const timestamp = formatSnapshotTimestamp(evidence.generatedAt);
  const commitSha = evidence.source?.commitSha ?? "unknown";
  const shortSha = String(commitSha).slice(0, 12);
  const snapshotName = `${timestamp}-${shortSha}`;
  const snapshotDir = path.join(historyDir, snapshotName);

  rmSync(snapshotDir, { recursive: true, force: true });
  mkdirSync(snapshotDir, { recursive: true });

  copyIfExists(
    path.join(currentDir, "evidence.json"),
    path.join(snapshotDir, "evidence.json"),
  );
  copyIfExists(
    path.join(currentDir, "deploy-run.json"),
    path.join(snapshotDir, "deploy-run.json"),
  );
  copyIfExists(
    path.join(currentDir, "trust-evidence.md"),
    path.join(snapshotDir, "trust-evidence.md"),
  );
  copyIfExists(
    path.join(currentDir, "store-compliance.md"),
    path.join(snapshotDir, "store-compliance.md"),
  );
  copyIfExists(path.join(currentDir, "tests"), path.join(snapshotDir, "tests"));

  const historyIndex = loadHistoryIndex();
  const snapshots = historyIndex.snapshots.filter(
    (item) => item.snapshot !== `history/${snapshotName}`,
  );
  snapshots.unshift({
    snapshot: `history/${snapshotName}`,
    generatedAt: evidence.generatedAt,
    sourceRef: evidence.source?.ref ?? "unknown",
    sourceCommitSha: commitSha,
    ciRunId: evidence.verification?.ciRunId ?? "",
    deployRunId: evidence.verification?.deployRunId ?? "",
  });

  mkdirSync(historyDir, { recursive: true });
  writeFileSync(
    historyIndexPath,
    `${JSON.stringify({ snapshots }, null, 2)}\n`,
    "utf-8",
  );
}

run();
