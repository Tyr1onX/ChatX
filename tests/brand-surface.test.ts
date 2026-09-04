import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.resolve(import.meta.dirname, "..");

function publicFiles(): string[] {
  const topLevel = ["README.md", "README.en.md", "README.zh-CN.md", "CHANGELOG.md", "SECURITY.md", "skill/SKILL.md"];
  const docs = fs.readdirSync(path.join(root, "docs")).filter((name) => name.endsWith(".md")).map((name) => `docs/${name}`);
  const examples = fs.readdirSync(path.join(root, "examples")).map((name) => `examples/${name}`);
  return [...topLevel, ...docs, ...examples];
}

describe("public ChatX brand surface", () => {
  it("does not publish legacy product names or abbreviations", () => {
    const offenders: string[] = [];
    for (const relative of publicFiles()) {
      const content = fs.readFileSync(path.join(root, relative), "utf8");
      if (/Codex with ChatGPT|c2c/i.test(content) || /c2c/i.test(path.basename(relative))) {
        offenders.push(relative);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("publishes ChatX-only example names", () => {
    expect(fs.existsSync(path.join(root, "examples", "chatx.json"))).toBe(true);
    expect(fs.existsSync(path.join(root, "examples", "chatxignore.example"))).toBe(true);
  });
});
