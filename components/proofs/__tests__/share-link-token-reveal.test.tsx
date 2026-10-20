/**
 * @jest-environment jsdom
 */

import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ShareLinkTokenReveal } from "../share-link-token-reveal";

describe("ShareLinkTokenReveal", () => {
  const originalClipboard = navigator.clipboard;

  afterEach(() => {
    Object.defineProperty(navigator, "clipboard", { value: originalClipboard, configurable: true });
  });

  it("displays the raw token in the input", () => {
    render(<ShareLinkTokenReveal token="abc123" expiresAt="2026-06-01T00:00:00.000Z" onDismiss={jest.fn()} />);
    expect(screen.getByLabelText("Share token")).toHaveValue("abc123");
  });

  it("shows a copy success message when the clipboard write succeeds", async () => {
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: jest.fn().mockResolvedValue(undefined) },
      configurable: true,
    });

    render(<ShareLinkTokenReveal token="abc123" expiresAt="2026-06-01T00:00:00.000Z" onDismiss={jest.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /Copy/i }));

    await waitFor(() => expect(screen.getByText("Copied to clipboard")).toBeInTheDocument());
  });

  it("shows a manual-copy fallback message when the clipboard write fails", async () => {
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: jest.fn().mockRejectedValue(new Error("denied")) },
      configurable: true,
    });

    render(<ShareLinkTokenReveal token="abc123" expiresAt="2026-06-01T00:00:00.000Z" onDismiss={jest.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /Copy/i }));

    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(/copy it manually/i));
  });

  it("calls onDismiss when the dismiss button is clicked", () => {
    const onDismiss = jest.fn();
    render(<ShareLinkTokenReveal token="abc123" expiresAt="2026-06-01T00:00:00.000Z" onDismiss={onDismiss} />);

    fireEvent.click(screen.getByRole("button", { name: /I've saved the token/i }));
    expect(onDismiss).toHaveBeenCalled();
  });

  it("clears the token input value on unmount", () => {
    const { unmount } = render(
      <ShareLinkTokenReveal token="abc123" expiresAt="2026-06-01T00:00:00.000Z" onDismiss={jest.fn()} />,
    );

    const input = screen.getByLabelText("Share token") as HTMLInputElement;
    unmount();
    expect(input.value).toBe("");
  });
});
