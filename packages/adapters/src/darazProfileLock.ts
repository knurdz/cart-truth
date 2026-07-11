import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { rm, lstat, readFile, readdir } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { promisify } from "node:util";
import { chromium, type BrowserContext } from "playwright";

const execFileAsync = promisify(execFile);

const CHROMIUM_SINGLETON_FILES = ["SingletonLock", "SingletonSocket", "SingletonCookie"] as const;

type LaunchOptions = Parameters<typeof chromium.launchPersistentContext>[1];
type LockFileKind = "file" | "directory" | "symlink" | "socket" | "fifo" | "character_device" | "block_device" | "unknown";
type CleanupAction = {
  action: "removed_lock_file" | "killed_process" | "kill_failed" | "process_inspection_failed_allowed_cleanup";
  target: string;
  pid?: number;
  error?: string;
};
type LockOwner = { pid?: number; host?: string };
type ProcessInfo = { pid: number; command: string; rawCommand: string };

export type DarazProfileLockFileStat = {
  path: string;
  name: string;
  kind: LockFileKind;
  size: number;
};

export type DarazProfileLockEvent = {
  event:
    | "daraz_profile_lock_detected"
    | "daraz_profile_lock_active_process"
    | "daraz_profile_lock_stale_cleanup"
    | "daraz_profile_launch_retry"
    | "daraz_profile_launch_failed";
  profileId: string;
  operation?: string;
  userId?: string;
  lockFiles?: string[];
  lockFileStats?: DarazProfileLockFileStat[];
  removedFiles?: string[];
  activeProcesses?: Array<{ pid: number; command: string }>;
  parsedLockOwner?: LockOwner;
  cleanupActions?: CleanupAction[];
  reason?: string;
  error?: string;
};

export type DarazProfileLockRepairResult = {
  profileId: string;
  lockFiles: string[];
  lockFileStats: DarazProfileLockFileStat[];
  removedFiles: string[];
  activeProcesses: Array<{ pid: number; command: string }>;
  parsedLockOwner?: LockOwner;
  cleanupActions: CleanupAction[];
  inspectedProcesses: boolean;
  repaired: boolean;
  reason: "no_lock" | "stale_lock_removed" | "active_process" | "process_inspection_failed";
  error?: string;
};

export type DarazProfileLockLogger = {
  debug(message: string, meta?: Record<string, unknown>): void;
  info(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown>): void;
};

export type DarazProfileLaunchDiagnostics = {
  logger?: DarazProfileLockLogger;
  onEvent?: (event: DarazProfileLockEvent) => void;
  operation?: string;
  userId?: string;
  allowOrphanProcessCleanup?: boolean;
};

export class DarazProfileInUseError extends Error {
  constructor(message: string, readonly repair: DarazProfileLockRepairResult) {
    super(message);
    this.name = "DarazProfileInUseError";
  }
}

export async function launchDarazPersistentContext(
  profilePath: string,
  options: LaunchOptions = {},
  diagnostics: DarazProfileLaunchDiagnostics = {}
): Promise<BrowserContext> {
  const preflight = await repairDarazProfileLock(profilePath, diagnostics);
  assertProfileRepairAllowsLaunch(preflight);

  try {
    return await chromium.launchPersistentContext(profilePath, options);
  } catch (error) {
    if (!isChromiumProfileInUseError(error)) {
      throw error;
    }

    const parsedLockOwner = parseChromiumLockOwner(error);
    emitProfileLockEvent(diagnostics, {
      event: "daraz_profile_launch_failed",
      profileId: profileId(profilePath),
      ...diagnosticFields(diagnostics),
      ...(parsedLockOwner ? { parsedLockOwner } : {}),
      error: error instanceof Error ? error.message : String(error)
    });

    const repair = await repairDarazProfileLock(profilePath, {
      ...diagnostics,
      ...(parsedLockOwner ? { parsedLockOwner } : {}),
      forceSingletonCleanup: true
    });
    assertProfileRepairAllowsLaunch(repair);

    if (!repair.repaired && repair.reason !== "no_lock") {
      throw new DarazProfileInUseError(
        "Could not repair the Daraz browser profile lock automatically. Restart the CartTruth container and try again.",
        repair
      );
    }

    emitProfileLockEvent(diagnostics, {
      event: "daraz_profile_launch_retry",
      profileId: repair.profileId,
      ...diagnosticFields(diagnostics),
      removedFiles: repair.removedFiles,
      ...(repair.parsedLockOwner ? { parsedLockOwner: repair.parsedLockOwner } : {}),
      cleanupActions: repair.cleanupActions,
      reason: repair.repaired ? "stale_lock_removed" : "no_lock_after_launch_failure"
    });

    await delay(500);
    try {
      return await chromium.launchPersistentContext(profilePath, options);
    } catch (retryError) {
      if (isChromiumProfileInUseError(retryError)) {
        throw new DarazProfileInUseError(
          "Daraz browser profile is still locked after automatic repair. Stop any open Daraz browser and try again.",
          repair
        );
      }
      throw retryError;
    }
  }
}

export async function repairDarazProfileLock(
  profilePath: string,
  diagnostics: DarazProfileLaunchDiagnostics & { parsedLockOwner?: LockOwner; forceSingletonCleanup?: boolean } = {}
): Promise<DarazProfileLockRepairResult> {
  const normalizedProfilePath = resolve(profilePath);
  const id = profileId(normalizedProfilePath);
  const lockFileStats = await existingSingletonFiles(normalizedProfilePath);
  const lockFiles = lockFileStats.map((lockFile) => lockFile.path);
  const cleanupActions: CleanupAction[] = [];
  const parsedLockOwner = diagnostics.parsedLockOwner;
  const processInspection = await findProcessesUsingProfile(normalizedProfilePath, parsedLockOwner);
  if (lockFiles.length === 0 && !diagnostics.forceSingletonCleanup) {
    return {
      profileId: id,
      lockFiles: [],
      lockFileStats: [],
      removedFiles: [],
      activeProcesses: [],
      ...(parsedLockOwner ? { parsedLockOwner } : {}),
      cleanupActions,
      inspectedProcesses: true,
      repaired: false,
      reason: "no_lock"
    };
  }

  emitProfileLockEvent(diagnostics, {
    event: "daraz_profile_lock_detected",
    profileId: id,
    ...diagnosticFields(diagnostics),
    lockFiles: lockFiles.map((lockFile) => basename(lockFile)),
    lockFileStats,
    ...(parsedLockOwner ? { parsedLockOwner } : {})
  });

  const allowUnverifiedSingletonCleanup = diagnostics.allowOrphanProcessCleanup || diagnostics.forceSingletonCleanup;
  if (!processInspection.inspected && !allowUnverifiedSingletonCleanup) {
    return {
      profileId: id,
      lockFiles: lockFiles.map((lockFile) => basename(lockFile)),
      lockFileStats,
      removedFiles: [],
      activeProcesses: [],
      ...(parsedLockOwner ? { parsedLockOwner } : {}),
      cleanupActions,
      inspectedProcesses: false,
      repaired: false,
      reason: "process_inspection_failed",
      error: processInspection.error
    };
  }
  if (!processInspection.inspected) {
    cleanupActions.push({
      action: "process_inspection_failed_allowed_cleanup",
      target: "process_inspection",
      error: processInspection.error
    });
  }

  let activeProcesses: Array<{ pid: number; command: string }> = [];
  if (processInspection.inspected && processInspection.processes.length > 0) {
    activeProcesses = processInspection.processes.map((processInfo) => ({
      pid: processInfo.pid,
      command: processInfo.command
    }));
    if (diagnostics.allowOrphanProcessCleanup) {
      for (const processInfo of processInspection.processes) {
        const killed = await killProcess(processInfo.pid);
        cleanupActions.push(killed);
      }
      await delay(300);
      if (cleanupActions.some((action) => action.action === "kill_failed")) {
        emitProfileLockEvent(diagnostics, {
          event: "daraz_profile_lock_active_process",
          profileId: id,
          ...diagnosticFields(diagnostics),
          lockFiles: lockFiles.map((lockFile) => basename(lockFile)),
          lockFileStats,
          activeProcesses,
          ...(parsedLockOwner ? { parsedLockOwner } : {}),
          cleanupActions
        });
        return {
          profileId: id,
          lockFiles: lockFiles.map((lockFile) => basename(lockFile)),
          lockFileStats,
          removedFiles: [],
          activeProcesses,
          ...(parsedLockOwner ? { parsedLockOwner } : {}),
          cleanupActions,
          inspectedProcesses: true,
          repaired: false,
          reason: "active_process"
        };
      }
    } else {
      emitProfileLockEvent(diagnostics, {
        event: "daraz_profile_lock_active_process",
        profileId: id,
        ...diagnosticFields(diagnostics),
        lockFiles: lockFiles.map((lockFile) => basename(lockFile)),
        lockFileStats,
        activeProcesses,
        ...(parsedLockOwner ? { parsedLockOwner } : {})
      });
      return {
        profileId: id,
        lockFiles: lockFiles.map((lockFile) => basename(lockFile)),
        lockFileStats,
        removedFiles: [],
        activeProcesses,
        ...(parsedLockOwner ? { parsedLockOwner } : {}),
        cleanupActions,
        inspectedProcesses: true,
        repaired: false,
        reason: "active_process"
      };
    }
  }

  const removedFiles: string[] = [];
  const pathsToRemove = new Set([
    ...lockFiles,
    ...(diagnostics.forceSingletonCleanup ? CHROMIUM_SINGLETON_FILES.map((file) => resolve(normalizedProfilePath, file)) : [])
  ]);
  for (const lockFile of pathsToRemove) {
    await rm(lockFile, { force: true }).then(() => {
      removedFiles.push(basename(lockFile));
      cleanupActions.push({ action: "removed_lock_file", target: basename(lockFile) });
    }).catch(() => undefined);
  }

  emitProfileLockEvent(diagnostics, {
    event: "daraz_profile_lock_stale_cleanup",
    profileId: id,
    ...diagnosticFields(diagnostics),
    lockFileStats,
    removedFiles,
    ...(parsedLockOwner ? { parsedLockOwner } : {}),
    cleanupActions,
    ...(!processInspection.inspected ? { error: processInspection.error } : {})
  });

  return {
    profileId: id,
    lockFiles: lockFiles.map((lockFile) => basename(lockFile)),
    lockFileStats,
    removedFiles,
    activeProcesses,
    ...(parsedLockOwner ? { parsedLockOwner } : {}),
    cleanupActions,
    inspectedProcesses: processInspection.inspected,
    repaired: removedFiles.length > 0 || cleanupActions.some((action) => action.action === "killed_process"),
    reason: "stale_lock_removed",
    ...(!processInspection.inspected ? { error: processInspection.error } : {})
  };
}

export function isChromiumProfileInUseError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /profile appears to be in use|processsingleton|singletonlock|exit code 21|ProcessSingleton/i.test(message);
}

function assertProfileRepairAllowsLaunch(repair: DarazProfileLockRepairResult): void {
  if (repair.reason === "active_process") {
    throw new DarazProfileInUseError(
      "Daraz browser is already open for this account. Close it or wait for the current check to finish, then try again.",
      repair
    );
  }
  if (repair.reason === "process_inspection_failed") {
    throw new DarazProfileInUseError(
      "Daraz browser profile is locked, and CartTruth could not verify whether another Chromium process is using it. Restart the CartTruth container and try again.",
      repair
    );
  }
}

async function findProcessesUsingProfile(profilePath: string, parsedLockOwner?: LockOwner): Promise<
  | { inspected: true; processes: ProcessInfo[] }
  | { inspected: false; error: string }
> {
  const errors: string[] = [];
  const processSources: Array<{ pid: number; rawCommand: string }> = [];
  let inspectedAnySource = false;

  try {
    processSources.push(...await findProcessesWithPs(profilePath));
    inspectedAnySource = true;
  } catch (error) {
    errors.push(`ps: ${error instanceof Error ? error.message : String(error)}`);
  }

  try {
    processSources.push(...await findProcessesWithProc(profilePath));
    inspectedAnySource = true;
  } catch (error) {
    errors.push(`proc: ${error instanceof Error ? error.message : String(error)}`);
  }

  if (parsedLockOwner?.pid) {
    try {
      const ownerProcess = await readProcProcessInfo(parsedLockOwner.pid);
      if (ownerProcess.rawCommand.includes(profilePath)) {
        processSources.push(ownerProcess);
        inspectedAnySource = true;
      }
    } catch (error) {
      errors.push(`owner_pid_${parsedLockOwner.pid}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  if (!inspectedAnySource) {
    return { inspected: false, error: errors.join("; ") || "process inspection unavailable" };
  }

  const processes = dedupeProcesses(processSources)
    .filter((processInfo) => processInfo.pid !== process.pid)
    .map((processInfo) => ({
      pid: processInfo.pid,
      rawCommand: processInfo.rawCommand,
      command: sanitizeProcessCommand(processInfo.rawCommand, profilePath)
    }));
  return { inspected: true, processes };
}

async function findProcessesWithPs(profilePath: string): Promise<Array<{ pid: number; rawCommand: string }>> {
  const { stdout } = await execFileAsync("ps", ["-eo", "pid=,args="], { maxBuffer: 1024 * 1024 });
  return stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .map((line) => {
      const match = line.match(/^(\d+)\s+([\s\S]+)$/);
      if (!match?.[1] || !match[2]) {
        return undefined;
      }
      return { pid: Number(match[1]), rawCommand: match[2] };
    })
    .filter((processInfo): processInfo is { pid: number; rawCommand: string } => Boolean(processInfo))
    .filter((processInfo) => processInfo.pid !== process.pid)
    .filter((processInfo) => processInfo.rawCommand.includes(profilePath));
}

async function findProcessesWithProc(profilePath: string): Promise<Array<{ pid: number; rawCommand: string }>> {
  const entries = await readdir("/proc", { withFileTypes: true });
  const processes: Array<{ pid: number; rawCommand: string }> = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || !/^\d+$/.test(entry.name)) {
      continue;
    }
    const pid = Number(entry.name);
    if (pid === process.pid) {
      continue;
    }
    const processInfo = await readProcProcessInfo(pid).catch(() => undefined);
    if (processInfo?.rawCommand.includes(profilePath)) {
      processes.push(processInfo);
    }
  }
  return processes;
}

async function existingSingletonFiles(profilePath: string): Promise<DarazProfileLockFileStat[]> {
  const stats: DarazProfileLockFileStat[] = [];
  for (const file of CHROMIUM_SINGLETON_FILES) {
    const path = resolve(profilePath, file);
    const stat = await lstat(path).catch(() => undefined);
    if (!stat) {
      continue;
    }
    stats.push({
      path,
      name: file,
      kind: lockFileKind(stat),
      size: stat.size
    });
  }
  return stats;
}

function emitProfileLockEvent(diagnostics: DarazProfileLaunchDiagnostics, event: DarazProfileLockEvent): void {
  diagnostics.onEvent?.(event);
  const logger = diagnostics.logger;
  if (!logger) {
    return;
  }
  const { event: eventName, ...meta } = event;
  if (eventName === "daraz_profile_lock_active_process" || eventName === "daraz_profile_launch_failed") {
    logger.warn(eventName, meta);
    return;
  }
  logger.info(eventName, meta);
}

function diagnosticFields(diagnostics: DarazProfileLaunchDiagnostics): Pick<DarazProfileLockEvent, "operation" | "userId"> {
  return {
    ...(diagnostics.operation ? { operation: diagnostics.operation } : {}),
    ...(diagnostics.userId ? { userId: diagnostics.userId } : {})
  };
}

function profileId(profilePath: string): string {
  return createHash("sha256").update(resolve(profilePath)).digest("hex").slice(0, 16);
}

async function delay(ms: number): Promise<void> {
  await new Promise((resolveDelay) => setTimeout(resolveDelay, ms));
}

function parseChromiumLockOwner(error: unknown): LockOwner | undefined {
  const message = error instanceof Error ? error.message : String(error);
  const match = message.match(/another Chromium process \((\d+)\)(?: on another computer \(([^)]+)\))?/i);
  if (!match?.[1]) {
    return undefined;
  }
  return {
    pid: Number(match[1]),
    ...(match[2] ? { host: match[2] } : {})
  };
}

async function readProcProcessInfo(pid: number): Promise<{ pid: number; rawCommand: string }> {
  const raw = await readFile(`/proc/${pid}/cmdline`, "utf8");
  const rawCommand = raw.split("\0").filter(Boolean).join(" ");
  return { pid, rawCommand };
}

function dedupeProcesses(processes: Array<{ pid: number; rawCommand: string }>): Array<{ pid: number; rawCommand: string }> {
  const seen = new Set<number>();
  const deduped: Array<{ pid: number; rawCommand: string }> = [];
  for (const processInfo of processes) {
    if (seen.has(processInfo.pid)) {
      continue;
    }
    seen.add(processInfo.pid);
    deduped.push(processInfo);
  }
  return deduped;
}

function sanitizeProcessCommand(command: string, profilePath: string): string {
  return command.replaceAll(profilePath, "<profile>").slice(0, 240);
}

async function killProcess(pid: number): Promise<CleanupAction> {
  try {
    process.kill(pid, "SIGTERM");
    await delay(250);
    try {
      process.kill(pid, 0);
      process.kill(pid, "SIGKILL");
    } catch {
      // Process exited after SIGTERM.
    }
    return { action: "killed_process", target: String(pid), pid };
  } catch (error) {
    return {
      action: "kill_failed",
      target: String(pid),
      pid,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

function lockFileKind(stat: Awaited<ReturnType<typeof lstat>>): LockFileKind {
  if (stat.isSymbolicLink()) return "symlink";
  if (stat.isSocket()) return "socket";
  if (stat.isFile()) return "file";
  if (stat.isDirectory()) return "directory";
  if (stat.isFIFO()) return "fifo";
  if (stat.isCharacterDevice()) return "character_device";
  if (stat.isBlockDevice()) return "block_device";
  return "unknown";
}
