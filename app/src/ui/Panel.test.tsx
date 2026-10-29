// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { ComponentProps } from "react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { Found } from "../logic/places.ts";
import { model, site, stubScreen } from "../test/fixtures.ts";
import { Panel } from "./Panel.tsx";

/** Three Bronx sites, north to south: c, a, b. */
const sites = [
  site("a", { org: "Alpha", address: "1 Grand Concourse, Bronx", borough: "Bronx" }, [-73.9, 40.85]),
  site("b", { org: "Beta", address: "2 Grand Concourse, Bronx", borough: "Bronx" }, [-73.9, 40.82]),
  site("c", { org: "Gamma", address: "3 Grand Concourse, Bronx", borough: "Bronx" }, [-73.9, 40.88]),
];
const harlem: Found = {
  kind: "nbhd", name: "Harlem", cross: null, borough: "Manhattan", center: [-73.9, 40.815], bbox: null,
};

function renderPanel(props: Partial<ComponentProps<typeof Panel>> = {}) {
  const onOpen = vi.fn();
  render(<Panel model={model({}, sites)} list="on" selectedId={null} found={null} onOpen={onOpen}
                label="Volunteer sites" summary={<span>3 sites</span>} {...props} />);
  return { onOpen };
}
const rows = () => within(screen.getByRole("list")).queryAllByRole("button");

beforeEach(() => {
  stubScreen(true);
  vi.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("Panel", () => {
  test("renders one keyboard-operable row for every site, north to south", () => {
    renderPanel();
    expect(screen.getByRole("region", { name: "Volunteer sites" })).toBeInTheDocument();
    expect(rows().map((r) => r.textContent)).toEqual([
      "Gamma3 Grand Concourse, Bronx", "Alpha1 Grand Concourse, Bronx", "Beta2 Grand Concourse, Bronx",
    ]);
  });

  test("orders the rows nearest first after a search, with each distance", () => {
    renderPanel({ found: harlem });
    expect(rows().map((r) => r.dataset.siteId)).toEqual(["b", "a", "c"]);
    expect(within(rows()[0]).getByText("0.3 mi away")).toHaveAttribute("aria-hidden", "true");
    expect(within(rows()[0]).getByText("0.3 miles away")).toBeInTheDocument();
    expect(document.querySelector(".list-closest")).toHaveTextContent("Closest to Harlem, Manhattan");
    // The search box's line is the live region (ui/Search.tsx), so the place is heard once.
    expect(screen.queryByRole("status")).toBeNull();
  });

  test("with inOrder, keeps the sites' own order, until a search orders them nearest first", () => {
    renderPanel({ inOrder: true });
    expect(rows().map((r) => r.dataset.siteId)).toEqual(["a", "b", "c"]);
    cleanup();
    renderPanel({ inOrder: true, found: harlem });
    expect(rows().map((r) => r.dataset.siteId)).toEqual(["b", "a", "c"]);
  });

  test("omits site rows when list is off, and keeps the summary", () => {
    renderPanel({ list: "off" });
    expect(rows()).toEqual([]);
    expect(screen.getByText("3 sites")).toBeInTheDocument();
  });

  test("opens the selected site from its row, and marks the open one", () => {
    const { onOpen } = renderPanel({ selectedId: "a" });
    const alpha = screen.getByRole("button", { name: /Alpha/ });
    expect(alpha).toHaveAttribute("aria-current", "true");
    expect(screen.getByRole("button", { name: /Beta/ })).not.toHaveAttribute("aria-current");
    fireEvent.click(alpha);
    expect(onOpen).toHaveBeenCalledWith(alpha, sites[0]);
  });

  test("shows 50 rows at a time, and Show more moves focus to the first new one", () => {
    const many = Array.from({ length: 120 }, (_, i) =>
      site(`s${i}`, { borough: "Bronx" }, [-73.9, 40.9 - i / 1000]));
    renderPanel({ model: model({}, many) });
    expect(rows()).toHaveLength(50);
    fireEvent.click(screen.getByRole("button", { name: "Show more" }));
    expect(rows()).toHaveLength(100);
    expect(rows()[50]).toHaveFocus();
    fireEvent.click(screen.getByRole("button", { name: "Show more" }));
    expect(rows()).toHaveLength(120);
    expect(screen.queryByRole("button", { name: "Show more" })).toBeNull();
  }, 15_000);   // 120 rows take seconds to render under coverage, beside the other files

  test("on a desktop the list starts open, and the handle hides it and shows it again", () => {
    renderPanel();
    const handle = screen.getByRole("button", { name: /Show or hide the list/ });
    expect(screen.getByRole("region")).not.toHaveClass("shut");
    expect(handle).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("3 sites")).toBeInTheDocument();
    fireEvent.click(handle);
    expect(screen.getByRole("region")).toHaveClass("shut");
    expect(handle).toHaveAttribute("aria-expanded", "false");
    expect(handle.querySelector(".counts")).toHaveTextContent(/^Show list$/);
    fireEvent.click(handle);
    expect(handle).toHaveAttribute("aria-expanded", "true");
  });

  test("its top line is a heading whose button says how many sites, open or shut", () => {
    renderPanel();
    const handle = screen.getByRole("button", { name: /^3 sites\s*Show or hide the list$/ });
    expect(screen.getByRole("heading", { level: 2 })).toContainElement(handle);
    fireEvent.click(handle);
    expect(handle).toHaveAccessibleName("Show list, 3 sites");
  });

  test("on a phone the handle steps the sheet between collapsed and half height", () => {
    stubScreen(false);
    renderPanel();
    const handle = screen.getByRole("button", { name: /Show or hide the list/ });
    const scroll = document.querySelector(".site-scroll")!;
    expect(handle).toHaveAttribute("aria-expanded", "false");
    expect(scroll).toHaveAttribute("inert");
    expect(document.documentElement.style.getPropertyValue("--sheet-h")).toBe("48px");
    fireEvent.click(handle);
    expect(handle).toHaveAttribute("aria-expanded", "true");
    expect(scroll).not.toHaveAttribute("inert");
    expect(document.documentElement.style.getPropertyValue("--sheet-h")).toBe("45dvh");
    fireEvent.click(handle);
    expect(handle).toHaveAttribute("aria-expanded", "false");
  });

  test("says when no site matches the filters, and offers to clear them", () => {
    const onClearFilters = vi.fn();
    renderPanel({ model: model({}, []), onClearFilters });
    expect(screen.getByText("No locations match your filters.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
    expect(onClearFilters).toHaveBeenCalled();
  });
});
