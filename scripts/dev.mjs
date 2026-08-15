import { spawn } from "node:child_process";
import process from "node:process";

const children = [
  spawn(process.execPath, ["--watch", "server/index.mjs"], {
    stdio: "inherit",
    env: process.env,
  }),
  spawn(process.execPath, ["node_modules/vite/bin/vite.js", "--host", "127.0.0.1", "--port", "5174"], {
    stdio: "inherit",
    env: process.env,
  }),
];

let stopping = false;
function stop(exitCode = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) child.kill();
  process.exitCode = exitCode;
}

process.on("SIGINT", () => stop(0));
process.on("SIGTERM", () => stop(0));

for (const child of children) {
  child.on("exit", (code) => {
    if (!stopping && code && code !== 0) stop(code);
  });
}
