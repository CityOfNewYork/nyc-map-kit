// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { Config } from "../logic/types.ts";
import { model, site } from "../test/fixtures.ts";
import { Card, CopyLink } from "./Card.tsx";

const config: Config = {
  actions: [
    { key: "phone", source: "site", label: "Call", as: "tel" },
    { key: "website", source: "site", label: "Website", as: "url" },
    { key: "email", source: "site", label: "Email", as: "url" },
  ],
  facts: [
    { key: "hours", source: "org", label: "Hours", icon: "clock" },
    { key: "fax", source: "site", label: "Fax", icon: "info" },
  ],
  card: [
    { key: "services", source: "site", label: "Services" },
    { key: "about", source: "org", label: "About" },
    { key: "notes", source: "site", label: "Notes" },
  ],
};
const lincoln = site("lincoln", {
  org: "Lincoln Center", org_id: "o1", address: "234 East 149th Street, Bronx",
  phone: "(212)766-9200 x2224", website: "example.org/lincoln/",
  services: "Meals; Showers; Laundry", notes: "Bring ID.\nArrive early.",
});
const orgs = [{
  org_id: "o1", name: "Lincoln Center", hours: "Mon–Fri 9–5", about: "",
  sites: [{ id: "lincoln", address: "234 East 149th Street, Bronx", lon: -73.95, lat: 40.75 }],
}];
const lincolnModel = () => model(config, [lincoln], orgs, "2026-09-15");

beforeEach(() => {
  window.dataLayer = [];
  vi.spyOn(console, "log").mockImplementation(() => {});
  // jsdom does not navigate; keep link clicks on the page.
  document.addEventListener("click", preventDefault);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  document.removeEventListener("click", preventDefault);
});
function preventDefault(e: Event) { e.preventDefault(); }

describe("Card", () => {
  test("renders configured phone, website, and map actions with correct destinations", () => {
    render(<Card feature={lincoln} model={lincolnModel()} />);
    expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent("Lincoln Center");
    const call = screen.getByRole("link", { name: "Call (212)766-9200 x2224" });
    expect(call).toHaveAttribute("href", "tel:2127669200;ext=2224");
    const website = screen.getByRole("link", { name: /^Website\s*\(opens in a new tab\)$/ });
    expect(website).toHaveAttribute("href", "https://example.org/lincoln/");
    expect(website).toHaveAttribute("target", "_blank");
    expect(website).toHaveAttribute("rel", "noopener");
    const directions = screen.getByRole("link", { name: /^Directions\s*\(opens in a new tab\)$/ });
    expect(directions).toHaveAttribute("href",
      "https://www.google.com/maps/search/?api=1&query=234%20East%20149th%20Street%2C%20Bronx");
    expect(screen.queryByRole("link", { name: /Email/ })).toBeNull();
  });

  test("records analytics when a resident activates an action", () => {
    render(<Card feature={lincoln} model={lincolnModel()} />);
    fireEvent.click(screen.getByRole("link", { name: /^Call/ }));
    fireEvent.click(screen.getByRole("link", { name: /^Website/ }));
    fireEvent.click(screen.getByRole("link", { name: /^Directions/ }));
    expect(window.dataLayer).toEqual([
      { event: "map_action_click", org_id: "o1", site_id: "lincoln", action: "phone" },
      { event: "map_action_click", org_id: "o1", site_id: "lincoln", action: "website" },
      { event: "map_open_in_maps_click", org_id: "o1", site_id: "lincoln" },
    ]);
  });

  test("renders configured detail fields and omits empty values", () => {
    const { container } = render(<Card feature={lincoln} model={lincolnModel()} />);
    const facts = container.querySelector(".card-facts")!;
    expect(within(facts as HTMLElement).getByText("Address").nextSibling)
      .toHaveTextContent("234 East 149th Street, Bronx");
    expect(within(facts as HTMLElement).getByText("Hours").nextSibling)
      .toHaveTextContent("Mon–Fri 9–5");
    expect(screen.queryByText("Fax")).toBeNull();
    expect(screen.getByRole("heading", { name: "Services" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "About" })).toBeNull();
  });

  test("renders structured field content accessibly", () => {
    render(<Card feature={lincoln} model={lincolnModel()} />);
    const services = screen.getByRole("heading", { name: "Services" }).parentElement!;
    expect(within(services).getAllByRole("listitem").map((li) => li.textContent))
      .toEqual(["Meals", "Showers", "Laundry"]);
    const notes = screen.getByRole("heading", { name: "Notes" }).parentElement!;
    expect([...notes.querySelectorAll("p")].map((p) => p.textContent))
      .toEqual(["Bring ID.", "Arrive early."]);
  });

  test("says how far the site is after a search, never less than 0.1 mi", () => {
    const { rerender } = render(
      <Card feature={lincoln} model={lincolnModel()} origin={lincoln.geometry.coordinates as [number, number]} />);
    expect(screen.getByText("0.1 mi away")).toHaveAttribute("aria-hidden", "true");
    expect(screen.getByText("0.1 miles away")).toBeInTheDocument();
    const [lon, lat] = lincoln.geometry.coordinates;
    rerender(<Card feature={lincoln} model={lincolnModel()} origin={[lon, lat - 1609.344 / 111_195]} />);
    expect(screen.getByText("1.0 mi away")).toBeInTheDocument();
  });

  test("dates the card from the data, or from the field config names", () => {
    const { rerender } = render(<Card feature={lincoln} model={lincolnModel()} />);
    expect(screen.getByText("Updated Sep 15, 2026")).toBeInTheDocument();
    const dated = site("dated", { updated: "2026-10-04" });
    rerender(<Card feature={dated}
                   model={model({ ...config, updated: { key: "updated", source: "site" } }, [dated])} />);
    expect(screen.getByText("Updated Oct 4, 2026")).toBeInTheDocument();
  });
});

describe("CopyLink", () => {
  const url = () => new URL("https://example.org/app/?site=lincoln");

  test("uses the label provided by the card", () => {
    render(<CopyLink url={url} payload={{}} label="Share result" />);
    expect(screen.getByRole("button", { name: "Share result" })).toBeInTheDocument();
  });

  test("copies the link and says so, on the button and to a screen reader", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText } });
    render(<CopyLink url={url} payload={{ site_id: "lincoln", via: "card" }} />);
    fireEvent.click(screen.getByRole("button", { name: "Copy link" }));
    await waitFor(() => expect(screen.getByRole("button")).toHaveTextContent("Link copied"));
    expect(screen.getByRole("status")).toHaveTextContent("Link copied");
    expect(writeText).toHaveBeenCalledWith("https://example.org/app/?site=lincoln");
    expect(window.dataLayer).toEqual([{ event: "map_copy_link", site_id: "lincoln", via: "card" }]);
    vi.unstubAllGlobals();
  });

  test("says when the link could not be copied", async () => {
    const writeText = vi.fn().mockRejectedValue(new Error("denied"));
    vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText } });
    render(<CopyLink url={url} payload={{}} />);
    fireEvent.click(screen.getByRole("button", { name: "Copy link" }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Could not copy the link"));
    expect(window.dataLayer).toEqual([]);
    vi.unstubAllGlobals();
  });
});
