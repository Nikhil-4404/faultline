import { fileURLToPath } from "node:url";
import { ensureDemo } from "../packages/runner/src/demo.ts";

const demo = await ensureDemo(fileURLToPath(new URL("..", import.meta.url)));
console.log(
  `Reference repository ready: ${demo.repository}\nRevisions: ${demo.baseRef} → ${demo.headRef}\nExisting files were preserved.`,
);
