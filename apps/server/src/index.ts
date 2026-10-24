import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { createApp } from "./app.ts";
const projectRoot = fileURLToPath(new URL("../../../", import.meta.url));
const port = Number(process.env.PORT ?? 4317);
if (!Number.isInteger(port) || port < 1024 || port > 65535)
  throw new Error("PORT must be an integer from 1024 to 65535.");
const app = await createApp({
  projectRoot,
  dataDir: resolve(projectRoot, ".faultline"),
});
app.server.listen(port, "127.0.0.1", () =>
  console.log(`Faultline ready at http://127.0.0.1:${port}`),
);
app.server.on("error", (error) => {
  console.error(error.message);
  process.exitCode = 1;
});
let closing = false;
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.on(signal, () => {
    if (closing) return;
    closing = true;
    void app.shutdown().then(
      () => {
        process.exitCode = 0;
      },
      (error) => {
        console.error(error);
        process.exitCode = 1;
      },
    );
  });
