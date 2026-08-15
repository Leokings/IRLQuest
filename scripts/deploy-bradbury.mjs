import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { createAccount, createClient } from "genlayer-js";
import { testnetBradbury } from "genlayer-js/chains";
import { ExecutionResult, TransactionStatus } from "genlayer-js/types";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const projectDir = dirname(scriptDir);
dotenv.config({ path: join(projectDir, ".env"), override: false, quiet: true });
dotenv.config({ path: join(projectDir, "..", ".env.local"), override: false, quiet: true });

const EXPECTED_CHAIN_ID = 4221;
const EXPECTED_RPC_HOST = "rpc-bradbury.genlayer.com";
const CONTRACT_PATH = join(projectDir, "contracts", "IRLQuestVerifier.py");
const DEPLOYMENT_PATH = join(projectDir, "deployments", "bradbury.json");

if (existsSync(DEPLOYMENT_PATH) && process.env.IRLQUEST_FORCE_DEPLOY !== "true") {
  const existing = JSON.parse(readFileSync(DEPLOYMENT_PATH, "utf8"));
  throw new Error(
    `IRLQuestVerifier is already recorded at ${existing.contractAddress}. `
      + "Set IRLQUEST_FORCE_DEPLOY=true only when intentionally replacing it.",
  );
}

function required(name, fallbacks = []) {
  for (const key of [name, ...fallbacks]) {
    const value = process.env[key]?.trim();
    if (value) return value;
  }
  throw new Error(`${name} is required`);
}

async function rpc(rpcUrl, method, params = []) {
  const response = await fetch(rpcUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const body = await response.json();
  if (!response.ok || body.error) {
    throw new Error(`${method} failed: ${body.error?.message || response.status}`);
  }
  return body.result;
}

function deploymentAddress(receipt) {
  return receipt?.data?.contract_address
    || receipt?.txDataDecoded?.contractAddress
    || receipt?.tx_data_decoded?.contract_address
    || receipt?.to_address
    || receipt?.recipient;
}

function executionSucceeded(receipt) {
  const name = receipt?.txExecutionResultName || receipt?.tx_execution_result_name;
  if (name) return name === ExecutionResult.FINISHED_WITH_RETURN || name === "FINISHED_WITH_RETURN";
  const numeric = receipt?.txExecutionResult ?? receipt?.tx_execution_result;
  return numeric === undefined ? false : Number(numeric) === 1;
}

const rpcUrl = required("GENLAYER_RPC_URL");
const privateKey = required("GENLAYER_RELAYER_PRIVATE_KEY", ["GENLAYER_RESOLVER_PRIVATE_KEY"]);
const configuredAddress = required("GENLAYER_RELAYER_ADDRESS", [
  "GENLAYER_RESOLVER_ADDRESS",
  "GENLAYER_ADMIN_ADDRESS",
]);
const rpcHost = new URL(rpcUrl).hostname.toLowerCase();
if (rpcHost !== EXPECTED_RPC_HOST) {
  throw new Error(`Refusing deployment through ${rpcHost}; expected ${EXPECTED_RPC_HOST}`);
}
const actualChainId = Number(BigInt(await rpc(rpcUrl, "eth_chainId")));
if (actualChainId !== EXPECTED_CHAIN_ID) {
  throw new Error(`Refusing deployment on chain ${actualChainId}; expected ${EXPECTED_CHAIN_ID}`);
}

const account = createAccount(privateKey);
if (account.address.toLowerCase() !== configuredAddress.toLowerCase()) {
  throw new Error("The workspace private key does not match its configured relayer address");
}
const balanceWei = BigInt(await rpc(rpcUrl, "eth_getBalance", [account.address, "latest"]));
if (balanceWei === 0n) throw new Error("The configured Bradbury relayer has no GEN");

const source = readFileSync(CONTRACT_PATH, "utf8");
if (!source.startsWith('# { "Depends": "py-genlayer:')) {
  throw new Error("The verifier contract is missing its pinned GenVM runner header");
}
const sourceSha256 = createHash("sha256").update(source, "utf8").digest("hex");
const client = createClient({ chain: testnetBradbury, endpoint: rpcUrl, account });

console.log(`Deploying IRLQuestVerifier to Bradbury from ${account.address}...`);
console.log(`Source SHA-256: ${sourceSha256}`);
const deploymentTransaction = await client.deployContract({
  account,
  code: source,
  args: [configuredAddress],
  leaderOnly: false,
});
console.log(`Deployment transaction: ${deploymentTransaction}`);

const receipt = await client.waitForTransactionReceipt({
  hash: deploymentTransaction,
  status: TransactionStatus.ACCEPTED,
  retries: 120,
  interval: 3_000,
  fullTransaction: false,
});
if (!executionSucceeded(receipt)) {
  throw new Error(`Deployment was accepted without successful execution: ${JSON.stringify(receipt)}`);
}
const contractAddress = deploymentAddress(receipt);
if (!contractAddress) throw new Error("The accepted deployment receipt contains no contract address");

const [deployedCode, schema, policy, resultCount] = await Promise.all([
  client.getContractCode(contractAddress),
  client.getContractSchema(contractAddress),
  client.readContract({
    address: contractAddress,
    functionName: "get_policy",
    args: [],
    jsonSafeReturn: true,
    transactionHashVariant: "latest-nonfinal",
  }),
  client.readContract({
    address: contractAddress,
    functionName: "get_result_count",
    args: [],
    jsonSafeReturn: false,
    transactionHashVariant: "latest-nonfinal",
  }),
]);
const deployedSourceSha256 = createHash("sha256").update(deployedCode, "utf8").digest("hex");
if (deployedCode !== source || deployedSourceSha256 !== sourceSha256) {
  throw new Error("The deployed contract source does not match the local verifier source byte-for-byte");
}
for (const [method, readonly] of new Map([
  ["get_policy", true],
  ["has_result", true],
  ["get_result", true],
  ["get_result_count", true],
  ["verify_submission", false],
])) {
  if (!schema?.methods?.[method] || Boolean(schema.methods[method].readonly) !== readonly) {
    throw new Error(`The deployed schema is missing the expected ${method} method`);
  }
}
if (policy?.policy_version !== "irlquest.photo-proof.v2") {
  throw new Error(`Unexpected deployed policy version: ${policy?.policy_version}`);
}
if (String(policy?.owner).toLowerCase() !== account.address.toLowerCase()) {
  throw new Error(`Unexpected deployed owner: ${policy?.owner}`);
}
if (Number(resultCount) !== 0) throw new Error("A fresh verifier must contain zero results");

const result = {
  schema: "irlquest/deployment/v1",
  network: "testnet-bradbury",
  chainId: actualChainId,
  status: "ACCEPTED",
  contractAddress,
  deploymentTransaction,
  deployer: account.address,
  owner: policy.owner,
  policyVersion: policy.policy_version,
  sourceSha256,
  deployedSourceSha256,
  sourceByteForByteMatch: true,
  initialResultCount: Number(resultCount),
  explorerContract: `https://explorer-bradbury.genlayer.com/address/${contractAddress}`,
  explorerDeploymentTransaction: `https://explorer-bradbury.genlayer.com/tx/${deploymentTransaction}`,
  verifiedAt: new Date().toISOString(),
};
console.log("IRLQUEST_DEPLOYMENT_RESULT=" + JSON.stringify(result));
