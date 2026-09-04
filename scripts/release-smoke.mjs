import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const repo = process.cwd();
const pkg = JSON.parse(fs.readFileSync(path.join(repo, "package.json"), "utf8"));
const packDir = fs.mkdtempSync(path.join(os.tmpdir(), "chatx-pack-"));
const installDir = fs.mkdtempSync(path.join(os.tmpdir(), "chatx-install-"));

function run(command, args, opts = {}) {
  const result = spawnSync(command, args, {
    cwd: opts.cwd ?? repo,
    encoding: "utf8",
    windowsHide: true,
    shell: false,
    env: process.env,
    timeout: opts.timeout ?? 120000,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed (${result.status})\n${result.stdout ?? ""}\n${result.stderr ?? ""}`);
  }
  return (result.stdout ?? "").trim();
}

function quoteCmdArg(value) {
  const text = String(value);
  if (!/[\s&|<>^()]/.test(text)) return text;
  return `"${text.replaceAll('"', '""')}"`;
}

function runNpm(args, opts = {}) {
  if (process.platform !== "win32") return run("npm", args, opts);

  // A timeout against `cmd.exe /c npm ...` only terminates cmd.exe and can
  // leave npm's Node process alive with handles open inside installDir. Run
  // npm's JS entrypoint directly when using the standard Windows Node layout
  // so timeout/exit semantics apply to the actual npm process.
  const npmCli = path.join(path.dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js");
  if (fs.existsSync(npmCli)) return run(process.execPath, [npmCli, ...args], opts);

  const command = `npm ${args.map(quoteCmdArg).join(" ")}`;
  return run(process.env.ComSpec || "cmd.exe", ["/d", "/s", "/c", command], opts);
}

function cleanupTempDir(dir) {
  try {
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  } catch (error) {
    // Cleanup is best-effort on ephemeral CI runners. Never let an EBUSY from
    // a temporary directory hide the real pack/install/CLI failure above.
    process.stderr.write(`release-smoke cleanup warning for ${dir}: ${(error instanceof Error ? error.message : String(error))}\n`);
  }
}

try {
  const packed = JSON.parse(runNpm(["pack", "--json", "--pack-destination", packDir]));
  const record = packed[0];
  if (!record?.filename) throw new Error("npm pack did not return a tarball filename");
  const paths = new Set((record.files ?? []).map((item) => item.path));
  for (const required of ["dist/cli/index.js", "bin/chatx.js", "README.md", "LICENSE"]) {
    if (!paths.has(required)) throw new Error(`release tarball is missing ${required}`);
  }
  if ([...paths].some((item) => item.startsWith("tests/") || item.startsWith("src/"))) {
    throw new Error("release tarball unexpectedly contains development source/tests");
  }

  const tarball = path.join(packDir, record.filename);
  fs.writeFileSync(path.join(installDir, "package.json"), JSON.stringify({ private: true }, null, 2));
  runNpm(["install", "--ignore-scripts", "--no-audit", "--no-fund", tarball], {
    cwd: installDir,
    timeout: 180000,
  });

  const installedRoot = path.join(installDir, "node_modules", pkg.name);
  const cli = path.join(installedRoot, "bin", "chatx.js");
  if (!fs.existsSync(cli)) throw new Error("installed package CLI entry is missing");
  const version = run(process.execPath, [cli, "--version"], { cwd: installDir });
  if (version !== pkg.version) throw new Error(`installed CLI version mismatch: expected ${pkg.version}, got ${version}`);

  const binDir = path.join(installDir, "node_modules", ".bin");
  const suffix = process.platform === "win32" ? ".cmd" : "";
  if (!fs.existsSync(path.join(binDir, `chatx${suffix}`))) {
    throw new Error("installed package is missing the ChatX CLI");
  }

  process.stdout.write(`release-smoke ok: ${pkg.name}@${pkg.version}, ${record.entryCount} packed files\n`);
} finally {
  cleanupTempDir(installDir);
  cleanupTempDir(packDir);
}
