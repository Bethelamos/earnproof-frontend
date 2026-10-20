/**
 * @jest-environment jsdom
 */

import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { ShareLinkTokenReveal } from "../share-link-token-reveal";

const TOKEN = "abc123";
const EXPIRES_AT = "2026-06-01T00:00:00.000Z";

function installClipboard(writeText: jest.Mock) {
  Object.defineProperty(navigator, "clipboard", {
    value: { writeText },
    configurable: true,
  });
}

describe("ShareLinkTokenReveal", () => {
  const originalClipboard = navigator.clipboard;

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
    Object.defineProperty(navigator, "clipboard", { value: originalClipboard, configurable: true });
  });

  it("displays the raw token in the input", () => {
    render(<ShareLinkTokenReveal token={TOKEN} expiresAt={EXPIRES_AT} onDismiss={jest.fn()} />);
    expect(screen.getByLabelText("Share token")).toHasValue(TOKEN);
  });

  it("shows a copy success message when the clipboard write succeeds", async () => {
    const writeText = jest.fn().mockResolved(undefined);
    installClipboard(writeText);

    render(<ShareLinkTokenReveal token={TOKEN} expiresAt={EXPIRES_AT} onDismiss={jest.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /Copy/i }));

    await waitFor(() => expect(screen.getByText("Copied to clipboard")).toBeInTheDocument());
    expect(writeText).toHaveBeenCalledWith(TOKEN);
  });

  it("shows a manual-copy fallback message when the clipboard write fails", async () => {
    installClipboard(jest.fn().mockRejected(new Error("denied")));

    render(<ShareLinkTokenReveal token={TOKEN} expiresAt={EXPIRES_AT} onDismiss={jest.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /Copy/i }));

    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(/copy it manually/i));
  });

  it("announces copy success through a polite status region", async () => {
    installClipboard(jest.fn().mockResolved(undefined));

    render(<ShareLinkTokenReveal token={TOKEN} expiresAt={EXPIRES_AT} onDismiss={jest.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /Copy/i }));

    const status = screen.getByRole("status");
    await waitFor(() => expect(status).toHaveTextContent(/Copied to clipboard/i));
  });

  it("does not claim the clipboard was cleared when the platform cannot confirm it", async () => {
    jest.useFakeTimers();
    installClipboard(jest.fn().mockResolved(undefined));

    render(
      <ShareLinkTokenReveal
        token={TOKEN}
        expiresAt={EXPIRES_AT}
        onDismiss={jest.fn()}
        clipboardClearDelayMs={1000}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Copy/i }));

    await act(async () => {
      await Promise.resolve();
    });

    act(() => {
      jest.advanceTimersBy(1000);
    });

    expect(screen.queryByText(/clipboard was cleared/i)).not.toBeInTheDocument();
    expect(screen.getByText(/Copied to clipboard/i)).toBeInTheDocument();
  });

  it("does not store the copied value in the clear timer", async () => {
    jest.useFakeTimers();
    const setTimeoutSpy = jest.spyOn(global, "setTimeout");
    installClipboard(jest.fn().mockResolved(undefined));

    render(
      <ShareLinkTokenReveal
        token={TOKEN}
        expiresAt={EXPIRES_AT}
        onDismiss={jest.fn()}
        clipboardClearDelayMs={1000}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Copy/i }));

    await act(async () => {
      await Promise.resolve();
    });

    const timerCalls = setTimeoutSpy.mock.calls.filter(([, delay]) => delay === 1000);
    expect(timerCalls.length).toBeGreaterThan(0);
    for (const call of timerCalls) {
      for (const arg of call) {
        if (typeof arg === "string") {
          expect(arg).not.toContain(TOKEN);
        }
      }
    }
  });

  it("resets the copy status when the token changes", async () => {
    installClipboard(jest.fn().mockResolved(undefined));

    const { rerender } = render(
      <ShareLinkTokenReveal token={TOKEN} expiresAt={EXPIRES_AT} onDismiss={jest.fn()} />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Copy/i }));
    await waitFor(() => expect(screen.getByText("Copied to clipboard")).toBeInTheDocument());

    rerender(
      <ShareLinkTokenReveal token="next-token" expiresAt={EXPIRES_AT} onDismiss={jest.fn()} />,
    );

    expect(screen.queryByText("Copied to clipboard")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Share token")).toHaveValue("next-token");
  });

  it("provides a manual clear action that does not claim confirmation", async () => {
    installClipboard(jest.fn().mockResolved(undefined));

    render(<ShareLinkTokenReveal token={TOKEN} expiresAt={EXPIRES_AT} onDismiss={jest.fn()} />);
    const clearButton = screen.getByRole("button", { name: /Clear clipboard/i });
    fireEvent.click(clearButton);

    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent(/clipboard was cleared/i));
  });

  it("calls onDismiss when the dismiss button is clicked", () => {
    const onDismiss = jest.fn();
    render(<ShareLinkTokenReveal token={TOKEN} expiresAt={EXPIRES_AT} onDismiss={onDismiss} />);

    fireEvent.click(screen.getByRole("button", { name: /I've saved the token/i }));
    expect(onDismiss).toHaveBeenCalled();
  });

  it("clears the token input value on unmount", () => {
    const { unmount } = render(
      <ShareLinkTokenReveal token={TOKEN} expiresAt={EXPIRES_AT} onDismiss={jest.fn()} />,
    );

    const input = screen.getByLabelText("Share token") as HTMLInputElement;
    unmount();
    expect(input.value).toBe("");
  });

  it("cancels pending clear timers on unmount", () => {
    jest.useFakeTimers();
    const clearTimeoutSpy = jest.spyOn(global, "clearTimeout");
    installClipboard(jest.fn().mockResolved(undefined));

    const { unmount } = render(
      <ShareLinkTokenReveal
        token={TOKEN}
        expiresAt={EXPIRES_AT}
        onDismiss={jest.fn()}
        clipboardClearDelayMs={1000}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Copy/i }));

    // Flush the resolved clipboard promise so the timer is scheduled.
    return Promise.resolve().then(() => {
      unmount();
      expect(clearTimeoutSpy).toHaveBeenCalled();
    });
  });
});
