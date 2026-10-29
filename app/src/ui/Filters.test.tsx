// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { stubDialog, stubScreen } from "../test/fixtures.ts";
import { FilterDisclosure, FiltersButton, FiltersPanel } from "./Filters.tsx";

let dialog: ReturnType<typeof stubDialog>;
beforeEach(() => { dialog = stubDialog(); });
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("FiltersButton", () => {
  test("says whether its panel is open, and how many filters are on", () => {
    const onClick = vi.fn();
    const { rerender } = render(
      <FiltersButton ref={null} controls="filters" open={false} active={0} onClick={onClick} />);
    const button = screen.getByRole("button", { name: "Filters" });
    expect(button).toHaveAttribute("aria-expanded", "false");
    expect(button).toHaveAttribute("aria-controls", "filters");
    rerender(<FiltersButton ref={null} controls="filters" open active={2} onClick={onClick} />);
    expect(button).toHaveAttribute("aria-expanded", "true");
    expect(button).toHaveAccessibleName(/^Filters\s*2 filters on$/);
    expect(screen.getByText("2")).toHaveAttribute("aria-hidden", "true");
    fireEvent.click(button);
    expect(onClick).toHaveBeenCalled();
  });
});

describe("FiltersPanel", () => {
  function renderPanel(shown = 3) {
    const onClear = vi.fn();
    const onClose = vi.fn();
    const view = render(
      <FiltersPanel id="filters" shown={shown} onClear={onClear} onClose={onClose}>
        <label><input type="checkbox" /> Open now</label>
      </FiltersPanel>);
    return { onClear, onClose, view };
  }

  test("opens beside the map on a desktop and as a modal on a phone, focused on its heading", () => {
    stubScreen(true);
    renderPanel();
    expect(dialog.show).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("heading", { name: "Filters" })).toHaveFocus();
    cleanup();
    stubScreen(false);
    renderPanel();
    expect(dialog.showModal).toHaveBeenCalledTimes(1);
  });

  test("opens as a modal on a desktop too, when asked", () => {
    stubScreen(true);
    render(
      <FiltersPanel id="filters" shown={3} onClear={() => {}} onClose={() => {}} modal>
        <label><input type="checkbox" /> Open now</label>
      </FiltersPanel>);
    expect(dialog.showModal).toHaveBeenCalledTimes(1);
    expect(dialog.show).not.toHaveBeenCalled();
  });

  test("Clear filters, Show n locations, the close button and Escape", () => {
    stubScreen(true);
    const { onClear, onClose } = renderPanel();
    fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
    expect(onClear).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Show 3 locations" }));
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(3);
  });

  test("keeps its heading and buttons outside the filters, the part that scrolls", () => {
    stubScreen(true);
    renderPanel();
    const body = document.querySelector(".filters-body")!;
    expect(body).toContainElement(screen.getByRole("checkbox", { name: "Open now" }));
    for (const el of [screen.getByRole("heading", { name: "Filters" }),
                      ...screen.getAllByRole("button")]) {
      expect(body).not.toContainElement(el);
    }
  });

  test("counts one location in the singular, and closes when it goes", () => {
    stubScreen(true);
    const { view } = renderPanel(1);
    expect(screen.getByRole("button", { name: "Show 1 location" })).toBeInTheDocument();
    const panel = screen.getByRole("dialog");
    view.unmount();
    expect(panel).not.toHaveAttribute("open");
  });
});

describe("FilterDisclosure", () => {
  test("shows and hides its options, named as a group, with the ones chosen", () => {
    const { rerender } = render(
      <FilterDisclosure label="Location type" chosen={["Hospital", "Warming bus"]}>
        <label><input type="checkbox" /> Hospital</label>
      </FilterDisclosure>);
    const button = screen.getByRole("button", { name: "Location type Hospital, Warming bus" });
    const group = document.getElementById(button.getAttribute("aria-controls")!)!;
    expect(button).toHaveAttribute("aria-expanded", "false");
    expect(group).not.toBeVisible();
    fireEvent.click(button);
    expect(button).toHaveAttribute("aria-expanded", "true");
    expect(group).toBeVisible();
    expect(screen.getByRole("group", { name: "Location type" })).toBe(group);
    rerender(
      <FilterDisclosure label="Location type" chosen={[]}>
        <label><input type="checkbox" /> Hospital</label>
      </FilterDisclosure>);
    expect(button).toHaveAccessibleName("Location type Select option");
  });
});
