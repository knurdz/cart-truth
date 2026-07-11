import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { rm } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { promisify } from "node:util";
import { chromium, type BrowserContext } from "playwright";

const execFileAsync = promisify(execFile);

const CHROMIUM_SINGLETON_FILES = ["SingletonLock", "SingletonSocket", "SingletonCookie"] as const;

type LaunchOptions = Parameters<typeof chromium.launchPersistentContext>[1];

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
  removedFiles?: string[];
  activeProcesses?: Array<{ pid: number; command: string }>;
  reason?: string;
  error?: string;
};

export type DarazProfileLockRepairResult = {
  profileId: string;
  lockFiles: string[];
  removedFiles: string[];
  activeProcesses: Array<{ pid: number; command: string }>;
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

    emitProfileLockEvent(diagnostics, {
      event: "daraz_profile_launch_failed",
      profileId: profileId(profilePath),
      ...diagnosticFields(diagnostics),
      error: error instanceof Error ? error.message : String(error)
    });

    const repair = await repairDarazProfileLock(profilePath, diagnostics);
    assertProfileRepairAllowsLaunch(repair);

    if (!repair.repaired) {
      throw new DarazProfileInUseError(
        "Could not repair the Daraz browser profile lock automatically. Restart the CartTruth container and try again.",
        repair
      );
    }

    emitProfileLockEvent(diagnostics, {
      event: "daraz_profile_launch_retry",
      profileId: repair.profileId,
      ...diagnosticFields(diagnostics),
      removedFiles: repair.removedFiles
    });

    return await chromium.launchPersistentContext(profilePath, options);
  }
}

export async function repairDarazProfileLock(
  profilePath: string,
  diagnostics: DarazProfileLaunchDiagnostics = {}
): Promise<DarazProfileLockRepairResult> {
  const normalizedProfilePath = resolve(profilePath);
  const id = profileId(normalizedProfilePath);
  const lockFiles = existingSingletonFiles(normalizedProfilePath);
  if (lockFiles.length === 0) {
    return {
      profileId: id,
      lockFiles: [],
      removedFiles: [],
      activeProcesses: [],
      inspectedProcesses: true,
      repaired: false,
      reason: "no_lock"
    };
  }

  emitProfileLockEvent(diagnostics, {
    event: "daraz_profile_lock_detected",
    profileId: id,
    ...diagnosticFields(diagnostics),
    lockFiles: lockFiles.map((lockFile) => basename(lockFile))
  });

  const processInspection = await findProcessesUsingProfile(normalizedProfilePath);
  if (!processInspection.inspected) {
    return {
      profileId: id,
      lockFiles: lockFiles.map((lockFile) => basename(lockFile)),
      removedFiles: [],
      activeProcesses: [],
      inspectedProcesses: false,
      repaired: false,
      reason: "process_inspection_failed",
      error: processInspection.error
    };
  }

  if (processInspection.processes.length > 0) {
    const activeProcesses = processInspection.processes.map((processInfo) => ({
      pid: processInfo.pid,
      command: processInfo.command
    }));
    emitProfileLockEvent(diagnostics, {
      event: "daraz_profile_lock_active_process",
      profileId: id,
      ...diagnosticFields(diagnostics),
      lockFiles: lockFiles.map((lockFile) => basename(lockFile)),
      activeProcesses
    });
    return {
      profileId: id,
      lockFiles: lockFiles.map((lockFile) => basename(lockFile)),
      removedFiles: [],
      activeProcesses,
      inspectedProcesses: true,
      repaired: false,
      reason: "active_process"
    };
  }

  const removedFiles: string[] = [];
  for (const lockFile of lockFiles) {
    await rm(lockFile, { force: true }).catch(() => undefined);
    removedFiles.push(basename(lockFile));
  }

    emitProfileLockEvent(diagnostics, {
      event: "daraz_profile_lock_stale_cleanup",
      profileId: id,
      ...diagnosticFields(diagnostics),
      removedFiles
    });

  return {
    profileId: id,
    lockFiles: lockFiles.map((lockFile) => basename(lockFile)),
    removedFiles,
    activeProcesses: [],
    inspectedProcesses: true,
    repaired: removedFiles.length > 0,
    reason: "stale_lock_removed"
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

async function findProcessesUsingProfile(profilePath: string): Promise<
  | { inspected: true; processes: Array<{ pid: number; command: string }> }
  | { inspected: false; error: string }
> {
  try {
    const { stdout } = await execFileAsync("ps", ["-eo", "pid=,args="], { maxBuffer: 1024 * 1024 });
    const processes = stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .map((line) => {
        const match = line.match(/^(\d+)\s+([\s\S]+)$/);
        if (!match?.[1] || !match[2]) {
          return undefined;
        }
        return { pid: Number(match[1]), command: match[2] };
      })
      .filter((processInfo): processInfo is { pid: number; command: string } => Boolean(processInfo))
      .filter((processInfo) => processInfo.pid !== process.pid)
      .filter((processInfo) => processInfo.command.includes(profilePath))
      .map((processInfo) => ({
        pid: processInfo.pid,
        command: processInfo.command.replaceAll(profilePath, "<profile>").slice(0, 240)
      }));
    return { inspected: true, processes };
  } catch (error) {
    return { inspected: false, error: error instanceof Error ? error.message : String(error) };
  }
}

function existingSingletonFiles(profilePath: string): string[] {
  return CHROMIUM_SINGLETON_FILES
    .map((file) => resolve(profilePath, file))
    .filter((path) => existsSync(path));
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
