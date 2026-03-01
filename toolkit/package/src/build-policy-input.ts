import { writeFileSync } from "node:fs";

interface PolicyInput {
  context: {
    branch: string;
    eventName: string;
  };
  changedFiles: string[];
}

function parseChangedFiles(rawChangedFiles: string): string[] {
  try {
    const changedFiles = JSON.parse(rawChangedFiles) as unknown;
    if (!Array.isArray(changedFiles)) {
      throw new Error("CHANGED_FILES_JSON must be a JSON array.");
    }
    return changedFiles.map((value) => String(value));
  } catch {
    // GitHub Actions outputs can arrive as escaped JSON arrays (e.g. [\"a\",\"b\"]).
    const normalizedRawChangedFiles = rawChangedFiles.replace(/\\"/g, '"');
    const changedFiles = JSON.parse(normalizedRawChangedFiles) as unknown;
    if (!Array.isArray(changedFiles)) {
      throw new Error("CHANGED_FILES_JSON must be a JSON array.");
    }
    return changedFiles.map((value) => String(value));
  }
}

export function runBuildPolicyInput(): void {
  const eventName = process.env.GITHUB_EVENT_NAME ?? "";
  const branch =
    eventName === "pull_request"
      ? (process.env.GITHUB_HEAD_REF ??
        process.env.GITHUB_REF_NAME ??
        process.env.BRANCH_NAME ??
        "")
      : (process.env.GITHUB_REF_NAME ?? process.env.BRANCH_NAME ?? "");
  const rawChangedFiles = process.env.CHANGED_FILES_JSON ?? "[]";

  const input: PolicyInput = {
    context: {
      branch,
      eventName,
    },
    changedFiles: parseChangedFiles(rawChangedFiles),
  };

  writeFileSync(
    "policy-input.json",
    `${JSON.stringify(input, null, 2)}\n`,
    "utf-8",
  );
}
