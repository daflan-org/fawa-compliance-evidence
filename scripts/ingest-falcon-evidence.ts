import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

type JsonObject = Record<string, unknown>;

interface DispatchPayload {
  source_repo: string;
  source_ref: string;
  source_sha: string;
  environment: string;
  ci_run_id: string;
  ci_artifact_name: string;
  policy_artifact_name: string;
  deploy_run_id: string;
  deploy_workflow_name: string;
  deploy_run_number: string;
  api_image: string;
  api_digest: string;
  worker_image: string;
  worker_digest: string;
}

interface WorkflowRunResponse {
  head_sha: string;
  conclusion: string | null;
  html_url: string;
  run_number: number;
}

interface WorkflowJobResponse {
  name: string;
  status: string;
  conclusion: string | null;
  started_at: string | null;
  completed_at: string | null;
  html_url: string;
}

interface WorkflowJobsResponse {
  jobs?: WorkflowJobResponse[];
}

interface WorkflowArtifactResponse {
  name: string;
  expired: boolean;
}

interface WorkflowArtifactsResponse {
  artifacts?: WorkflowArtifactResponse[];
}

interface NormalizedJob {
  name: string;
  status: string;
  conclusion: string | null;
  startedAt: string | null;
  completedAt: string | null;
  htmlUrl: string;
}

interface IngestOutput {
  schemaVersion: "1.0.0";
  generatedAt: string;
  source: {
    owner: string;
    repo: string;
    ref: string;
    commitSha: string;
  };
  environment: string;
  dispatchPayload: {
    sourceRepo: string;
    deployWorkflowName: string;
    deployRunNumber: string;
  };
  ci: {
    runId: string;
    runNumber: string;
    htmlUrl: string;
    artifactName: string;
    policyArtifactName: string;
    conclusion: string | null;
  };
  deploy: {
    runId: string;
    runNumber: string;
    workflowName: string;
    htmlUrl: string;
    conclusion: string | null;
    jobs: NormalizedJob[];
  };
  images: {
    api: {
      image: string;
      digest: string;
    };
    worker: {
      image: string;
      digest: string;
    };
  };
}

const payloadPath: string =
  process.env.DISPATCH_PAYLOAD_PATH ?? "out/dispatch/payload.json";
const outputPath: string =
  process.env.INGEST_OUTPUT_PATH ?? "out/ingest/falcon.json";
const falconToken: string | undefined = process.env.FALCON_TOKEN;
const falconOwner: string = process.env.FALCON_OWNER ?? "panalgin";
const falconRepo: string = process.env.FALCON_REPO ?? "falcon";

const expectedSourceRepo = `${falconOwner}/${falconRepo}`;
const requiredDeployJobs: string[] = [
  "sign_and_attest",
  "deploy_api",
  "deploy_worker",
  "finalize_healthcheck",
];

function readJson<T>(filePath: string): T {
  return JSON.parse(readFileSync(filePath, "utf-8")) as T;
}

function assertString(payload: JsonObject, key: string): string {
  const value = payload[key];
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`Missing required payload field: ${key}`);
  }
  return value.trim();
}

function parseDispatchPayload(raw: JsonObject): DispatchPayload {
  return {
    source_repo: assertString(raw, "source_repo"),
    source_ref: assertString(raw, "source_ref"),
    source_sha: assertString(raw, "source_sha"),
    environment: assertString(raw, "environment"),
    ci_run_id: assertString(raw, "ci_run_id"),
    ci_artifact_name: assertString(raw, "ci_artifact_name"),
    policy_artifact_name: assertString(raw, "policy_artifact_name"),
    deploy_run_id: assertString(raw, "deploy_run_id"),
    deploy_workflow_name: assertString(raw, "deploy_workflow_name"),
    deploy_run_number: assertString(raw, "deploy_run_number"),
    api_image: assertString(raw, "api_image"),
    api_digest: assertString(raw, "api_digest"),
    worker_image: assertString(raw, "worker_image"),
    worker_digest: assertString(raw, "worker_digest"),
  };
}

function toRunId(value: string, key: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`Invalid numeric payload field: ${key}='${value}'`);
  }
  return parsed;
}

async function ghApi<T>(pathname: string): Promise<T> {
  if (!falconToken) {
    throw new Error("Missing FALCON_TOKEN environment variable.");
  }
  const response = await fetch(`https://api.github.com${pathname}`, {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${falconToken}`,
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "fawa-evidence-verifier",
    },
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(
      `GitHub API request failed (${response.status}) for ${pathname}: ${body}`,
    );
  }
  return (await response.json()) as T;
}

function normalizeJob(job: WorkflowJobResponse): NormalizedJob {
  return {
    name: job.name,
    status: job.status,
    conclusion: job.conclusion,
    startedAt: job.started_at,
    completedAt: job.completed_at,
    htmlUrl: job.html_url,
  };
}

async function run(): Promise<void> {
  const rawPayload = readJson<JsonObject>(payloadPath);
  const payload = parseDispatchPayload(rawPayload);

  if (payload.source_repo !== expectedSourceRepo) {
    throw new Error(
      `Unexpected source_repo '${payload.source_repo}', expected '${expectedSourceRepo}'.`,
    );
  }

  const ciRunId = toRunId(payload.ci_run_id, "ci_run_id");
  const deployRunId = toRunId(payload.deploy_run_id, "deploy_run_id");

  const deployRun = await ghApi<WorkflowRunResponse>(
    `/repos/${falconOwner}/${falconRepo}/actions/runs/${deployRunId}`,
  );
  if (deployRun.head_sha !== payload.source_sha) {
    throw new Error(
      `Deploy run ${deployRunId} head_sha mismatch: expected ${payload.source_sha}, got ${deployRun.head_sha}.`,
    );
  }
  if (deployRun.conclusion !== "success") {
    throw new Error(
      `Deploy run ${deployRunId} conclusion is '${deployRun.conclusion}', expected 'success'.`,
    );
  }

  const deployJobsResp = await ghApi<WorkflowJobsResponse>(
    `/repos/${falconOwner}/${falconRepo}/actions/runs/${deployRunId}/jobs?per_page=100`,
  );
  const deployJobs = deployJobsResp.jobs ?? [];
  const deployFailures: string[] = [];

  for (const requiredJob of requiredDeployJobs) {
    const job = deployJobs.find((item) => item.name === requiredJob);
    if (!job) {
      deployFailures.push(`missing required job '${requiredJob}'`);
      continue;
    }
    if (job.conclusion !== "success") {
      deployFailures.push(
        `job '${requiredJob}' conclusion is '${job.conclusion ?? "unknown"}'`,
      );
    }
  }

  if (deployFailures.length > 0) {
    throw new Error(
      `Deploy run ${deployRunId} failed verification: ${deployFailures.join("; ")}`,
    );
  }

  const ciRun = await ghApi<WorkflowRunResponse>(
    `/repos/${falconOwner}/${falconRepo}/actions/runs/${ciRunId}`,
  );
  if (ciRun.head_sha !== payload.source_sha) {
    throw new Error(
      `CI run ${ciRunId} head_sha mismatch: expected ${payload.source_sha}, got ${ciRun.head_sha}.`,
    );
  }
  if (ciRun.conclusion !== "success") {
    throw new Error(
      `CI run ${ciRunId} conclusion is '${ciRun.conclusion}', expected 'success'.`,
    );
  }

  const ciArtifactsResp = await ghApi<WorkflowArtifactsResponse>(
    `/repos/${falconOwner}/${falconRepo}/actions/runs/${ciRunId}/artifacts?per_page=100`,
  );
  const ciArtifacts = ciArtifactsResp.artifacts ?? [];
  const artifactNames: string[] = ciArtifacts
    .filter((item) => !item.expired)
    .map((item) => item.name);

  for (const expectedArtifact of [
    payload.ci_artifact_name,
    payload.policy_artifact_name,
  ]) {
    if (!artifactNames.includes(expectedArtifact)) {
      throw new Error(
        `CI run ${ciRunId} is missing artifact '${expectedArtifact}'. Available: ${artifactNames.join(", ") || "none"}.`,
      );
    }
  }

  const output: IngestOutput = {
    schemaVersion: "1.0.0",
    generatedAt: new Date().toISOString(),
    source: {
      owner: falconOwner,
      repo: falconRepo,
      ref: payload.source_ref,
      commitSha: payload.source_sha,
    },
    environment: payload.environment,
    dispatchPayload: {
      sourceRepo: payload.source_repo,
      deployWorkflowName: payload.deploy_workflow_name,
      deployRunNumber: payload.deploy_run_number,
    },
    ci: {
      runId: String(ciRunId),
      runNumber: String(ciRun.run_number),
      htmlUrl: ciRun.html_url,
      artifactName: payload.ci_artifact_name,
      policyArtifactName: payload.policy_artifact_name,
      conclusion: ciRun.conclusion,
    },
    deploy: {
      runId: String(deployRunId),
      runNumber: payload.deploy_run_number,
      workflowName: payload.deploy_workflow_name,
      htmlUrl: deployRun.html_url,
      conclusion: deployRun.conclusion,
      jobs: deployJobs
        .filter((job) => !job.name.startsWith("publish_evidence"))
        .map(normalizeJob),
    },
    images: {
      api: {
        image: payload.api_image,
        digest: payload.api_digest,
      },
      worker: {
        image: payload.worker_image,
        digest: payload.worker_digest,
      },
    },
  };

  mkdirSync(path.dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, `${JSON.stringify(output, null, 2)}\n`, "utf-8");
}

run().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  // eslint-disable-next-line no-console
  console.error(`[ingest-falcon-evidence] ${message}`);
  process.exit(1);
});
