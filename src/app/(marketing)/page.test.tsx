import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import MarketingPage from "./page";

const { replace } = vi.hoisted(() => ({ replace: vi.fn() }));
const router = { replace };

vi.mock("next/navigation", () => ({ useRouter: () => router }));

describe("installed app homepage launches", () => {
  let standalone: MediaQueryList;
  const originalStandalone = Object.getOwnPropertyDescriptor(navigator, "standalone");

  beforeEach(() => {
    replace.mockClear();
    standalone = Object.assign(new EventTarget(), {
      matches: false,
      media: "(display-mode: standalone)",
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
    }) as MediaQueryList;
    vi.stubGlobal("matchMedia", () => standalone);
    Object.defineProperty(navigator, "standalone", { configurable: true, value: false });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    if (originalStandalone) {
      Object.defineProperty(navigator, "standalone", originalStandalone);
    } else {
      Reflect.deleteProperty(navigator, "standalone");
    }
  });

  it("keeps the public homepage available in a browser tab", () => {
    render(<MarketingPage />);

    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      "One workspace to run your business.",
    );
    expect(replace).not.toHaveBeenCalled();
  });

  it("replaces the homepage with the dashboard in standalone mode", () => {
    Object.defineProperty(standalone, "matches", { configurable: true, value: true });

    render(<MarketingPage />);

    expect(replace).toHaveBeenCalledWith("/dashboard");
  });

  it("opens the dashboard for an iOS home-screen launch", () => {
    Object.defineProperty(navigator, "standalone", { configurable: true, value: true });

    render(<MarketingPage />);

    expect(replace).toHaveBeenCalledWith("/dashboard");
  });

  it("opens the dashboard when installation transfers the homepage into app mode", () => {
    render(<MarketingPage />);
    expect(replace).not.toHaveBeenCalled();

    act(() => {
      Object.defineProperty(standalone, "matches", { configurable: true, value: true });
      standalone.dispatchEvent(new Event("change"));
    });

    expect(replace).toHaveBeenCalledWith("/dashboard");
  });

  it("stops watching app mode when the homepage is left", () => {
    const { unmount } = render(<MarketingPage />);
    unmount();

    act(() => {
      Object.defineProperty(standalone, "matches", { configurable: true, value: true });
      standalone.dispatchEvent(new Event("change"));
    });

    expect(replace).not.toHaveBeenCalled();
  });
});
