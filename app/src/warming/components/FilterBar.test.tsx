// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { stubDialog, stubScreen } from "../../test/fixtures.ts";
import { NO_FILTERS } from "../logic/filters.ts";
import { FilterBar } from "./FilterBar.tsx";
import { FilterPanel } from "./FilterPanel.tsx";

beforeEach(() => {
  window.dataLayer = [];
  vi.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("FilterBar", () => {
  test("open now comes first, then the kinds of center, then wheelchair and pets", () => {
    render(<FilterBar filters={NO_FILTERS} onChange={() => {}} />);
    expect(screen.getAllByRole("button").map((b) => b.textContent)).toEqual(
      ["Open now", "Location type", "Wheelchair accessible", "Pets allowed"]);
  });

  test("Location type opens a menu of kinds, and a kind filters the centers", () => {
    const onChange = vi.fn();
    render(<FilterBar filters={NO_FILTERS} onChange={onChange} />);
    const button = screen.getByRole("button", { name: "Location type" });
    expect(button).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(button);
    expect(button).toHaveAttribute("aria-expanded", "true");
    fireEvent.click(screen.getByRole("checkbox", { name: "Hospital" }));
    expect(onChange).toHaveBeenCalledWith({ ...NO_FILTERS, types: ["hospital"] });
    expect(window.dataLayer).toEqual([{ event: "map_filter", filter: "type", value: "hospital:true" }]);
  });

  test("the menu closes on Done, Escape or a press elsewhere, focus back on its button", () => {
    render(<><FilterBar filters={NO_FILTERS} onChange={() => {}} /><p>Elsewhere</p></>);
    const button = screen.getByRole("button", { name: "Location type" });
    fireEvent.click(button);
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(button).toHaveAttribute("aria-expanded", "false");
    expect(button).toHaveFocus();
    fireEvent.click(button);
    fireEvent.keyDown(screen.getByRole("checkbox", { name: "Hospital" }), { key: "Escape" });
    expect(button).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(button);
    fireEvent.pointerDown(screen.getByText("Elsewhere"));
    expect(button).toHaveAttribute("aria-expanded", "false");
  });

  test("open now, wheelchair and pets are toggles, tinted while on", () => {
    const onChange = vi.fn();
    const { rerender } = render(<FilterBar filters={NO_FILTERS} onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: "Open now" }));
    expect(onChange).toHaveBeenLastCalledWith({ ...NO_FILTERS, openNow: true });
    fireEvent.click(screen.getByRole("button", { name: "Pets allowed" }));
    expect(onChange).toHaveBeenLastCalledWith({ ...NO_FILTERS, pets: true });
    expect(window.dataLayer).toEqual([
      { event: "map_filter", filter: "open", value: true },
      { event: "map_filter", filter: "pets", value: true },
    ]);
    rerender(<FilterBar filters={{ ...NO_FILTERS, wheelchair: true, types: ["bus"] }} onChange={onChange} />);
    expect(screen.getByRole("button", { name: "Wheelchair accessible" }))
      .toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Location type" })).toHaveClass("on");
  });
});

describe("FilterPanel", () => {
  test("holds the kinds and the toggles, counts what they leave, and clears them", () => {
    stubScreen(false);
    stubDialog();
    const onChange = vi.fn();
    render(<FilterPanel id="filters" filters={{ ...NO_FILTERS, types: ["bus"] }} shown={8}
                        onChange={onChange} onClose={() => {}} />);
    const body = document.querySelector(".filters-body")!;
    // Each button's name, less the count Location type carries of the kinds chosen.
    expect([...body.querySelectorAll(":scope > * > button")]
      .map((b) => b.textContent!.replace(/\d.*$/, "")))
      .toEqual(["Open now", "Location type", "Wheelchair accessible", "Pets allowed"]);
    fireEvent.click(screen.getByRole("button", { name: /^Location type/ }));
    expect(screen.getByRole("checkbox", { name: "Warming bus" })).toBeChecked();
    fireEvent.click(screen.getByRole("checkbox", { name: "Warming bus" }));
    expect(onChange).toHaveBeenLastCalledWith(NO_FILTERS);
    expect(screen.getByRole("button", { name: "Open now" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Show 8 locations" })).toBeInTheDocument();
    onChange.mockClear();
    fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
    expect(onChange).toHaveBeenCalledWith(NO_FILTERS);
    expect(window.dataLayer?.at(-1)).toEqual({ event: "map_filter", filter: "clear" });
  });
});
