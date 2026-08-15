import dotenv from "dotenv";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createApp } from "./app.mjs";
import { createDatabase } from "./database.mjs";
import { createVerificationService } from "./verification.mjs";

const serverDir = dirname(fileURLToPath(import.meta.url));
const projectDir = dirname(serverDir);
dotenv.config({ path: join(projectDir, ".env"), override: false, quiet: true });
dotenv.config({ path: join(projectDir, "..", ".env.local"), override: false, quiet: true });

const deploymentPath = join(projectDir, "deployments", "bradbury.json");
const deployment = existsSync(deploymentPath)
  ? JSON.parse(readFileSync(deploymentPath, "utf8"))
  : null;
if (!process.env.GENLAYER_CONTRACT_ADDRESS && deployment?.contractAddress) {
  process.env.GENLAYER_CONTRACT_ADDRESS = deployment.contractAddress;
}
const dataDir = process.env.IRLQUEST_DATA_DIR || join(projectDir, ".data");
const evidenceDir = join(dataDir, "evidence");
const port = Number(process.env.IRLQUEST_PORT || 8787);
const mode = process.env.IRLQUEST_VERIFIER_MODE === "genlayer" ? "genlayer" : "local";
const evidenceSecret = process.env.IRLQUEST_EVIDENCE_SECRET || "irlquest-local-development-secret-change-me";
const publicBaseUrl = process.env.IRLQUEST_PUBLIC_BASE_URL || `http://127.0.0.1:${port}`;

mkdirSync(dataDir, { recursive: true });
const database = createDatabase({ databasePath: join(dataDir, "irlquest.sqlite") });
const verificationService = createVerificationService({
  database,
  mode,
  delayMs: Number(process.env.IRLQUEST_LOCAL_VERIFIER_DELAY_MS || 1400),
  publicBaseUrl,
  evidenceSecret,
  genLayerConfig: {
    rpcUrl: process.env.GENLAYER_RPC_URL,
    contractAddress: process.env.GENLAYER_CONTRACT_ADDRESS || deployment?.contractAddress,
    privateKey: process.env.GENLAYER_RELAYER_PRIVATE_KEY || process.env.GENLAYER_RESOLVER_PRIVATE_KEY,
  },
});
const app = createApp({
  database,
  verificationService,
  evidenceDir,
  evidenceSecret,
  distDir: join(projectDir, "dist"),
});

verificationService.recoverPending();

const server = app.listen(port, "127.0.0.1", () => {
  console.log(`IRLQuest API listening at http://127.0.0.1:${port} (${mode} verifier)`);
});

function shutdown() {
  server.close(() => {
    database.close();
    process.exit(0);
  });
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
