import {
  createHash,
  createPrivateKey,
  createPublicKey,
  createSign,
  createVerify,
  type KeyObject,
} from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

interface PolicyManifest {
  version: string;
  updatedAt: string;
  policy: {
    filePath: string;
    sha256: string;
    signaturePath: string;
    publicKeyPath: string;
    signatureAlgorithm: string;
  };
}

const rootDir = process.cwd();
const manifestPath = path.join(rootDir, "policy/version.json");
const privateKeyRaw = process.env.POLICY_SIGNING_PRIVATE_KEY;

function readJson<T>(filePath: string): T {
  return JSON.parse(readFileSync(filePath, "utf-8")) as T;
}

function normalizePem(value: string): string {
  return value.replaceAll("\r\n", "\n").trim();
}

function ensureFile(filePath: string, label: string): void {
  if (!existsSync(filePath)) {
    throw new Error(`${label} is missing: ${filePath}`);
  }
}

function toPrivateKey(pem: string): KeyObject {
  return createPrivateKey({
    key: pem,
    format: "pem",
  });
}

function buildPublicKeyPem(privateKey: KeyObject): string {
  return createPublicKey(privateKey)
    .export({
      type: "spki",
      format: "pem",
    })
    .toString();
}

function sha256Hex(content: string): string {
  return createHash("sha256").update(content, "utf-8").digest("hex");
}

function signContent(content: string, privateKey: KeyObject): string {
  const signer = createSign("RSA-SHA256");
  signer.update(content, "utf-8");
  signer.end();
  return signer.sign(privateKey).toString("base64");
}

function verifySignature(
  content: string,
  signatureBase64: string,
  publicKeyPem: string,
): void {
  const verifier = createVerify("RSA-SHA256");
  verifier.update(content, "utf-8");
  verifier.end();
  const verified = verifier.verify(
    publicKeyPem,
    Buffer.from(signatureBase64, "base64"),
  );
  if (!verified) {
    throw new Error(
      "Generated signature could not be verified with public key.",
    );
  }
}

function run(): void {
  if (!privateKeyRaw || privateKeyRaw.trim() === "") {
    throw new Error("POLICY_SIGNING_PRIVATE_KEY secret is required.");
  }

  ensureFile(manifestPath, "Policy manifest");
  const manifest = readJson<PolicyManifest>(manifestPath);

  const policyFilePath = path.join(rootDir, manifest.policy.filePath);
  const signatureFilePath = path.join(rootDir, manifest.policy.signaturePath);
  const publicKeyFilePath = path.join(rootDir, manifest.policy.publicKeyPath);

  ensureFile(policyFilePath, "Policy file");
  ensureFile(publicKeyFilePath, "Policy public key");

  const policyContent = readFileSync(policyFilePath, "utf-8");
  const storedPublicKeyPem = readFileSync(publicKeyFilePath, "utf-8");

  const normalizedPrivateKeyPem = privateKeyRaw.replaceAll("\\n", "\n");
  const privateKey = toPrivateKey(normalizedPrivateKeyPem);
  const derivedPublicKeyPem = buildPublicKeyPem(privateKey);

  if (normalizePem(derivedPublicKeyPem) !== normalizePem(storedPublicKeyPem)) {
    throw new Error(
      `POLICY_SIGNING_PRIVATE_KEY does not match ${manifest.policy.publicKeyPath}.`,
    );
  }

  const policySha256 = sha256Hex(policyContent);
  const signatureBase64 = signContent(policyContent, privateKey);
  verifySignature(policyContent, signatureBase64, storedPublicKeyPem);

  writeFileSync(signatureFilePath, `${signatureBase64}\n`, "utf-8");

  const updatedManifest: PolicyManifest = {
    ...manifest,
    updatedAt: new Date().toISOString(),
    policy: {
      ...manifest.policy,
      sha256: policySha256,
      signatureAlgorithm: "sha256-rsa",
    },
  };

  writeFileSync(
    manifestPath,
    `${JSON.stringify(updatedManifest, null, 2)}\n`,
    "utf-8",
  );
}

run();
