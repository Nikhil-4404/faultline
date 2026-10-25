import { execFileSync, spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = fileURLToPath(new URL("../", import.meta.url));
const portable = path.join(projectRoot, ".faultline", "runtime", "node.exe");
const setup = "pwsh -NoProfile -File scripts/setup-runtime.ps1";

export function supportedVersion(version) {
  const match = /^v?22\.(\d+)\.(\d+)$/.exec(version);
  return !!match && (Number(match[1]) > 23 ||
    (Number(match[1]) === 23 && Number(match[2]) >= 4));
}

export function selectRuntime(version = process.versions.node) {
  if (supportedVersion(version)) return process.execPath;
  if (process.platform !== "win32" || process.arch !== "x64")
    throw new Error("Faultline requires Node.js >=22.23.4 <23. Install a supported Node 22 runtime; portable setup supports Windows x64 only.");
  try {
    const actual = execFileSync(portable, ["--version"], {
      encoding: "utf8", timeout: 5000, maxBuffer: 1024, windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
    if (supportedVersion(actual)) return portable;
  } catch {
    // A missing or unusable portable runtime must not fall back to an older Node.
  }
  throw new Error(`Faultline requires Node.js >=22.23.4 <23. Run: ${setup}`);
}

function launch() {
  let runtime;
  try {
    runtime = selectRuntime();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
    return;
  }
  const child = spawn(runtime, process.argv.slice(2), {
    cwd: projectRoot, stdio: "inherit", windowsHide: true,
  });
  const interrupt = () => {
    // Windows delivers console Ctrl+C to both processes; kill would skip child cleanup.
    if (process.platform !== "win32") child.kill("SIGINT");
  };
  const terminate = () => child.kill("SIGTERM");
  process.on("SIGINT", interrupt);
  process.on("SIGTERM", terminate);
  child.once("error", (error) => {
    console.error(`Unable to start the verified Node runtime: ${error.message}`);
    process.exitCode = 1;
  });
  child.once("exit", (code, signal) => {
    process.removeListener("SIGINT", interrupt);
    process.removeListener("SIGTERM", terminate);
    process.exitCode = code ?? (signal === "SIGINT" ? 130 : signal === "SIGTERM" ? 143 : 1);
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  launch();
