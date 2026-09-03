import { WorkspaceError } from "./manager.js";

export const MAX_WORKSPACE_GLOB_LENGTH = 512;
const MAX_GLOB_ALTERNATIVES = 32;

export interface CompiledWorkspaceGlob {
  normalized: string;
  alternatives: string[];
  regex: RegExp;
}

function invalidGlob(message: string): never {
  throw new WorkspaceError("INVALID_PATH", `Invalid workspace glob: ${message}`);
}

function expandBraceAlternatives(glob: string): string[] {
  let alternatives = [""];

  for (let index = 0; index < glob.length;) {
    const char = glob[index];
    if (char === "}") invalidGlob("unmatched '}'");

    if (char !== "{") {
      alternatives = alternatives.map((prefix) => prefix + char);
      index++;
      continue;
    }

    const close = glob.indexOf("}", index + 1);
    if (close === -1) invalidGlob("unmatched '{'");
    const body = glob.slice(index + 1, close);
    if (body.includes("{") || body.includes("}")) {
      invalidGlob("nested brace alternatives are not supported");
    }
    const choices = body.split(",");
    if (choices.length < 2 || choices.some((choice) => choice.length === 0)) {
      invalidGlob("brace alternatives must contain at least two non-empty choices");
    }
    if (alternatives.length * choices.length > MAX_GLOB_ALTERNATIVES) {
      invalidGlob(`brace expansion exceeds ${MAX_GLOB_ALTERNATIVES} alternatives`);
    }

    alternatives = alternatives.flatMap((prefix) => choices.map((choice) => prefix + choice));
    index = close + 1;
  }

  return alternatives;
}

function escapeRegexChar(char: string): string {
  return /[\\.^$+()|{}]/.test(char) ? `\\${char}` : char;
}

function simpleGlobSource(pattern: string): string {
  let source = "";
  for (let index = 0; index < pattern.length;) {
    if (pattern.startsWith("**/", index)) {
      source += "(?:.*/)?";
      index += 3;
      continue;
    }
    if (pattern.startsWith("**", index)) {
      source += ".*";
      index += 2;
      continue;
    }

    const char = pattern[index];
    if (char === "*") source += "[^/]*";
    else if (char === "?") source += "[^/]";
    else source += escapeRegexChar(char);
    index++;
  }
  return `(?:^|/)${source}$`;
}

export function compileWorkspaceGlob(input: string): CompiledWorkspaceGlob {
  if (typeof input !== "string" || input.includes("\0") || /[\r\n]/.test(input)) {
    invalidGlob("glob must be a single text line");
  }

  const normalized = input.trim().replace(/\\/g, "/");
  if (normalized.length === 0) invalidGlob("glob cannot be empty");
  if (normalized.length > MAX_WORKSPACE_GLOB_LENGTH) {
    invalidGlob(`glob exceeds ${MAX_WORKSPACE_GLOB_LENGTH} characters`);
  }
  if (normalized.includes("[") || normalized.includes("]")) {
    invalidGlob("character classes are not part of the frozen ChatX glob contract");
  }

  const alternatives = expandBraceAlternatives(normalized);
  const source = alternatives.map(simpleGlobSource).join("|");
  return {
    normalized,
    alternatives,
    regex: new RegExp(`(?:${source})`),
  };
}
