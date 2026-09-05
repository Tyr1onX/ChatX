import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { classifyAuditResult } from "../scripts/production-audit.mjs";
import { scanText } from "../scripts/secret-scan.mjs";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

describe("release security gate", () => {
  it("distinguishes clean, vulnerable, and unavailable dependency audit results", () => {
    expect(classifyAuditResult(0, "")).toBe("pass");
    expect(
      classifyAuditResult(1, JSON.stringify({ metadata: { vulnerabilities: { low: 0, moderate: 1, high: 0, critical: 0, total: 1 } } }))
    ).toBe("vulnerable");
    expect(classifyAuditResult(1, "registry request failed")).toBe("unavailable");
  });

  it("detects high-confidence repository secrets without printing or matching pairing codes", () => {
    const accessToken = ["c2c", "at", "A".repeat(43)].join("_");
    const refreshToken = ["chatx", "rt", "B".repeat(43)].join("_");
    const adminToken = ["c2c", "admin", "C".repeat(32)].join("_");
    expect(scanText(`${accessToken}\n${refreshToken}\n${adminToken}`)).toEqual([
      { line: 1, rule: "chatx-token" },
      { line: 2, rule: "chatx-token" },
      { line: 3, rule: "chatx-token" },
    ]);
    expect(scanText("ABCD-EFGH\n-----BEGIN PRIVATE KEY-----")).toEqual([{ line: 2, rule: "private-key" }]); // secret-scan: allow
  });

  it("supports one explicit line-level ignore marker for fake fixtures", () => {
    const fake = ["c2c", "at", "D".repeat(43)].join("_");
    expect(scanText(`${fake} // secret-scan: allow`)).toEqual([]);
  });

  it("keeps tagged releases wired through the strict security checks", () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(repo, "package.json"), "utf8")) as { scripts: Record<string, string> };
    expect(pkg.scripts["release:check"]).toContain("node scripts/production-audit.mjs");
    expect(pkg.scripts["release:check"]).toContain("node scripts/secret-scan.mjs");
    expect(pkg.scripts["release:check"]).toContain("git diff --check");
    const releaseWorkflow = fs.readFileSync(path.join(repo, ".github/workflows/release.yml"), "utf8");
    expect(releaseWorkflow).toContain("corepack pnpm release:check");
  });
});
