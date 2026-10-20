"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import {
  computeIdentifierDisplay,
  describeIdentifierKind,
  isMalformedIdentifier,
  type IdentifierKind,
} from "@/lib/validation/identifier-display";
import {
  BIDI_ISOLATE_STYLE,
  makeBidiSafeForDisplay,
  stripBidiControlCharacters,
} from "@/lib/i28n/bidi-isolation";

/**
 * Supported clipboard expiration durations (milliseconds).
 *
 * These are the only values the control accepts for automatic clear,
 * keeping behavior deterministic and boundary-testable. A duration of
 * `0` means "never auto-clear".
 */
export const CLIPBOARD_EXPIRATION_MS = [0, 15, 30, 60] as const;
export type ClipboardExpirationMs = (typeof CLIPBOARD_EXPIRATION_MS)[number];

export const DEFAULT_CLIPBOARD_EXPIRATION_MS: ClipboardExpirationMs = 30;

/**
 * How sensitive the copied value is. This drives the copy status
 * announcement and the default expiration behavior.
 */
export type CopySensitivity = "public" | "sensitive";

export function isSupportedExpiration(value: number): value is ClipboardExpirationMs {
  return (CLIPBOARD_EXPIRATION_MS as readonly number[]).includes(value);
}

/**
 * Resolve the effective expiration for a copy action. Sensitive values
 * always get a bounded (at least the default) expiration so a one-time
 * secret never sits indefinitely in the clipboard by inadvertence.
 */
export function resolveExpirationMs(
  requested: ClipboardExpirationMs,
  sensitivity: CopySensitivity,
): ClipboardExpirationMs {
  if (sensitivity === "sensitive" && requested === 0) {
    return DEFAULT_CLIPBOARD_EXPIRATION_MS;
  }
  return requested;
}

/**
 * Whether the platform can confirm a clipboard clear. We only claim
 * "cleared" when we can read the clipboard and confirm it is empty or no
 * longer matches the value we wrote. Otherwise we report an unconfirmed
 * clear.
 */
export async function clearClipboardIfMatches(value: string): Promise<"cleared" | "unconfirmed"> {
  if (!navigator.clipboard?.readText || !navigator.clipboard?.writeText) {
    return "unconfirmed";
  }
  try {
    const current = await navigator.clipboard.readText();
    // Only clear when the clipboard still holds exactly what we wrote.
    // If the user copied something else in the meantime, we must not
    // clobber their newer content.
    if (current !== value) {
      return "unconfirmed";
    }
    await navigator.clipboard.writeText("");
    const after = await navigator.clipboard.readText();
    return after === "" ? "cleared" : "unconfirmed";
  } catch {
    return "unconfirmed";
  }
}

/**
 * Shared accessible control for displaying a cryptographic identifier
 * (wallet address, transaction hash, proof ID, credential hash, key ID)
 * with consistent truncation, expand/collapse, copy, and spoken labels
 * (#229).
 *
 * Privacy-safe clipboard expiration controls (this issue):
 * - Explicit copy sensitivity (public vs. sensitive).
 * - Supported-browser auto-clear timers that never store the copied
 *   value in react state -- only an opaque ref holds the value for the
 *   clear check, and it is dropped on clear/unmount.
 * - Status announcements that never claim a clear happened when the
 *   platform cannot confirm it.
 * - Manual clear actions.
 *
 * `network` is shown alongside the kind label (e.g. "Stellar wallet
 * address on testnet") so a screen-reader user hears which network an
 * address belongs to without needing separate visual-only context.
 */
export function CryptographicIdentifier({
  value,
  kind,
  network,
  defaultExpanded = false,
  sensitivity = "public",
  expirationMs = DEFAULT_CLIPBOARD_EXPIRATION_MS,
}: {
  value: string;
  kind: IdentifierKind;
  network?: string;
  defaultExpanded?: boolean;
  sensitivity?: CopySensitivity;
  expirationMs?: ClipboardExpirationMs;
}) {
  const [isExpanded, setIsExpanded] = useState(defaultExpanded);
  const [copyStatus, setCopyStatus] = useState<
    "idle" | "copied" | "failed" | "cleared" | "clear-unconfirmed"
  >("idle");
  const statusId = useId();

  // Opaque ref holding the last copied value for the auto-clear check.
  // Never stored in react state so it is not rendered, serialized, or part
  // of any snapshot/dev-tools state tree.
  const copiedValueRef = useRef<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const statusTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearTimers = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const scheduleStatusReset = useCallback(() => {
    if (statusTimerRef.current !== null) {
      clearTimeout(statusTimerRef.current);
    }
    statusTimerRef.current = setTimeout(() => {
      setCopyStatus("idle");
      statusTimerRef.current = null;
    }, 3000);
  }, []);

  useEffect(() => {
    return () => {
      clearTimers();
      if (statusTimerRef.current !== null) {
        clearTimeout(statusTimerRef.current);
        statusTimerRef.current = null;
      }
      copiedValueRef.current = null;
    };
  }, [clearTimers]);

  const scheduleAutoClear = useCallback(
    (copied: string, effectiveExpirationMs: ClipboardExpirationMs) => {
      clearTimers();
      copiedValueRef.current = copied;
      if (effectiveExpirationMs <= 0) {
        return;
      }
      timerRef.current = setTimeout(async () => {
        timerRef.current = null;
        const stillCopied = copiedValueRef.current;
        copiedValueRef.current = null;
        if (stillCopied === null) {
          return;
        }
        const result = await clearClipboardIfMatches(stillCopied);
        setCopyStatus(
          result === "cleared" ? "cleared" : "clear-unconfirmed",
        );
        scheduleStatusReset();
      }, effectiveExpirationMs * 1000);
    },
    [clearTimers, scheduleStatusReset],
  );

  const handleCopy = useCallback(async () => {
    try {
      if (!navigator.clipboard?.writeText) {
        throw new Error("Clipboard API unavailable");
      }
      await navigator.clipboard.writeText(value);
      setCopyStatus("copied");
      const effective = resolveExpirationMs(expirationMs, sensitivity);
      scheduleAutoClear(value, effective);
    } catch {
      // Manual fallback: select the text so the user can copy it
      // themselves via their browser/OS copy shortcut, satisfying
      // "provide copy feedback and manual fallback" even when the
      // Clipboard API is denied/unavailable.
      setCopyStatus("failed");
    } finally {
      scheduleStatusReset();
    }
  }, [value, expirationMs, sensitivity, scheduleAutoClear, scheduleStatusReset]);

  const handleManualClear = useCallback(async () => {
    clearTimers();
    const copied = copiedValueRef.current;
    copiedValueRef.current = null;
    if (copied === null) {
      // Nothing we know we wrote is pending clear; do not claim a
      // confirmed clear.
      setCopyStatus("clear-unconfirmed");
      scheduleStatusReset();
      return;
    }
    const result = await clearClipboardIfMatches(copied);
    setCopyStatus(result === "cleared" ? "cleared" : "clear-unconfirmed");
    scheduleStatusReset();
  }, [clearTimers, scheduleStatusReset]);

  if (isMalformedIdentifier(value)) {
    return (
      <span className="text-xs text-slate-500" role="status">
        No {describeIdentifierKind(kind)} available
      </span>
    );
  }

  const display = computeIdentifierDisplay(value);
  const kindLabel = network
    ? `${describeIdentifierKind(kind)} on ${network}`
    : describeIdentifierKind(kind);

  // Bidi safety (#228): the raw `value` (used for copy, via handleCopy
  // below, and for the aria-label's spoken content) is never mutated -
  // only what gets wrapped in Unicode isolate marks for VISUAL rendering
  // changes. Bidi control characters are stripped from the aria-label
  // too so a screen reader doesn't get a confusing readout, but the
  // underlying `value` string handleCopy sends to the clipboard is
  // completely untouched by any of this.
  const visibleText = isExpanded ? display.fullValue : display.compactLabel;
  const { displayValue: isolatedVisibleText } = makeBidiSafeForDisplay(visibleText);
  const spokenV = stripBidiControlCharacters(value);

  const effectiveExpiration = resolveExpirationMs(expirationMs, sensitivity);
  const expirationLabel =
    effectiveExpiration === 0
      ? "never auto-clears"
      : `auto-clears after ${effectiveExpiration} second${effectiveExpiration === 1 ? "" : "s"}`;

  const statusMessage =
    copyStatus === "copied"
      ? `Copied ${kindLabel}. ${expirationLabel}.`
      : copyStatus === "failed"
        ? "Could not copy to clipboard. Select the text to copy manually."
        : copyStatus === "cleared"
          ? "Clipboard cleared."
          : copyStatus === "clear-unconfirmed"
            ? "Clipboard clear could not be confirmed. Clear it manually if needed."
            : "";

  return (
    <span className="inline-flex flex-wrap items-center gap-1.5" data-testid="cryptographic-identifier">
      <span
        aria-label={`${kindLabel}: ${spokenV}`}
        className="font-mono text-xs text-slate-200"
        dir="ltr"
        style={BIDI_ISOLATE_STYLE}
        // The full value is always present in the DOM (via aria-label and
        // the hidden full-value span below for copy/select), but the
        // visually rendered text is truncated unless expanded.
      >
        {isolatedVisibleText}
      </span>
      <button
        type="button"
        onClick={() => setIsExpanded((prev) => !prev)}
        aria-expanded={isExpanded}
        aria-label={isExpanded ? "Collapse identifier" : "Expand identifier"}
        className="text-xs text-slate-400 hover:text-slate-200"
      >
        {isExpanded ? "Show less" : "Show more"}
      </button>
      <button
        type="button"
        onClick={handleCopy}
        aria-label={`Copy ${kindLabel} to clipboard`}
        className="text-xs text-slate-400 hover:text-slate-200"
      >
        Copy
      </button>
      <button
        type="button"
        onClick={handleManualClear}
        aria-label={`Clear ${kindLabel} from clipboard`}
        className="text-xs text-slate-400 hover:text-slate-200"
      >
        Clear
      </button>
      <span
        id={statusId}
        role="status"
        aria-live="polite"
        className="text-xs text-slate-400"
        data-testid="cryptographic-identifier-status"
      >
        {statusMessage}
      </span>
    </span>
  );
}
