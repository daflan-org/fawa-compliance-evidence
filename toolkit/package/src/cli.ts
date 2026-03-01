#!/usr/bin/env node
import { runBuildPolicyInput } from "./build-policy-input";
import { runMergeTestEvidenceManifests } from "./merge-test-evidence-manifests";
import { runE2eTestEvidence } from "./run-e2e-test-evidence";
import { runTestEvidence } from "./run-test-evidence";

type ToolkitCommand =
  | "build-policy-input"
  | "run-test-evidence"
  | "run-e2e-test-evidence"
  | "merge-test-evidence-manifests";

const handlers: Record<ToolkitCommand, () => void> = {
  "build-policy-input": runBuildPolicyInput,
  "run-test-evidence": runTestEvidence,
  "run-e2e-test-evidence": runE2eTestEvidence,
  "merge-test-evidence-manifests": runMergeTestEvidenceManifests,
};

function printUsage(): void {
  process.stderr.write(
    [
      "Usage: falcon-compliance-toolkit <command>",
      "",
      "Commands:",
      "  build-policy-input",
      "  run-test-evidence",
      "  run-e2e-test-evidence",
      "  merge-test-evidence-manifests",
      "",
    ].join("\n"),
  );
}

function run(): void {
  const command = process.argv[2] as ToolkitCommand | undefined;
  if (!command || !(command in handlers)) {
    printUsage();
    process.exit(1);
  }

  handlers[command]();
}

run();
