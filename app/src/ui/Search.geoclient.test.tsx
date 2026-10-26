// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import places from "../../public/places.json";
import { geocode } from "../logic/geocode.ts";
import type { Found } from "../logic/places.ts";

// The box with a Geoclient key, set before Search loads; Geoclient itself is stubbed.
vi.hoisted(() => vi.stubEnv("VITE_GEOCLIENT_KEY", "test-key"));
vi.mock("../logic/geocode.ts", () => ({ geocode: vi.fn() }));
const { Search } = await import("./Search.tsx");

const broadway = (borough: string, lon: number): Found => ({
  kind: "address", name: "120 Broadway", cross: null, borough, center: [lon, 40.7], bbox: null,
});

/** Geoclient finds 120 Broadway in two boroughs. */
const inTwoBoroughs = () => vi.mocked(geocode).mockResolvedValue({
  type: "found", matches: [broadway("Manhattan", -74.01), broadway("Brooklyn", -73.95)],
});

function renderSearch() {
  const onFound = vi.fn();
  const onClear = vi.fn();
  render(<Search onFound={onFound} onClear={onClear} />);
  const input = screen.getByRole("combobox");
  const search = (text: string) => {
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: text } });
    fireEvent.submit(input.closest("form")!);
  };
  return { onFound, onClear, input, search };
}

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => places })));
  window.dataLayer = [];
  vi.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.mocked(geocode).mockReset();
});

describe("Search with a Geoclient key", () => {
  test("says it finds addresses too, and still finds neighborhoods in the page", async () => {
    const { input, onFound, search } = renderSearch();
    expect(input).toHaveAccessibleName("Enter an address or neighborhood");
    search("Harlem");
    await waitFor(() => expect(onFound).toHaveBeenCalled());
    expect(geocode).not.toHaveBeenCalled();
  });

  test("asks Geoclient for anything else, and shows a single match", async () => {
    vi.mocked(geocode).mockResolvedValue({ type: "found", matches: [broadway("Manhattan", -74.01)] });
    const { onFound, search } = renderSearch();
    search("120 Broadway");
    await waitFor(() => expect(onFound).toHaveBeenCalledWith(broadway("Manhattan", -74.01)));
    expect(geocode).toHaveBeenCalledWith("120 Broadway", "test-key", expect.any(AbortSignal));
    expect(window.dataLayer).toEqual([{ event: "map_search", via: "search", result: "address" }]);
  });

  test("offers a choice when the address is in more than one borough", async () => {
    inTwoBoroughs();
    const { onFound, input, search } = renderSearch();
    search("120 Broadway");
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Which one do you mean?"));
    fireEvent.click(screen.getByRole("option", { name: /Brooklyn/ }));
    expect(onFound).toHaveBeenCalledWith(broadway("Brooklyn", -73.95));
    expect(input).toHaveValue("120 Broadway, Brooklyn");
    expect(input).toHaveFocus();
  });

  test("the choices are a list box named by the question, and arrows move through them from the box", async () => {
    inTwoBoroughs();
    const user = userEvent.setup();
    const { onFound, input, search } = renderSearch();
    search("120 Broadway");
    const list = await screen.findByRole("listbox", { name: "Which one do you mean?" });
    const [manhattan, brooklyn] = within(list).getAllByRole("option");
    expect(input).toHaveAttribute("aria-expanded", "true");
    expect(input).toHaveAttribute("aria-controls", list.id);
    expect(input).not.toHaveAttribute("aria-activedescendant");

    await user.click(input);
    await user.keyboard("{ArrowDown}");
    expect(input).toHaveAttribute("aria-activedescendant", manhattan.id);
    expect(manhattan).toHaveAttribute("aria-selected", "true");
    await user.keyboard("{ArrowDown}");
    expect(input).toHaveAttribute("aria-activedescendant", brooklyn.id);
    await user.keyboard("{ArrowDown}");
    expect(input).toHaveAttribute("aria-activedescendant", manhattan.id);
    await user.keyboard("{ArrowUp}");
    expect(input).toHaveAttribute("aria-activedescendant", brooklyn.id);
    expect(input).toHaveFocus();

    await user.keyboard("{Enter}");
    expect(onFound).toHaveBeenCalledWith(broadway("Brooklyn", -73.95));
    expect(input).toHaveValue("120 Broadway, Brooklyn");
    expect(input).toHaveAttribute("aria-expanded", "false");
  });

  test("Escape closes the choices and keeps the text; a second Escape clears the box", async () => {
    inTwoBoroughs();
    const user = userEvent.setup();
    const { input, search } = renderSearch();
    search("120 Broadway");
    await screen.findByRole("listbox");
    await user.click(input);
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(input).toHaveValue("120 Broadway");
    await user.keyboard("{Escape}");
    expect(input).toHaveValue("");
  });

  test("offers close spellings, and searches the one chosen", async () => {
    vi.mocked(geocode).mockResolvedValueOnce({
      type: "suggest",
      suggestions: [{ house: "120", street: "BROADWAY", borough: "Manhattan", query: "120 Broadway, Manhattan" }],
    });
    vi.mocked(geocode).mockResolvedValueOnce({ type: "found", matches: [broadway("Manhattan", -74.01)] });
    const { onFound, search } = renderSearch();
    search("120 Brodway");
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Did you mean:"));
    fireEvent.click(screen.getByRole("option", { name: /BROADWAY/ }));
    await waitFor(() => expect(onFound).toHaveBeenCalled());
    expect(geocode).toHaveBeenLastCalledWith("120 Broadway, Manhattan", "test-key", expect.any(AbortSignal));
  });

  test("says when address search is not working", async () => {
    vi.mocked(geocode).mockRejectedValue(new Error("503"));
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const { search } = renderSearch();
    search("120 Broadway");
    await waitFor(() => expect(screen.getByRole("status"))
      .toHaveTextContent("Address search is not working right now."));
    expect(window.dataLayer).toEqual([{ event: "map_search", via: "search", result: "error" }]);
  });
});
