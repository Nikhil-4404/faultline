import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { lstat, readFile, realpath } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import ts from "typescript";
import type {
  AnalysisInput,
  AnalysisResult,
  ChangedSymbol,
  FileChange,
  GraphEdge,
  Impact,
  ScenarioId,
} from "../../shared/src/index.ts";

const execute = promisify(execFile);
const MAX_FILES = 600;
const MAX_FILE_BYTES = 512 * 1024;
const MAX_TOTAL_BYTES = 12 * 1024 * 1024;
const MAX_PATCH = 12_000;
const SOURCE = /\.(?:[cm]?[jt]s|[jt]sx)$/i;
const EXCLUDED =
  /(?:^|\/)(?:node_modules|\.git|dist|build|coverage|\.next|out|vendor|generated|\.cache|\.turbo|secrets|credentials)(?:\/|$)|(?:^|\/)(?:\.env(?:\..*)?|secrets?\.[^/]*|credentials?\.[^/]*)$/i;
type Tree = Map<string, string>;
type RevisionSource = {
  text: string;
  ast: ts.SourceFile;
  symbols: ChangedSymbol[];
};
type DiffEntry = {
  path: string;
  oldPath?: string;
  status: FileChange["status"];
};

function eligible(file: string): boolean {
  return (
    SOURCE.test(file) &&
    !EXCLUDED.test(file) &&
    !file.split("/").some((part) => part === ".." || part === "") &&
    !path.posix.isAbsolute(file) &&
    !file.includes("\\")
  );
}

async function git(
  repository: string,
  args: string[],
  config: string[] = [],
): Promise<string> {
  try {
    const result = await execute(
      "git",
      [
        "--no-pager",
        "--no-optional-locks",
        "--no-lazy-fetch",
        "-c",
        "core.fsmonitor=false",
        "-c",
        "core.quotepath=false",
        ...config,
        "-C",
        repository,
        ...args,
      ],
      {
        encoding: "utf8",
        maxBuffer: 8 * 1024 * 1024,
        timeout: 15_000,
        windowsHide: true,
      },
    );
    return result.stdout;
  } catch {
    // Do not forward Git stderr: repository configuration can contain credentials.
    throw new Error(
      "Git operation failed. Check that the repository and commit references exist and that Git is installed.",
    );
  }
}

function validateRef(ref: string): void {
  if (
    typeof ref !== "string" ||
    ref.length > 180 ||
    !/^[A-Za-z0-9_][A-Za-z0-9_./@^~+-]*$/.test(ref) ||
    ref.includes("..")
  ) {
    throw new Error(
      "Use a branch, tag, commit SHA, or a simple revision such as HEAD~1.",
    );
  }
}

async function resolveCommit(repository: string, ref: string): Promise<string> {
  validateRef(ref);
  const commit = (
    await git(repository, [
      "rev-parse",
      "--verify",
      "--end-of-options",
      `${ref}^{commit}`,
    ])
  ).trim();
  if (!/^[a-f0-9]{40,64}$/i.test(commit))
    throw new Error("The reference did not resolve to a commit.");
  return commit;
}

async function tree(repository: string, commit: string): Promise<Tree> {
  const result = new Map<string, string>();
  for (const record of (
    await git(repository, ["ls-tree", "-r", "-z", commit])
  ).split("\0")) {
    const match = /^(100644|100755) blob ([a-f0-9]+)\t([\s\S]+)$/.exec(record);
    if (match && eligible(match[3])) result.set(match[3], match[2]);
  }
  return result;
}

function symbolsIn(ast: ts.SourceFile): ChangedSymbol[] {
  const symbols: ChangedSymbol[] = [];
  function visit(node: ts.Node): void {
    let name: string | undefined;
    if (
      ts.isFunctionDeclaration(node) ||
      ts.isClassDeclaration(node) ||
      ts.isMethodDeclaration(node) ||
      ts.isInterfaceDeclaration(node) ||
      ts.isTypeAliasDeclaration(node) ||
      ts.isEnumDeclaration(node)
    )
      name = node.name?.getText(ast);
    if (ts.isVariableDeclaration(node)) name = node.name.getText(ast);
    if (name)
      symbols.push({
        name: name.slice(0, 120),
        kind: ts.SyntaxKind[node.kind],
        line: ast.getLineAndCharacterOfPosition(node.getStart(ast)).line + 1,
        endLine: ast.getLineAndCharacterOfPosition(node.getEnd()).line + 1,
      });
    ts.forEachChild(node, visit);
  }
  visit(ast);
  return symbols;
}

function parseSource(file: string, text: string): RevisionSource {
  const ast = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  return { text, ast, symbols: symbolsIn(ast) };
}

function parseChanges(output: string): DiffEntry[] {
  const records = output.split("\0");
  const changes: DiffEntry[] = [];
  for (let index = 0; index < records.length && records[index];) {
    const status = records[index++];
    const first = records[index++];
    if (status[0] === "R" || status[0] === "C") {
      changes.push({
        path: records[index++],
        oldPath: first,
        status: status[0] === "R" ? "renamed" : "added",
      });
    } else
      changes.push({
        path: first,
        status:
          status === "A" ? "added" : status === "D" ? "deleted" : "modified",
      });
  }
  return changes;
}

function parseStats(
  output: string,
): Map<string, { additions: number; deletions: number }> {
  const result = new Map<string, { additions: number; deletions: number }>();
  const records = output.split("\0");
  for (let index = 0; index < records.length && records[index];) {
    const entry = records[index++];
    const first = entry.indexOf("\t");
    const second = entry.indexOf("\t", first + 1);
    let file = entry.slice(second + 1);
    if (!file) {
      index++;
      file = records[index++];
    }
    result.set(file, {
      additions: Number(entry.slice(0, first)) || 0,
      deletions: Number(entry.slice(first + 1, second)) || 0,
    });
  }
  return result;
}

function changedSymbols(
  patch: string,
  before?: RevisionSource,
  after?: RevisionSource,
): ChangedSymbol[] {
  const found = new Map<string, ChangedSymbol>();
  const ranges = [
    ...patch.matchAll(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/gm),
  ];
  for (const [source, offset] of [
    [before, 1],
    [after, 3],
  ] as const) {
    if (!source) continue;
    for (const symbol of source.symbols) {
      if (
        ranges.some((range) => {
          const start = Number(range[offset]);
          const count =
            range[offset + 1] === undefined ? 1 : Number(range[offset + 1]);
          return (
            count > 0 &&
            symbol.line <= start + count - 1 &&
            symbol.endLine >= start
          );
        })
      )
        found.set(`${symbol.kind}:${symbol.name}`, symbol);
    }
  }
  return [...found.values()];
}

function importedPaths(source: RevisionSource): string[] {
  const imports = new Set<string>();
  function visit(node: ts.Node): void {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteralLike(node.moduleSpecifier)
    )
      imports.add(node.moduleSpecifier.text);
    if (
      ts.isImportEqualsDeclaration(node) &&
      ts.isExternalModuleReference(node.moduleReference) &&
      node.moduleReference.expression &&
      ts.isStringLiteralLike(node.moduleReference.expression)
    )
      imports.add(node.moduleReference.expression.text);
    if (
      ts.isCallExpression(node) &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) &&
          node.expression.text === "require")) &&
      node.arguments.length === 1 &&
      ts.isStringLiteralLike(node.arguments[0])
    )
      imports.add(node.arguments[0].text);
    ts.forEachChild(node, visit);
  }
  visit(source.ast);
  return [...imports];
}

function resolveImport(
  file: string,
  specifier: string,
  files: Set<string>,
): string | undefined {
  // shortcut: resolve relative imports only; add tsconfig-aware resolution when supporting aliases.
  if (!specifier.startsWith(".")) return undefined;
  const target = path.posix.normalize(
    path.posix.join(path.posix.dirname(file), specifier),
  );
  if (target.startsWith("../") || target.startsWith("/")) return undefined;
  const stem = target.replace(/\.(?:[cm]?js|jsx)$/i, "");
  const candidates = [
    target,
    ...[".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"].map(
      (ext) => stem + ext,
    ),
    ...[".ts", ".tsx", ".js", ".jsx", ".mts", ".cts", ".mjs", ".cjs"].map(
      (ext) => `${target}/index${ext}`,
    ),
  ];
  return candidates.find((candidate) => files.has(candidate));
}

async function safeWorktreeText(
  repository: string,
  file: string,
): Promise<string | undefined> {
  let current = repository;
  try {
    for (const part of file.split("/")) {
      current = path.join(current, part);
      if ((await lstat(current)).isSymbolicLink()) return undefined;
    }
    const resolved = await realpath(current);
    const relative = path.relative(repository, resolved);
    if (relative.startsWith("..") || path.isAbsolute(relative))
      return undefined;
    const stat = await lstat(resolved);
    if (!stat.isFile() || stat.size > MAX_FILE_BYTES) return undefined;
    return await readFile(resolved, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw new Error("Unable to safely read a tracked source file.");
  }
}

export async function analyzeRepository(
  input: AnalysisInput,
): Promise<AnalysisResult> {
  if (
    !input ||
    typeof input.repository !== "string" ||
    !path.isAbsolute(input.repository) ||
    input.repository.includes("\0")
  )
    throw new Error("Provide an absolute path to a local Git repository.");
  const repository = await realpath(input.repository).catch(() => {
    throw new Error("The repository directory does not exist.");
  });
  const top = await git(repository, ["rev-parse", "--show-toplevel"]);
  const root = await realpath(top.trim());
  if (path.relative(root, repository) !== "")
    throw new Error(
      "Select the repository root directory, not a subdirectory.",
    );
  const baseCommit = await resolveCommit(root, input.baseRef);
  const worktree = input.headRef === "WORKTREE";
  const headCommit = await resolveCommit(
    root,
    worktree ? "HEAD" : input.headRef,
  );
  const filterNames = [
    ...new Set(
      (await git(root, ["config", "--name-only", "--list"]))
        .split(/\r?\n/)
        .flatMap((key) => {
          const match = /^filter\.(.+)\.(?:clean|process|required)$/i.exec(key);
          return match ? [match[1]] : [];
        }),
    ),
  ];
  const filterOverrides = filterNames.flatMap((name) => [
    "-c",
    `filter.${name}.clean=`,
    "-c",
    `filter.${name}.process=`,
    "-c",
    `filter.${name}.required=false`,
  ]);
  const diff = (args: string[]) => git(root, args, filterOverrides);
  const [baseTree, headTree] = await Promise.all([
    tree(root, baseCommit),
    tree(root, headCommit),
  ]);
  if (worktree) {
    // The index may contain newly tracked files; untracked files are deliberately excluded.
    headTree.clear();
    for (const record of (await git(root, ["ls-files", "-z", "--stage"])).split(
      "\0",
    )) {
      const match = /^(100644|100755) [a-f0-9]+ 0\t([\s\S]+)$/.exec(record);
      if (match && eligible(match[2])) headTree.set(match[2], "WORKTREE");
    }
  }
  const warnings = [
    "Static file-level import analysis predicts possible impact; it is not proof of runtime calls or cross-service network dependencies.",
    "Graphs combine base and candidate imports so removed dependencies remain visible. Import aliases, computed imports, reflection, generated code and external packages are not resolved.",
    "Scenario suggestions are keyword heuristics, not verified failure predictions. Experiments are available only for the registered reference application.",
  ];
  if (filterNames.length)
    warnings.push(
      "Git clean/process filters are disabled during analysis so repository filter commands cannot execute; WORKTREE comparisons use raw source bytes.",
    );
  if (worktree)
    warnings.push(
      "WORKTREE reads tracked files currently on disk, including staged additions. Untracked files are excluded; concurrent edits can change the snapshot.",
    );
  const allFiles = [
    ...new Set([...baseTree.keys(), ...headTree.keys()]),
  ].sort();
  if (allFiles.length > MAX_FILES)
    warnings.push(
      `Analysis is limited to ${MAX_FILES} tracked source files; omitted files may affect impact coverage.`,
    );
  const files = allFiles.slice(0, MAX_FILES);
  const before = new Map<string, RevisionSource>();
  const after = new Map<string, RevisionSource>();
  let totalBytes = 0;
  let skipped = 0;
  const readDeadline = Date.now() + 45_000;
  sourceReads: for (const file of files) {
    for (const [manifest, output] of [
      [baseTree, before],
      [headTree, after],
    ] as const) {
      if (Date.now() > readDeadline) {
        warnings.push(
          "The 45-second source-read budget was reached; remaining files are omitted and impact coverage is incomplete.",
        );
        break sourceReads;
      }
      const blob = manifest.get(file);
      if (!blob) continue;
      let text: string | undefined;
      if (worktree && output === after)
        text = await safeWorktreeText(root, file);
      else {
        const size = Number((await git(root, ["cat-file", "-s", blob])).trim());
        if (size > MAX_FILE_BYTES || totalBytes + size > MAX_TOTAL_BYTES) {
          skipped++;
          continue;
        }
        text = await git(root, ["cat-file", "blob", blob]);
      }
      if (text === undefined) {
        skipped++;
        continue;
      }
      const bytes = Buffer.byteLength(text);
      if (
        bytes > MAX_FILE_BYTES ||
        totalBytes + bytes > MAX_TOTAL_BYTES ||
        text.includes("\0")
      ) {
        skipped++;
        continue;
      }
      totalBytes += bytes;
      output.set(file, parseSource(file, text));
    }
  }
  if (skipped)
    warnings.push(
      `${skipped} revision file(s) were missing, symlinks, binary, or exceeded the 512 KiB per-file / 12 MiB total source limits; coverage is incomplete.`,
    );
  const diffArgs = [
    "diff",
    "--no-ext-diff",
    "--no-textconv",
    "--find-renames",
    baseCommit,
    ...(worktree ? [] : [headCommit]),
  ];
  const [names, statsOutput] = await Promise.all([
    diff([...diffArgs, "--name-status", "-z", "--"]),
    diff([...diffArgs, "--numstat", "-z", "--"]),
  ]);
  const stats = parseStats(statsOutput);
  const included = new Set([...before.keys(), ...after.keys()]);
  const entries = parseChanges(names);
  const changes: FileChange[] = [];
  let patchBudgetReached = false;
  for (const entry of entries) {
    if (!eligible(entry.path) && !(entry.oldPath && eligible(entry.oldPath)))
      continue;
    if (
      !included.has(entry.path) &&
      !(entry.oldPath && included.has(entry.oldPath))
    )
      continue;
    // Never include excluded paths in a patch, even when a rename crosses an exclusion boundary.
    const patchPaths = [
      ...new Set(
        [entry.oldPath, entry.path].filter(
          (file): file is string => !!file && eligible(file),
        ),
      ),
    ];
    const complete =
      (entry.status === "added" || before.has(entry.oldPath ?? entry.path)) &&
      (entry.status === "deleted" || after.has(entry.path));
    const withinBudget = Date.now() <= readDeadline;
    if (!withinBudget) patchBudgetReached = true;
    const patch =
      complete && withinBudget
        ? await diff([
            ...diffArgs,
            "--unified=0",
            "--",
            ...patchPaths.map((file) => `:(literal)${file}`),
          ])
        : "[Patch omitted: a revision source was excluded, unavailable, binary, a symlink, or exceeded analysis limits.]";
    const symbolChanges = changedSymbols(
      patch,
      before.get(entry.oldPath ?? entry.path),
      after.get(entry.path),
    );
    const count = stats.get(entry.path) ?? { additions: 0, deletions: 0 };
    changes.push({
      path: entry.path,
      status: entry.status,
      ...count,
      symbols: symbolChanges,
      patch:
        patch.length > MAX_PATCH
          ? `${patch.slice(0, MAX_PATCH)}\n[Patch truncated at ${MAX_PATCH} characters]`
          : patch,
    });
  }
  if (patchBudgetReached)
    warnings.push(
      "The 45-second source/patch budget was reached; remaining patches and changed symbols are omitted.",
    );
  if (entries.length > changes.length)
    warnings.push(
      "Non-source files and excluded, missing or oversized sources are omitted from change totals and patches.",
    );
  const changedPaths = new Set<string>();
  for (const entry of entries)
    if (changes.some((change) => change.path === entry.path)) {
      if (included.has(entry.path)) changedPaths.add(entry.path);
      if (entry.oldPath && included.has(entry.oldPath))
        changedPaths.add(entry.oldPath);
    }
  const edgeMap = new Map<string, GraphEdge>();
  for (const [file, source] of [...before, ...after])
    for (const specifier of importedPaths(source)) {
      const target = resolveImport(file, specifier, included);
      if (target && target !== file)
        edgeMap.set(`${file}\0${target}`, {
          source: file,
          target,
          kind: "import",
          label: specifier,
        });
    }
  const edges = [...edgeMap.values()];
  const reverse = new Map<string, string[]>();
  for (const edge of edges)
    reverse.set(edge.target, [
      ...(reverse.get(edge.target) ?? []),
      edge.source,
    ]);
  const chains = new Map<string, string[]>(
    [...changedPaths].map((file) => [file, [file]]),
  );
  const queue = [...changedPaths].sort();
  for (let index = 0; index < queue.length; index++) {
    const current = queue[index];
    for (const dependent of (reverse.get(current) ?? []).sort())
      if (!chains.has(dependent)) {
        chains.set(dependent, [...chains.get(current)!, dependent]);
        queue.push(dependent);
      }
  }
  const impacts: Impact[] = [...chains]
    .filter(([file]) => !changedPaths.has(file))
    .map(([file, chain]) => ({
      path: file,
      reason: `${file} imports ${chain[chain.length - 2]}; reachable from changed file ${chain[0]}.`,
      chain,
      distance: chain.length - 1,
    }))
    .sort((a, b) => a.distance - b.distance || a.path.localeCompare(b.path));
  const recommendations = new Set<ScenarioId>(["healthy"]);
  const changedText = changes
    .map(
      (change) =>
        `${change.path} ${change.symbols.map((symbol) => symbol.name).join(" ")} ${change.patch}`,
    )
    .join("\n");
  if (/payment|charge|retry|idempoten|timeout/i.test(changedText)) {
    recommendations.add("connection-reset");
    recommendations.add("latency");
  }
  if (
    /fetch|request|payment|checkout|service|http|retry|timeout/i.test(
      changedText,
    )
  )
    recommendations.add("dependency-down");
  return {
    ...input,
    repository: root,
    id: randomUUID(),
    createdAt: new Date().toISOString(),
    repositoryName: path.basename(root),
    baseCommit,
    headCommit,
    summary: {
      filesChanged: changes.length,
      symbolsChanged: changes.reduce(
        (sum, change) => sum + change.symbols.length,
        0,
      ),
      impactedFiles: impacts.length,
      totalFiles: included.size,
    },
    changes,
    graph: {
      nodes: [...included]
        .sort()
        .map((file) => ({
          id: file,
          path: file,
          label: path.posix.basename(file),
          service: file.includes("/")
            ? path.posix.basename(path.posix.dirname(file))
            : "root",
          status: changedPaths.has(file)
            ? "changed"
            : chains.has(file)
              ? "impacted"
              : "unaffected",
          symbols: (after.get(file) ?? before.get(file))!.symbols
            .slice(0, 80)
            .map((symbol) => symbol.name),
        })),
      edges,
    },
    impacts,
    recommendations: [...recommendations],
    warnings,
    experimentEligible: false,
  };
}
