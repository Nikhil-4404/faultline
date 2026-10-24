import { mkdir, readdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

/** Single-process durable records. Each replacement is atomic; writes stay ordered. */
export class RecordStore<T extends { id: string }> {
  private records = new Map<string, T>();
  private writes: Promise<void> = Promise.resolve();
  constructor(private directory: string) {}
  async load(): Promise<void> {
    await mkdir(this.directory, { recursive: true });
    for (const name of await readdir(this.directory)) {
      if (!/^[a-f0-9-]{36}\.json$/.test(name)) continue;
      let value: T;
      try {
        value = JSON.parse(
          await readFile(join(this.directory, name), "utf8"),
        ) as T;
      } catch {
        throw new Error(
          `Saved record ${name} is unreadable. Restore it before restarting; no records were deleted.`,
        );
      }
      if (value.id !== name.slice(0, -5))
        throw new Error(`Saved record ${name} has an invalid identity.`);
      this.records.set(value.id, value);
    }
  }
  list(): T[] {
    return [...this.records.values()]
      .reverse()
      .map((value) => structuredClone(value));
  }
  get(id: string): T | undefined {
    const value = this.records.get(id);
    return value ? structuredClone(value) : undefined;
  }
  async put(value: T): Promise<void> {
    if (!/^[a-f0-9-]{36}$/.test(value.id))
      throw new Error("Invalid record identity.");
    const snapshot = JSON.stringify(value, null, 2);
    const write = this.writes
      .catch(() => {})
      .then(async () => {
        const temporary = join(
          this.directory,
          `${value.id}.${randomUUID()}.tmp`,
        );
        await writeFile(temporary, snapshot, {
          encoding: "utf8",
          flag: "wx",
          mode: 0o600,
        });
        await rename(temporary, join(this.directory, `${value.id}.json`));
        this.records.set(value.id, JSON.parse(snapshot) as T);
      });
    this.writes = write;
    await write;
  }
  async flush(): Promise<void> {
    await this.writes;
  }
}
