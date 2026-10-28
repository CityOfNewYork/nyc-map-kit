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

/** The bar, with a More filters that does nothing unless given `onMore`. */
function renderBar(filters = NO_FILTERS, props: { onChange?: () => void; onMore?: () => void } = {}) {
  return render(<FilterBar filters={filters} onChange={props.onChange ?? (() => {})}
                           onMore={props.onMore ?? (() => {})} moreOpen={false} />);
}

describe("FilterBar", () => {
  test("open now, wheelchair and pets come first, then More filters", () => {
    renderBar();
    expect(screen.getAllByRole("button").map((b) => b.textContent)).toEqual(
      ["Open now", "Wheelchair accessible", "Pets allowed", "More filters"]);
  });

  test("More filters asks for the filters panel, which it names and says is shut", () => {
    const onMore = vi.fn();
    renderBar(NO_FILTERS, { onMore });
    const button = screen.getByRole("button", { name: "More filters" });
    expect(button).toHaveAttribute("aria-expanded", "false");
    expect(button).toHaveAttribute("aria-controls", "filters");
    fireEvent.click(button);
    expect(onMore).toHaveBeenCalledWith(button);
  });

  test("open now, wheelchair and pets are toggles, tinted while on", () => {
    const onChange = vi.fn();
    renderBar(NO_FILTERS, { onChange });
    fireEvent.click(screen.getByRole("button", { name: "Open now" }));
    expect(onChange).toHaveBeenLastCalledWith({ ...NO_FILTERS, openNow: true });
    fireEvent.click(screen.getByRole("button", { name: "Pets allowed" }));
    expect(onChange).toHaveBeenLastCalledWith({ ...NO_FILTERS, pets: true });
    expect(window.dataLayer).toEqual([
      { event: "map_filter", filter: "open", value: true },
      { event: "map_filter", filter: "pets", value: true },
    ]);
    cleanup();
    renderBar({ ...NO_FILTERS, wheelchair: true, types: ["bus"] });
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
      return this.classList.contains("toggle-pill") ? 150
        : this.classList.contains("more-filters") ? 140 : 0;
    });
  }

  test("keeps the toggles that fit and leaves the rest to the panel, from the right", () => {
    narrow();
    renderBar();
    const bar = screen.getByRole("group", { name: "Filters" });
    expect([...bar.querySelectorAll(":scope > button")].map((b) => b.textContent))
      .toEqual(["Open now", "More filters"]);
  });

  test("tints More filters while a toggle the row leaves out is on", () => {
    narrow();
    renderBar({ ...NO_FILTERS, pets: true });
    expect(screen.getByRole("button", { name: "More filters" })).toHaveClass("on");
    cleanup();
    renderBar({ ...NO_FILTERS, openNow: true });
    expect(screen.getByRole("button", { name: "More filters" })).not.toHaveClass("on");
  });
});

describe("FilterPanel", () => {
  test("holds the kinds, then the toggles, counts what they leave, and clears them", () => {
    stubScreen(false);
    stubDialog();
    const onChange = vi.fn();
    render(<FilterPanel id="filters" filters={{ ...NO_FILTERS, types: ["bus"] }} shown={8}
                        onChange={onChange} onClose={() => {}} />);
    const body = document.querySelector(".filters-body")!;
    // Each button's name, less the count Location type carries of the kinds chosen.
    expect([...body.querySelectorAll(":scope > * > button")]
      .map((b) => b.textContent!.replace(/\d.*$/, "")))
      .toEqual(["Location type", "Open now", "Wheelchair accessible", "Pets allowed"]);
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
