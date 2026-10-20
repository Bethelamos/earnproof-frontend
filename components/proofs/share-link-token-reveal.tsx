"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { formatDate } from "@/lib/i18n";

/**
 * Modeled directly on components/developers/one-time-secret.tsx: the raw
 * token is shown exactly once, cleared from the DOM input on unmount, and
 * never re-derivable from this component after the user navigates away
 * (the caller must not hold onto the token past this render).
 *
 * Privacy-safe clipboard behavior:
 * - The copied value is never stored in component state or refs.
 * - A clear timer is only scheduled when the platform can confirm the
 *   clipboard was written and can be re-read to confirm the clear.
 * - The UI never claims the clipboard was cleared unless the platform
 *   confirms it (read-back matches the copied value and then clears).
 * - Manual clear is always available and reports its own result.
 */

export const CLIPBOARD_CLEAR_DELAY_MS = 30_000;

export type ClipboardStatus =
  | { kind: "idle" }
  | { kind: "copied"; clearAt: number | null }
  | { kind: "cleared" }
  | { kind: "clearFailed" }
  | { kind: "copyFailed" };

function canReadClipboard(): boolean {
  return (
    typeof navigator !== "undefined" &&
    !!navigator.clipboard &&
    typeof navigator.clipboard.readText === "function"
  );
}

export function ShareLinkTokenReveal({
  token,
  expiresAt,
  onDismiss,
}: {
  token: string;
  expiresAt: string;
  onDismiss: () => void;
}) {
  const [clipboardStatus, setClipboardStatus] = useState<ClipboardStatus>({ kind: "idle" });
  const tokenRef = useRef<HTMLInputElement>(null);
  const dismissButtonRef = useRef<HTMLButtonElement>(null);
  const clearTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    dismissButtonRef.current?.focus();
  }, []);

  const clearTimer = useCallback(() => {
    if (clearTimerRef.current !== null) {
      clearTimeout(clearTimerRef.current);
      clearTimerRef.current = null;
    }
  }, []);

  useEffect(() => {
    const input = tokenRef;
    return () => {
      clearTimer();
      if (input.current) {
        input.current.value = "";
      }
    };
  }, [clearTimer]);

  const performClear = useCallback(async (): Promise<void> => {
    clearTimer();
    try {
      await navigator.clipboard.writeText("");
      if (!mountedRef.current) return;
      // Only claim success if the platform can confirm the clear.
      if (canReadClipboard()) {
        const readBack = await navigator.clipboard.readText();
        if (!mountedRef.current) return;
        if (readBack !== "") {
          setClipboardStatus({ kind: "clearFailed" });
          return;
        }
        setClipboardStatus({ kind: "cleared" });
        return;
      }
      // Write succeeded but the platform cannot confirm the clear.
      setClipboardStatus({ kind: "clearFailed" });
    } catch {
      if (!mountedRef.current) return;
      setClipboardStatus({ kind: "clearFailed" });
    }
  }, [clearTimer]);

  const handleCopy = useCallback(async () => {
    clearTimer();
    setClipboardStatus({ kind: "idle" });

    try {
      await navigator.clipboard.writeText(token);
    } catch {
      if (!mountedRef.current) return;
      setClipboardStatus({ kind: "copyFailed" });
      return;
    }

    if (!mountedRef.current) return;

    // Only schedule an automatic clear when the platform can confirm it.
    if (!canReadClipboard()) {
      setClipboardStatus({ kind: "copied", clearAt: null });
      return;
    }

    const clearAt = Date.now() + CLIPOARD_CLEAR_DELAY_MS;
    setClipboardStatus({ kind: "copied", clearAt });
    clearTimerRef.current = setTimeout(() => {
      void performClear();
    }, CLIPOARD_CLEAR_DELAY_MS);
  }, [clearTimer, performClear, token]);

  const handleClearManually = useCallback(async () => {
    await performClear();
  }, [performClear]);

  const copied = clipboardStatus.kind === "copied";
  const canAutoClear = copied && clipboardStatus.clearAt !== null;

  return (
    <section
      className="rounded-lg border border-emerald-300/30 bg-emerald-300/10 p-5"
      role="region"
      aria-labelledby="share-token-heading"
    >
      <h2 id="share-token-heading" className="text-lg font-semibold text-emerald-100">
        Share link created
      </h2>
      <p className="mt-1 text-sm text-emerald-200">
        <strong className="block">This is the only time this token will be shown.</strong>
        Copy it now and store it securely. It expires {formatDate(new Date(expiresAt))}.
      </p>

      <div className="mt-4">
        <label htmlFor="share-token" className="block text-xs font-semibold text-emerald-100">
          Share token
        </label>
        <div className="mt-1 flex gap-2">
          <input
            id="share-token"
            ref={tokenRef}
            className="flex-1 h-10 rounded-md border border-emerald-300/30 bg-emerald-900/20 px-3 text-sm font-mono text-emerald-100 selection:bg-emerald-300/30"
            readOnly
            value={token}
            onClick={() => tokenRef.current?.select()}
          />
          <button
            className="h-10 rounded-md border border-emerald-300/30 bg-emerald-300 px-4 text-xs font-semibold text-slate-955 hover:bg-emerald-200 transition"
            onClick={handleCopy}
            type="button"
          >
            Copy
          </button>
        </div>

        {clipboardStatus.kind === "copied" && (
          <p className="mt-1 text-xs text-emerald-200" aria-live="polite">
            Copied to clipboard.
            {canAutoClear
              ? " It will be cleared automatically in 30 seconds if the browser confirms the clear."
              : " This browser cannot confirm an automatic clear, so clear it manually when done."}
          </p>
        )}
        {clipboardStatus.kind === "cleared" && (
          <p className="mt-1 text-xs text-emerald-200" aria-live="polite">
            Clipboard cleared and confirmed.
          </p>
        )}
        {clipboardStatus.kind === "clearFailed" && (
          <p className="mt-1 text-xs text-rose-200" role="alert">
            Could not confirm the clipboard was cleared. Clear it manually in your system clipboard tools.
          </p>
        )}
        {clipboardStatus.kind === "copyFailed" && (
          <p className="mt-1 text-xs text-rose-200" role="alert">
            Failed to copy to clipboard. Select the token and copy it manually.
          </p>
        )}

        <div className="mt-2">
          <button
            className="h-8 rounded-md border border-emerald-300/30 px-3 text-xs font-semibold text-emerald-100 hover:bg-emerald-300/10 transition"
            onClick={handleClearManually}
            type="button"
          >
            Clear clipboard now
          </button>
        </div>
      </div>

      <div className="mt-4">
        <button
          ref={dismissButtonRef}
          className="h-10 rounded-md border border-emerald-300/30 px-4 texe-xs font-semibold text-emerald-100 hover:bg-emerald-300/10 transition"
          onClick={onDismiss}
          type="button"
        >
          I&#39;ve saved the token, dismiss this
        </button>
      </div>
    </section>
  );
}
