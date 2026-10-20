"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { formatDate } from "@/lib/i18n";

/**
 * Modeled directly on components/developers/one-time-secret.tsx: the raw
 * token is shown exactly once, cleared from the DOM input on unmount, and
 * never re-derivable from this component after the user navigates away
 * (the caller must not hold onto the token past this render).
 */
export function ShareLinkTokenReveal({
  token,
  expiresAt,
  onDismiss,
}: {
  token: string;
  expiresAt: string;
  onDismiss: () => void;
}) {
  const [copyStatus, setCopyStatus] = useState<string | null>(null);
  const [copyError, setCopyError] = useState<string | null>(null);
  const tokenRef = useRef<HTMLInputElement>(null);
  const dismissButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    dismissButtonRef.current?.focus();
  }, []);

  useEffect(() => {
    const input = tokenRef.current;
    return () => {
      if (input) {
        input.value = "";
      }
    };
  }, []);

  const handleCopy = useCallback(async () => {
    setCopyError(null);
    setCopyStatus(null);

    try {
      await navigator.clipboard.writeText(token);
      setCopyStatus("Copied to clipboard");
      setTimeout(() => setCopyStatus(null), 3000);
    } catch {
      setCopyError("Failed to copy to clipboard. Select the token and copy it manually.");
    }
  }, [token]);

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
            className="h-10 rounded-md border border-emerald-300/30 bg-emerald-300 px-4 text-xs font-semibold text-slate-950 hover:bg-emerald-200 transition"
            onClick={handleCopy}
            type="button"
          >
            Copy
          </button>
        </div>
        {copyStatus && (
          <p className="mt-1 text-xs text-emerald-200" aria-live="polite">
            {copyStatus}
          </p>
        )}
        {copyError && (
          <p className="mt-1 text-xs text-rose-200" role="alert">
            {copyError}
          </p>
        )}
      </div>

      <div className="mt-4">
        <button
          ref={dismissButtonRef}
          className="h-10 rounded-md border border-emerald-300/30 px-4 text-xs font-semibold text-emerald-100 hover:bg-emerald-300/10 transition"
          onClick={onDismiss}
          type="button"
        >
          I&apos;ve saved the token, dismiss this
        </button>
      </div>
    </section>
  );
}
