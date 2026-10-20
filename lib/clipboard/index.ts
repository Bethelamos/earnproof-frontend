/**
 * Privacy-safe clipboard utilities.
 *
 * This module provides a small, framework-agnostic clipboard layer with:
 * - explicit copy sensitivity levels,
 * - best-effort expiration timers that only clear when the platform can
 *   confirm the clear succeeded,
 * - status announcements for assistive technology,
 * - manual clear actions.
 *
 * Design guarantees:
 * - Copied values are never retained by this module after the copy completes.
 *   Timers close over only metadata (identifier, deadline, sensitivity).
 * - The status never claims "cleared" unless the platform confirms the clear.
 * - Timers are deterministic and idempotent; replay of a stale deadline is a
 *   no-op.
 */

export type ClipboardSensitivity = "public" | "internal" | "secret";

export type ClipboardStatus =
  | "idle"
  | "copied"
  | "cleared"
  | "clear-failed"
  | "clear-unsupported";

export interface ClipboardStatusSnapshot {
  /** Stable identifier for the copy event. Never contains the copied value. */
  readonly id: string;
  readonly status: ClipboardStatus;
  readonly sensitivity: ClipboardSensitivity;
  /** Epoch milliseconds when the value was copied, or null when idle. */
  readonly copiedAt: number | null;
  /** Epoch milliseconds when auto-clear is due, or null when not scheduled. */
  readonly expiresAt: number | null;
  /** Human-readable message suitable for announcing to assistive technology. */
  readonly announcement: string;
}

export interface ClipboardAdapter {
  /** Writes text to the clipboard. Resolves true on confirmed success. */
  writeText(text: string): Promise<void>;
  /**
   * Attempts to clear the clipboard. Resolves true only when the platform
   * confirms the clipboard is empty. Resolves false when clearing is not
   * supported or cannot be confirmed.
   */
  clear(): Promise<boolean>;
}

export interface ClipboardCopyOptions {
  /** Sensitivity of the copied value. Defaults to "internal". */
  sensitivity?: ClipboardSensitivity;
  /**
   * Override the auto-clear delay in milliseconds. Must be a finite,
   * non-negative integer. A "0" delay means clear immediately after copy.
   */
  expirationMs?: number;
  /** Optional hook called with each status snapshot change. */
  onStatusChange?: (snapshot: ClipboardStatusSnapshot) => void;
}

/** Default auto-clear delays per sensitivity level, in milliseconds. */
export const DEFAULT_EXPIRATION_MS: Readonly<Record<ClipboardSensitivity, number>> =
  Object.freeze({
    public: 60000,
    internal: 30000,
    secret: 15000,
  });

/** Maximum allowed auto-clear delay (24 hours). */
export const MAX_EXPIRATION_MS = 24 * 60 * 60 * 1000;

export class ClipboardError extends Error {
  constructor(message: string, readonly code: ClipboardErrorCode) {
    super(message);
    this.name = "ClipboardError";
  }
}

export type ClipboardErrorCode =
  | "invalid-sensitivity"
  | "invalid-expiration"
  | "empty-value"
  | "write-failed";

function isSensitivity(value: unknown): value is ClipboardSensitivity {
  return value === "public" || value === "internal" || value === "secret";
}

/**
 * Validates an expiration delay. Returns the normalized integer or throws a
 * ClipboardError with code "invalid-expiration".
 */
export function validateExpirationMs(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new ClipboardError("Expiration delay must be a finite number.", "invalid-expiration");
  }
  if (!Number.isInteger(value)) {
    throw new ClipboardError("Expiration delay must be an integer.", "invalid-expiration");
  }
  if (value < 0) {
    throw new ClipboardError("Expiration delay must not be negative.", "invalid-expiration");
  }
  if (value > MAX_EXPIRATION_MS) {
    throw new ClipboardError(
      `Expiration delay must not exceed ${MAX_EXPIRATION_MS} ms.`,
      "invalid-expiration",
    );
  }
  return value;
}

export function resolveExpirationMs(
  sensitivity: ClipboardSensitivity,
  override?: number,
): number {
  if (override === undefined) {
    return DEFAULT_EXPIRATION_MS[sensitivity];
  }
  return validateExpirationMs(override);
}

function describeSensitivity(sensitivity: ClipboardSensitivity): string {
  switch (sensitivity) {
    case "public":
      return "Public value";
    case "internal":
      return "Internal value";
    case "secret":
      return "Secret value";
  }
}

let idCounter = 0;

function nextId(): string {
  idCounter += 1;
  return `clipboard-${idCounter}-${Date.now()}`;
}

export interface ClipboardController {
  /** Copies text and schedules auto-clear. Resolves the status snapshot. */
  copy(text: string, options?: ClipboardCopyOptions): Promise<ClipboardStatusSnapshot>;
  /** Manually attempts to clear the clipboard. */
  clear(): Promise<ClipboardStatusSnapshot>;
  /** Returns the current status snapshot. */
  getStatus(): ClipboardStatusSnapshot;
  /** Cancels any pending auto-clear timer without clearing the clipboard. */
  dispose(): void;
}

export function createClipboardController(
  adapter: ClipboardAdapter,
  options: ClipboardCopyOptions = {},
): ClipboardController {
  const defaultSensitivity: ClipboardSensitivity = options.sensitivity ?? "internal";
  if (!isSensitivity(defaultSensitivity)) {
    throw new ClipboardError(`Unsupported sensitivity: ${String(options.sensitivity)}.`, "invalid-sensitivity");
  }
  if (options.expirationMs !== undefined) {
    validateExpirationMs(options.expirationMs);
  }

  let timer: ReturnType<typeof setTimeout> | null = null;
  let currentId: string | null = null;
  let snapshot: ClipboardStatusSnapshot = {
    id: "",
    status: "idle",
    sensitivity: defaultSensitivity,
    copiedAt: null,
    expiresAt: null,
    announcement: "",
  };

  function emit(next: ClipboardStatusSnapshot): void {
    snapshot = next;
    options.onStatusChange?.(next);
  }

  function clearTimer(): void {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  }

  async function attemptClear(id: string): Promise<ClipboardStatusSnapshot> {
    // Stale-replay guard: only the active copy may transition to cleared.
    if (currentId !== id) {
      return snapshot;
    }
    clearTimer();
    let confirmed = false;
    try {
      confirmed = await adapter.clear();
    } catch {
      confirmed = false;
    }
    // Replay guard: a new copy may have replaced this one while clearing.
    if (currentId !== id) {
      return snapshot;
    }
    if (confirmed) {
      currentId = null;
      emit({
        id: "",
        status: "cleared",
        sensitivity: snapshot.sensitivity,
        copiedAt: null,
        expiresAt: null,
        announcement: "Clipboard contents were cleared.",
      });
    } else {
      // We cannot confirm the clear. Never claim it succeeded.
      emit({
        ...snapshot,
        status: "clear-failed",
        announcement:
          "Could not confirm that the clipboard was cleared. Please clear it manually.",
      });
    }
    return snapshot;
  }

  return {
    async copy(text, copyOptions = {}) {
      if (typeof text !== "string" || text.length === 0) {
        throw new ClipboardError("Cannot copy an empty value.", "empty-value");
      }
      const sensitivity = copyOptions.sensitivity ?? defaultSensitivity;
      if (!isSensitivity(sensitivity)) {
        throw new ClipboardError(
          `Unsupported sensitivity: ${String(copyOptions.sensitivity)}.`,
          "invalid-sensitivity",
        );
      }
      const expirationMs = resolveExpirationMs(
        sensitivity,
        copyOptions.expirationMs ?? options.expirationMs,
      );

      // Invalidate any previous copy before writing so a stale timer cannot
      // clear the new value.
      clearTimer();
      currentId = null;

      try {
        await adapter.writeText(text);
      } catch (cause) {
        const message =
          cause instanceof Error && typeof cause.message === "string"
            ? cause.message
            : "Unknown clipboard write failure.";
        emit({
          id: "",
          status: "idle",
          sensitivity,
          copiedAt: null,
          expiresAt: null,
          announcement: `Could not copy to the clipboard: ${message}`,
        });
        throw new ClipboardError(`Clipboard write failed: ${message}`, "write-failed");
      }

      const id = nextId();
      const copiedAt = Date.now();
      const expiresAt = copiedAt + expirationMs;
      currentId = id;
      emit({
        id,
        status: "copied",
        sensitivity,
        copiedAt,
        expiresAt,
        announcement: `${describeSensitivity(sensitivity)} copied. Auto-clear in ${expirationMs} ms.`,
      });

      // The timer closes over metadata only (id), never the copied text.
      timer = setTimeout(() => {
        timer = null;
        void attemptClear(id);
      }, expirationMs);
      // Prevent the timer from keeping Node processes alive in tests/servers.
      const nodeTimer = timer as unknown as { unref?: () => void };
      if (typeof nodeTimer.unref === "function") {
        nodeTimer.unref();
      }

      return snapshot;
    },

    async clear() {
      if (currentId === null) {
        // Nothing tracked; still attempt a confirmed clear on manual actions.
        clearTimer();
        let confirmed = false;
        try {
          confirmed = await adapter.clear();
        } catch {
          confirmed = false;
        }
        if (confirmed) {
          emit({
            id: "",
            status: "cleared",
            sensitivity: snapshot.sensitivity,
            copiedAt: null,
            expiresAt: null,
            announcement: "Clipboard contents were cleared.",
          });
        } else {
          emit({
            ...snapshot,
            status: "clear-failed",
            announcement:
              "Could not confirm that the clipboard was cleared. Please clear it manually.",
          });
        }
        return snapshot;
      }
      return attemptClear(currentId);
    },

    getStatus() {
      return snapshot;
    },

    dispose() {
      clearTimer();
      currentId = null;
    },
  };
}

/**
 * Default browser adapter backed by the async Clipboard API.
 *
 * Clearing is only reported as confirmed when the platform exposes a read
 * capability and the read-back value is empty. Otherwise this adapter returns
 * false so the UI is forced to avoid claiming a clear.
 */
export function createBrowserClipboardAdapter(
  navigatorObject: Pick<Navigator, "clipboard"> | undefined =
    typeof navigator !== "undefined" ? navigator : undefined,
): ClipboardAdapter {
  const clipboard = navigatorObject?.clipboard;

  return {
    async writeText(text) {
      if (!clipboard || typeof clipboard.writeText !== "function") {
        throw new Error("Clipboard write is not supported in this browser.");
      }
      await clipboard.writeText(text);
    },

    async clear() {
      if (!clipboard) {
        return false;
      }
      const canRead = typeof clipboard.readText === "function";
      const canWrite = typeof clipboard.writeText === "function";
      if (!canRead || !canWrite) {
        // Without read-back we cannot confirm a clear.
        return false;
      }
      try {
        await clipboard.writeText("");
        const remaining = await clipboard.readText();
        return remaining === "";
      } catch {
        return false;
      }
    },
  };
}
