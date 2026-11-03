// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { loadLanguage } from "../../logic/i18n.ts";
import { model, site } from "../../test/fixtures.ts";
import { CENTER_CONFIG } from "../logic/centers.ts";
import { CenterCard } from "./CenterCard.tsx";

const bus = site("lincoln-bus", {
  org: "Lincoln Warming Bus", address: "234 East 149th Street, Bronx", type: "bus",
  opens: "22:00", closes: "05:00", pets: true, phone: "(000) 000-0000",
  website: "https://www.nyc.gov/site/em/index.page", instructions: "Knock on the front door.",
  updated: "2026-10-05",
});
const hospital = site("jacobi", {
  org: "NYC Health + Hospitals/Jacobi", address: "1400 Pelham Parkway South, Bronx",
  type: "hospital", opens: "00:00", closes: "24:00", wheelchair: true,
});
const library = site("library", { org: "Library", opens: "09:00", closes: "17:00" });
const centers = model(CENTER_CONFIG, [bus, hospital, library]);

beforeEach(() => {
  // 11 PM in New York.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-01-15T04:00:00Z"));
});
afterEach(async () => {
  cleanup();
  vi.useRealTimers();
  await loadLanguage("en");
});

describe("CenterCard", () => {
  test("says what kind of center it is, and whether it takes wheelchairs and pets", () => {
    const { rerender } = render(<CenterCard feature={bus} model={centers} origin={null} />);
    expect(screen.getByText("Warming bus")).toBeInTheDocument();
    expect(screen.getByText("Pets allowed")).toBeInTheDocument();
    expect(screen.queryByText("Wheelchair accessible")).toBeNull();
    rerender(<CenterCard feature={hospital} model={centers} origin={null} />);
    expect(screen.getByText("Hospital")).toBeInTheDocument();
    expect(screen.getByText("Wheelchair accessible")).toBeInTheDocument();
    expect(screen.queryByText("Pets allowed")).toBeNull();
    rerender(<CenterCard feature={library} model={centers} origin={null} />);
    expect(document.querySelector(".card-meta")).toBeNull();
  });

  test("says whether it is open now, in New York time", () => {
    const { rerender } = render(<CenterCard feature={bus} model={centers} origin={null} />);
    expect(screen.getByText("Open until 5 AM")).toBeInTheDocument();
    rerender(<CenterCard feature={library} model={centers} origin={null} />);
    expect(screen.getByText("Closed")).toBeInTheDocument();
    expect(screen.getByText("Opens at 9 AM")).toBeInTheDocument();
    rerender(<CenterCard feature={hospital} model={centers} origin={null} />);
    expect(screen.getByText("Open 24 hours")).toBeInTheDocument();
  });

  test("works out the hours row from the opening and closing times", () => {
    const { rerender } = render(<CenterCard feature={bus} model={centers} origin={null} />);
    expect(screen.getByText("10 PM – 5 AM, every day")).toBeInTheDocument();
    rerender(<CenterCard feature={hospital} model={centers} origin={null} />);
    expect(screen.getByText("Open 24 hours, 7 days a week")).toBeInTheDocument();
  });

  test("shows the card's configured buttons and fields, and directions to the address", () => {
    render(<CenterCard feature={bus} model={centers} origin={null} />);
    expect(screen.getByRole("link", { name: /^Call/ })).toHaveAttribute("href", "tel:0000000000");
    expect(screen.getByRole("link", { name: /^www\.nyc\.gov/ }))
      .toHaveAttribute("href", "https://www.nyc.gov/site/em/index.page");
    expect(screen.getByRole("heading", { name: "How to get in" })).toBeInTheDocument();
    expect(screen.getByText("Knock on the front door.")).toBeInTheDocument();
    expect(screen.getByText("Updated Oct 5, 2026")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /^Directions/ })).toHaveAttribute("href",
      "https://www.google.com/maps/search/?api=1&query=234%20East%20149th%20Street%2C%20Bronx");
  });

  test("says how to get in in the reader's language, or in English marked as English", async () => {
    const translated = site("library", {
      org: "Library", address: "1 Main Street, Queens",
      instructions: "Check in at the security desk in the lobby. No appointment needed.",
    });
    const both = model(CENTER_CONFIG, [bus, translated]);
    await loadLanguage("es");
    render(<CenterCard feature={translated} model={both} origin={null} />);
    expect(screen.getByRole("heading", { name: "Cómo entrar" })).toBeInTheDocument();
    expect(screen.getByText("Regístrese en el mostrador de seguridad del vestíbulo. No necesita cita.")
      .closest("p")).not.toHaveAttribute("lang");
    cleanup();
    render(<CenterCard feature={bus} model={both} origin={null} />);
    expect(screen.getByText("Knock on the front door.").closest("p")).toHaveAttribute("lang", "en");
  });

  test("shows the name and address as given: English, and not for translating", async () => {
    await loadLanguage("es");
    render(<CenterCard feature={bus} model={centers} origin={null} />);
    for (const el of [screen.getByRole("heading", { level: 2 }), screen.getByText(bus.properties.address)]) {
      expect(el).toHaveAttribute("lang", "en");
      expect(el).toHaveAttribute("translate", "no");
    }
  });
});
