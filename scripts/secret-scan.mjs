import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ALLOW_MARKER = "secret-scan: allow";

const RULES = [
  { name: "chatx-token", pattern: /\b(?:c2c|chatx)_(?:at|rt|admin)_[A-Za-z0-9_-]{24,}\b/ },
  { name: "private-key", pattern: /-----BEGIN (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----/ },
  { name: "github-token", pattern: /\b(?:ghp_[A-Za-z0-9]{36}|github_pat_[A-Za-z0-9_]{50,})\b/ },
  { name: "aws-access-key", pattern: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: "openai-api-key", pattern: /\bsk-(?:proj-)?[A-Za-z0-9_-]{32,}\b/ },
];

export function scanText(text) {
  const matches = [];
  for (const [index, line] of text.split(/\r?\n/).entries()) {
    if (line.includes(ALLOW_MARKER)) continue;
    for (const rule of RULES) {
      if (rule.pattern.test(line)) matches.push({ line: index + 1, rule: rule.name });
    }
  }
  return matches;
}

function repositoryFiles(repo) {
  const result = spawnSync("git", ["ls-files", "-co", "--exclude-standard", "-z"], {
    cwd: repo,
    encoding: "utf8",
    shell: false,
    windowsHide: true,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(result.stderr || "git ls-files failed");
  return result.stdout.split("\0").filter(Boolean);
}

function main() {
  const repo = process.cwd();
  const findings = [];
  for (const rel of repositoryFiles(repo)) {
    const normalized = rel.replaceAll("\\", "/");
    if (normalized.startsWith(".git/") || normalized.includes("/node_modules/")) continue;
    const file = path.join(repo, rel);
    let data;
    try {
      data = fs.readFileSync(file);
    } catch {
      continue;
    }
    if (data.includes(0)) continue;
    const text = data.toString("utf8");
    for (const match of scanText(text)) findings.push({ path: normalized, ...match });
  }

  if (findings.length === 0) {
    process.stdout.write("secret-pattern scan: PASS\n");
    return;
  }
  process.stderr.write(`secret-pattern scan: FAILED (${findings.length} match${findings.length === 1 ? "" : "es"})\n`);
  for (const finding of findings) process.stderr.write(`${finding.path}:${finding.line} [${finding.rule}]\n`);
  process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
