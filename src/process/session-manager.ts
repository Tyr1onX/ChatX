import { randomBytes } from "node:crypto";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { StringDecoder } from "node:string_decoder";
import { Workspace } from "../workspace/manager.js";
import { buildCompatibleProcessEnvironment } from "./compatible-environment.js";
import { prepareSpawnCommand } from "./spawn-command.js";

const MAX_RUNNING_SESSIONS = 8;
const MAX_RETAINED_SESSIONS = 20;
const MAX_BUFFER_CHARS = 512 * 1024;
const DEFAULT_READ_CHARS = 16 * 1024;
const MAX_READ_CHARS = 64 * 1024;

export type ProcessSessionErrorCode =
  | "PROCESS_NOT_FOUND"
  | "PROCESS_NOT_RUNNING"
  | "PROCESS_LIMIT_REACHED"
  | "PROCESS_START_FAILED"
  | "PROCESS_IO_ERROR";

export class ProcessSessionError extends Error {
  constructor(
    public readonly code: ProcessSessionErrorCode,
    message: string
  ) {
    super(message);
    this.name = "ProcessSessionError";
  }
}

export type ManagedProcessStatus = "running" | "exited" | "failed";

interface TextWindowRead {
  text: string;
  requestedOffset: number;
  baseOffset: number;
  nextOffset: number;
  endOffset: number;
  truncatedBefore: boolean;
  hasMore: boolean;
}

class TextWindow {
  private text = "";
  private baseOffset = 0;
  private endOffset = 0;

  append(chunk: string): void {
    if (chunk.length === 0) return;
    this.text += chunk;
    this.endOffset += chunk.length;
    if (this.text.length > MAX_BUFFER_CHARS) {
      const drop = this.text.length - MAX_BUFFER_CHARS;
      this.text = this.text.slice(drop);
      this.baseOffset += drop;
    }
  }

  read(offset: number | undefined, maxChars: number | undefined): TextWindowRead {
    const requestedOffset = Math.max(0, Math.floor(offset ?? this.baseOffset));
    const limit = Math.min(
      MAX_READ_CHARS,
      Math.max(1, Math.floor(maxChars ?? DEFAULT_READ_CHARS))
    );
    const effectiveOffset = Math.min(
      this.endOffset,
      Math.max(this.baseOffset, requestedOffset)
    );
    const start = effectiveOffset - this.baseOffset;
    const text = this.text.slice(start, start + limit);
    const nextOffset = effectiveOffset + text.length;
    return {
      text,
      requestedOffset,
      baseOffset: this.baseOffset,
      nextOffset,
      endOffset: this.endOffset,
      truncatedBefore: requestedOffset < this.baseOffset,
      hasMore: nextOffset < this.endOffset,
    };
  }
}

interface ManagedProcessSession {
  id: string;
  command: string;
  args: string[];
  cwd: string;
  child: ChildProcessWithoutNullStreams;
  status: ManagedProcessStatus;
  startedAt: string;
  endedAt: string | null;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  stdout: TextWindow;
  stderr: TextWindow;
}

export interface StartManagedProcessInput {
  command: string;
  args?: string[];
  cwd?: string;
}

export interface ManagedProcessSummary {
  id: string;
  command: string;
  args: string[];
  cwd: string;
  status: ManagedProcessStatus;
  pid: number | null;
  startedAt: string;
  endedAt: string | null;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
}

function summary(session: ManagedProcessSession): ManagedProcessSummary {
  return {
    id: session.id,
    command: session.command,
    args: [...session.args],
    cwd: session.cwd,
    status: session.status,
    pid: session.child.pid ?? null,
    startedAt: session.startedAt,
    endedAt: session.endedAt,
    exitCode: session.exitCode,
    signal: session.signal,
  };
}

export class ProcessSessionManager {
  private readonly sessions = new Map<string, ManagedProcessSession>();

  constructor(private readonly workspace: Workspace) {}

  private pruneRetainedSessions(): void {
    if (this.sessions.size <= MAX_RETAINED_SESSIONS) return;
    const completed = [...this.sessions.values()]
      .filter((session) => session.status !== "running")
      .sort((a, b) => (a.endedAt ?? "").localeCompare(b.endedAt ?? ""));
    for (const session of completed) {
      if (this.sessions.size <= MAX_RETAINED_SESSIONS) break;
      this.sessions.delete(session.id);
    }
  }

  private getSession(id: string): ManagedProcessSession {
    const session = this.sessions.get(id);
    if (!session) {
      throw new ProcessSessionError("PROCESS_NOT_FOUND", `Unknown process session: ${id}`);
    }
    return session;
  }

  async start(input: StartManagedProcessInput): Promise<ManagedProcessSummary> {
    const runningCount = [...this.sessions.values()].filter((session) => session.status === "running").length;
    if (runningCount >= MAX_RUNNING_SESSIONS) {
      throw new ProcessSessionError(
        "PROCESS_LIMIT_REACHED",
        `At most ${MAX_RUNNING_SESSIONS} managed processes may run at once.`
      );
    }

    const cwd = this.workspace.resolve(input.cwd ?? ".");
    const args = [...(input.args ?? [])];
    const prepared = prepareSpawnCommand(input.command, args);
    const child = spawn(prepared.command, prepared.args, {
      cwd: cwd.abs,
      env: buildCompatibleProcessEnvironment(),
      windowsHide: true,
      shell: false,
      stdio: ["pipe", "pipe", "pipe"],
    });
    const stdoutDecoder = new StringDecoder("utf8");
    const stderrDecoder = new StringDecoder("utf8");
    const session: ManagedProcessSession = {
      id: `proc_${randomBytes(8).toString("base64url")}`,
      command: input.command,
      args,
      cwd: cwd.rel,
      child,
      status: "running",
      startedAt: new Date().toISOString(),
      endedAt: null,
      exitCode: null,
      signal: null,
      stdout: new TextWindow(),
      stderr: new TextWindow(),
    };

    child.stdout.on("data", (chunk: Buffer) => session.stdout.append(stdoutDecoder.write(chunk)));
    child.stderr.on("data", (chunk: Buffer) => session.stderr.append(stderrDecoder.write(chunk)));
    child.stdout.once("end", () => session.stdout.append(stdoutDecoder.end()));
    child.stderr.once("end", () => session.stderr.append(stderrDecoder.end()));
    child.once("close", (exitCode, signal) => {
      session.status = session.status === "failed" ? "failed" : "exited";
      session.exitCode = exitCode;
      session.signal = signal;
      session.endedAt = new Date().toISOString();
      this.pruneRetainedSessions();
    });

    try {
      await new Promise<void>((resolve, reject) => {
        child.once("spawn", resolve);
        child.once("error", reject);
      });
    } catch (error) {
      session.status = "failed";
      session.endedAt = new Date().toISOString();
      throw new ProcessSessionError(
        "PROCESS_START_FAILED",
        error instanceof Error ? error.message : String(error)
      );
    }

    this.sessions.set(session.id, session);
    this.pruneRetainedSessions();
    return summary(session);
  }

  read(
    id: string,
    opts: { stdoutOffset?: number; stderrOffset?: number; maxChars?: number } = {}
  ): {
    process: ManagedProcessSummary;
    stdout: TextWindowRead;
    stderr: TextWindowRead;
  } {
    const session = this.getSession(id);
    return {
      process: summary(session),
      stdout: session.stdout.read(opts.stdoutOffset, opts.maxChars),
      stderr: session.stderr.read(opts.stderrOffset, opts.maxChars),
    };
  }

  write(id: string, text: string, endStdin = false): ManagedProcessSummary {
    const session = this.getSession(id);
    if (session.status !== "running" || session.child.stdin.destroyed) {
      throw new ProcessSessionError("PROCESS_NOT_RUNNING", `Process is not accepting input: ${id}`);
    }
    try {
      session.child.stdin.write(text);
      if (endStdin) session.child.stdin.end();
    } catch (error) {
      throw new ProcessSessionError(
        "PROCESS_IO_ERROR",
        error instanceof Error ? error.message : String(error)
      );
    }
    return summary(session);
  }

  stop(id: string): ManagedProcessSummary {
    const session = this.getSession(id);
    if (session.status !== "running") return summary(session);
    try {
      session.child.kill();
    } catch (error) {
      throw new ProcessSessionError(
        "PROCESS_IO_ERROR",
        error instanceof Error ? error.message : String(error)
      );
    }
    return summary(session);
  }

  list(): ManagedProcessSummary[] {
    return [...this.sessions.values()]
      .map(summary)
      .sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  }

  async closeAll(): Promise<void> {
    const running = [...this.sessions.values()].filter((session) => session.status === "running");
    if (running.length === 0) {
      this.sessions.clear();
      return;
    }

    const waits = running.map((session) => new Promise<void>((resolve) => {
      session.child.once("close", () => resolve());
      try {
        session.child.kill();
      } catch {
        resolve();
      }
    }));

    await Promise.race([
      Promise.allSettled(waits),
      new Promise<void>((resolve) => setTimeout(resolve, 2_000)),
    ]);
    this.sessions.clear();
  }
}
