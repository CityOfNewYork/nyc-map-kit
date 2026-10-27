// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import places from "../../../public/places.json";
import { LandingPage } from "./LandingPage.tsx";

// The search box without a Geoclient key, whatever a developer's .env.local holds.
vi.hoisted(() => vi.stubEnv("VITE_GEOCLIENT_KEY", ""));

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => places })));
  vi.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function renderLanding(leaving = false) {
  const onOpenMap = vi.fn();
  const onFound = vi.fn();
  const view = render(<LandingPage leaving={leaving} onOpenMap={onOpenMap} onFound={onFound} />);
  return { onOpenMap, onFound, ...view };
}

describe("LandingPage", () => {
  test("renders the hero heading and intro text", () => {
    renderLanding();
    expect(screen.getByRole("heading", { level: 1, name: "Find a warming center near you" }))
      .toBeInTheDocument();
    expect(screen.queryByRole("region")).toBeNull();   // the heading names it; not a landmark too
    expect(screen.getByText(/^During periods of extreme cold/)).toBeInTheDocument();
  });

  test("the 311 outreach link opens in a new tab and says so to screen readers", () => {
    renderLanding();
    const link = screen.getByRole("link", { name: /^homeless outreach assistance\s*\(opens in a new tab\)$/ });
    expect(link).toHaveAttribute("href", "https://portal.311.nyc.gov/");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener");
  });

  test("the search box's form is the search landmark", () => {
    renderLanding();
    expect(screen.getByRole("search")).toContainElement(screen.getByRole("combobox"));
  });

  test("See full map calls onOpenMap", () => {
    const { onOpenMap } = renderLanding();
    fireEvent.click(screen.getByRole("button", { name: /See full map/ }));
    expect(onOpenMap).toHaveBeenCalled();
  });

  test("a search result calls onFound with the place", async () => {
    const { onFound } = renderLanding();
    const input = screen.getByRole("combobox");
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "Harlem" } });
    fireEvent.submit(input.closest("form")!);
    await waitFor(() => expect(onFound).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "nbhd", name: "Harlem" })));
  });

  test("the hero folds away when the reader leaves for the map", () => {
    // jsdom lays nothing out, so give the hero a height to fold from.
    vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(240);
    const { rerender, onOpenMap, onFound } = renderLanding();
    const hero = screen.getByRole("heading", { level: 1 }).closest<HTMLElement>(".hero")!;
    expect(hero.style.height).toBe("");
    rerender(<LandingPage leaving onOpenMap={onOpenMap} onFound={onFound} />);
    expect(hero.style.height).toBe("0px");
  });
});
