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
  test("open now, wheelchair and pets come first, then More filters", () => {
    render(<FilterBar filters={NO_FILTERS} onChange={() => {}} />);
    expect(screen.getAllByRole("button").map((b) => b.textContent)).toEqual(
      ["Open now", "Wheelchair accessible", "Pets allowed", "More filters"]);
  });

  test("More filters opens a menu of kinds, and a kind filters the centers", () => {
    const onChange = vi.fn();
    render(<FilterBar filters={NO_FILTERS} onChange={onChange} />);
    const button = screen.getByRole("button", { name: "More filters" });
    expect(button).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(button);
    expect(button).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("group", { name: "Location type" })).toBeVisible();
    fireEvent.click(screen.getByRole("checkbox", { name: "Hospital" }));
    expect(onChange).toHaveBeenCalledWith({ ...NO_FILTERS, types: ["hospital"] });
    expect(window.dataLayer).toEqual([{ event: "map_filter", filter: "type", value: "hospital:true" }]);
  });

  test("the menu closes on Done, Escape or a press elsewhere, focus back on its button", () => {
    render(<><FilterBar filters={NO_FILTERS} onChange={() => {}} /><p>Elsewhere</p></>);
    const button = screen.getByRole("button", { name: "More filters" });
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
    expect(screen.getByRole("button", { name: "More filters" })).toHaveClass("on");
  });
});

describe("FilterBar in a narrow bar", () => {
  /** A bar 400 px wide, More filters 140 px and each toggle 150 px: room for one. */
  function narrow() {
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockImplementation(function (this: HTMLElement) {
      return this.classList.contains("filter-bar") ? 400 : 0;
    });
    vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockImplementation(function (this: HTMLElement) {
      return this.classList.contains("toggle-pill") ? 150 : this.classList.contains("dropdown") ? 140 : 0;
    });
  }

  test("keeps the toggles that fit and moves the rest into More filters, from the right", () => {
    narrow();
    render(<FilterBar filters={NO_FILTERS} onChange={() => {}} />);
    const bar = screen.getByRole("group", { name: "Filters" });
    expect([...bar.querySelectorAll(":scope > button")].map((b) => b.textContent))
      .toEqual(["Open now"]);
    fireEvent.click(screen.getByRole("button", { name: "More filters" }));
    const menu = document.querySelector(".dropdown-panel")!;
    expect([...menu.querySelectorAll(".toggle-pill")].map((b) => b.textContent))
      .toEqual(["Wheelchair accessible", "Pets allowed"]);
  });

  test("tints More filters while a toggle in its menu is on", () => {
    narrow();
    render(<FilterBar filters={{ ...NO_FILTERS, pets: true }} onChange={() => {}} />);
    expect(screen.getByRole("button", { name: "More filters" })).toHaveClass("on");
    cleanup();
    render(<FilterBar filters={{ ...NO_FILTERS, openNow: true }} onChange={() => {}} />);
    expect(screen.getByRole("button", { name: "More filters" })).not.toHaveClass("on");
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
      .toEqual(["Open now", "Wheelchair accessible", "Pets allowed", "Location type"]);
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
