import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("../", import.meta.url));
const children = [
  spawn(process.execPath, ["--import", "tsx", "apps/server/src/index.ts"], {
    cwd: root,
    stdio: "inherit",
    windowsHide: true,
  }),
  spawn(process.execPath, ["node_modules/vite/bin/vite.js"], {
    cwd: root,
    stdio: "inherit",
    windowsHide: true,
  }),
];
let stopping = false;
function stop() {
  if (stopping) return;
  stopping = true;
  for (const child of children) child.kill();
}
for (const signal of ["SIGINT", "SIGTERM"] as const) process.on(signal, stop);
for (const child of children) {
  child.on("error", (error) => {
    console.error(error.message);
    process.exitCode = 1;
    stop();
  });
  child.on("exit", (code) => {
    if (!stopping) {
      process.exitCode = code ?? 1;
      stop();
    }
  });
}
