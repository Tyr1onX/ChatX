import { spawnSync } from "node:child_process";
import process from "node:process";
import { fileURLToPath } from "node:url";
import path from "node:path";

export function classifyAuditResult(status, stdout) {
  if (status === 0) return "pass";
  try {
    const report = JSON.parse(stdout || "{}");
    const counts = report?.metadata?.vulnerabilities;
    const total = typeof counts?.total === "number"
      ? counts.total
      : counts && typeof counts === "object"
        ? Object.entries(counts).reduce((sum, [key, value]) => key === "total" ? sum : sum + (Number(value) || 0), 0)
        : 0;
    if (total > 0 || Object.keys(report?.advisories ?? {}).length > 0) return "vulnerable";
  } catch {
    // Non-JSON output on a failed audit means no vulnerability verdict was produced.
  }
  return "unavailable";
}

function runAudit() {
  const pnpmEntry = process.env.npm_execpath;
  const command = pnpmEntry ? process.execPath : process.platform === "win32" ? "pnpm.cmd" : "pnpm";
  const args = pnpmEntry ? [pnpmEntry, "audit", "--prod", "--json"] : ["audit", "--prod", "--json"];
  const result = spawnSync(command, args, { encoding: "utf8", shell: false, windowsHide: true });
  if (result.error) {
    process.stderr.write(`production dependency audit: UNAVAILABLE (${result.error.message})\n`);
    process.exitCode = 2;
    return;
  }

  const verdict = classifyAuditResult(result.status, result.stdout ?? "");
  if (verdict === "pass") {
    process.stdout.write("production dependency audit: PASS\n");
    return;
  }
  if (verdict === "vulnerable") {
    process.stderr.write("production dependency audit: VULNERABILITIES FOUND\n");
    process.exitCode = 1;
    return;
  }
  process.stderr.write("production dependency audit: UNAVAILABLE; no vulnerability verdict was produced\n");
  if (result.stderr) process.stderr.write(result.stderr);
  process.exitCode = 2;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) runAudit();
