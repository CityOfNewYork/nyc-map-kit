// @vitest-environment jsdom

import { afterEach, describe, expect, test } from "vitest";
import { loadLanguage } from "../../logic/i18n.ts";
import { site } from "../../test/fixtures.ts";
import {
  EVENT_KINDS, KIND_PINS, dayName, endedLast, eventKind, eventStatus, nycDay, withPins,
} from "./events.ts";

/** An event on Saturday, October 31, from 4 PM to 8 PM unless `details` say otherwise. */
const event = (id: string, details: Record<string, string> = {}) =>
  site(id, { type: "partner", date: "2026-10-31", starts: "16:00", ends: "20:00", ...details });

const FOUR_PM = 16 * 60;
const EIGHT_PM = 20 * 60;

describe("eventStatus", () => {
  test("a day still to come is upcoming, whatever the time", () => {
    expect(eventStatus(event("a"), "2026-10-30", EIGHT_PM)).toBe("upcoming");
  });
  test("on its day: later today before it starts, now from its start, ended at its end", () => {
    expect(eventStatus(event("a"), "2026-10-31", FOUR_PM - 1)).toBe("today");
    expect(eventStatus(event("a"), "2026-10-31", FOUR_PM)).toBe("now");
    expect(eventStatus(event("a"), "2026-10-31", EIGHT_PM - 1)).toBe("now");
    expect(eventStatus(event("a"), "2026-10-31", EIGHT_PM)).toBe("ended");
  });
  test("a day gone by is ended", () => {
    expect(eventStatus(event("a"), "2026-11-01", 0)).toBe("ended");
  });
  test("null when the day or a time cannot be read", () => {
    expect(eventStatus(event("a", { date: "Oct 31" }), "2026-10-31", FOUR_PM)).toBeNull();
    expect(eventStatus(event("a", { starts: "4 PM" }), "2026-10-31", FOUR_PM)).toBeNull();
    expect(eventStatus(site("b"), "2026-10-31", FOUR_PM)).toBeNull();
  });
});

describe("endedLast", () => {
  test("keeps the order, with the events that are over moved to the end", () => {
    const events = [
      event("early", { date: "2026-10-03" }),
      event("now"),
      event("morning", { starts: "09:00", ends: "12:00" }),
      event("tomorrow", { date: "2026-11-01" }),
    ];
    expect(endedLast(events, "2026-10-31", FOUR_PM).map((f) => f.properties.id))
      .toEqual(["now", "tomorrow", "early", "morning"]);
  });
});

describe("nycDay", () => {
  test("is New York's day, not the reader's or UTC's", () => {
    // 2 AM UTC on November 1 is still 10 PM on October 31 in New York.
    expect(nycDay(new Date("2026-11-01T02:00:00Z"))).toBe("2026-10-31");
    expect(nycDay(new Date("2026-11-01T05:00:00Z"))).toBe("2026-11-01");
  });
});

describe("dayName", () => {
  afterEach(() => loadLanguage("en"));
  test("short and long, as the language writes a day", async () => {
    expect(dayName("2026-10-31")).toBe("Sat, Oct 31");
    expect(dayName("2026-10-31", true)).toBe("Saturday, October 31");
    await loadLanguage("es");
    expect(dayName("2026-10-31", true)).toBe("sábado, 31 de octubre");
  });
});

describe("kinds", () => {
  test("each kind has a pin for the map, keyed by its type", () => {
    expect(KIND_PINS.field).toBe("type");
    expect(Object.keys(KIND_PINS.values)).toEqual([...EVENT_KINDS.keys()]);
  });
  test("an event that is over takes its kind's grey pin", () => {
    const events = [event("over", { date: "2026-10-03" }), event("tomorrow", { date: "2026-11-01" })];
    expect(withPins(events, "2026-10-31", FOUR_PM).map((f) => (f.properties as { pin?: string }).pin))
      .toEqual(["partner-past", "partner"]);
  });
  test("eventKind reads the type, and is undefined for any other", () => {
    expect(eventKind(event("a", { type: "signature" }))?.label).toBe("Signature event");
    expect(eventKind(event("a", { type: "parade" }))).toBeUndefined();
    expect(eventKind(site("b"))).toBeUndefined();
  });
});
