import fs from "node:fs";
import path from "node:path";
import { Workspace, WorkspaceError } from "./manager.js";

export type WorkspaceMutationErrorCode =
  | "PATH_EXISTS"
  | "PROTECTED_PATH"
  | "DIRECTORY_NOT_EMPTY"
  | "INVALID_MOVE"
  | "MUTATION_FAILED";

export class WorkspaceMutationError extends Error {
  constructor(
    public readonly code: WorkspaceMutationErrorCode,
    message: string
  ) {
    super(message);
    this.name = "WorkspaceMutationError";
  }
}

function protectedPath(rel: string): boolean {
  return rel === "" || rel.split("/").includes(".git");
}

function assertMutablePath(rel: string, operation: string): void {
  if (protectedPath(rel)) {
    throw new WorkspaceMutationError(
      "PROTECTED_PATH",
      `${operation} is not allowed for the workspace root or .git metadata: ${rel || "."}`
    );
  }
}

async function lstatIfExists(abs: string): Promise<fs.Stats | null> {
  try {
    return await fs.promises.lstat(abs);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

function mutationFailure(error: unknown): WorkspaceMutationError {
  return new WorkspaceMutationError(
    "MUTATION_FAILED",
    error instanceof Error ? error.message : String(error)
  );
}

function resolveMutationPath(workspace: Workspace, requestedPath: string): { abs: string; rel: string } {
  return workspace.resolve(requestedPath, { preserveLeafSymlink: true });
}

export async function createWorkspaceDirectory(
  workspace: Workspace,
  requestedPath: string,
  opts: { parents?: boolean } = {}
): Promise<{ path: string; created: boolean }> {
  const target = resolveMutationPath(workspace, requestedPath);
  assertMutablePath(target.rel, "Creating a directory");

  const existing = await lstatIfExists(target.abs);
  if (existing) {
    if (existing.isDirectory() && !existing.isSymbolicLink()) {
      return { path: target.rel, created: false };
    }
    throw new WorkspaceMutationError("PATH_EXISTS", `A non-directory path already exists: ${target.rel}`);
  }

  try {
    await fs.promises.mkdir(target.abs, { recursive: opts.parents ?? true });
    return { path: target.rel, created: true };
  } catch (error) {
    throw mutationFailure(error);
  }
}

export async function moveWorkspacePath(
  workspace: Workspace,
  sourcePath: string,
  destinationPath: string,
  opts: { createParents?: boolean } = {}
): Promise<{ source: string; destination: string; type: "file" | "directory" | "symlink" }> {
  const source = resolveMutationPath(workspace, sourcePath);
  const destination = resolveMutationPath(workspace, destinationPath);
  assertMutablePath(source.rel, "Moving a path");
  assertMutablePath(destination.rel, "Moving a path");

  const sourceStat = await lstatIfExists(source.abs);
  if (!sourceStat) {
    throw new WorkspaceError("FILE_NOT_FOUND", `Path not found: ${source.rel}`);
  }
  const destinationStat = await lstatIfExists(destination.abs);
  if (destinationStat) {
    throw new WorkspaceMutationError("PATH_EXISTS", `Destination already exists: ${destination.rel}`);
  }

  const sourceKey = path.resolve(source.abs);
  const destinationKey = path.resolve(destination.abs);
  if (sourceKey === destinationKey) {
    throw new WorkspaceMutationError("INVALID_MOVE", "Source and destination are the same path.");
  }
  if (sourceStat.isDirectory() && destinationKey.startsWith(sourceKey + path.sep)) {
    throw new WorkspaceMutationError("INVALID_MOVE", "A directory cannot be moved inside itself.");
  }

  try {
    if (opts.createParents ?? true) {
      await fs.promises.mkdir(path.dirname(destination.abs), { recursive: true });
    }
    await fs.promises.rename(source.abs, destination.abs);
  } catch (error) {
    throw mutationFailure(error);
  }

  return {
    source: source.rel,
    destination: destination.rel,
    type: sourceStat.isSymbolicLink()
      ? "symlink"
      : sourceStat.isDirectory()
        ? "directory"
        : "file",
  };
}

export async function deleteWorkspacePath(
  workspace: Workspace,
  requestedPath: string,
  opts: { recursive?: boolean } = {}
): Promise<{ path: string; type: "file" | "directory" | "symlink"; recursive: boolean }> {
  const target = resolveMutationPath(workspace, requestedPath);
  assertMutablePath(target.rel, "Deleting a path");

  const stat = await lstatIfExists(target.abs);
  if (!stat) {
    throw new WorkspaceError("FILE_NOT_FOUND", `Path not found: ${target.rel}`);
  }

  const recursive = opts.recursive ?? false;
  try {
    if (stat.isDirectory() && !stat.isSymbolicLink()) {
      if (recursive) {
        await fs.promises.rm(target.abs, { recursive: true, force: false });
      } else {
        try {
          await fs.promises.rmdir(target.abs);
        } catch (error) {
          const code = (error as NodeJS.ErrnoException).code;
          if (code === "ENOTEMPTY" || code === "EEXIST") {
            throw new WorkspaceMutationError(
              "DIRECTORY_NOT_EMPTY",
              `Directory is not empty: ${target.rel}. Set recursive=true only when recursive deletion is intended.`
            );
          }
          throw error;
        }
      }
    } else {
      await fs.promises.unlink(target.abs);
    }
  } catch (error) {
    if (error instanceof WorkspaceMutationError) throw error;
    throw mutationFailure(error);
  }

  return {
    path: target.rel,
    type: stat.isSymbolicLink()
      ? "symlink"
      : stat.isDirectory()
        ? "directory"
        : "file",
    recursive,
  };
}
