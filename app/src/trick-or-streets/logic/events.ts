/**
 * events.ts — NYC DOT's Trick-or-Streets events, as the map reads them.
 *
 * build/trick-or-streets.py writes each event with its kind, its day ("2026-10-31") and its
 * start and end times ("16:00", New York time). Every event starts and ends on its one day.
 */
import type { PinCategories, PinStyle } from "../../core/map-core.ts";
import { formatter, language } from "../../logic/i18n.ts";
import type { Config, Site, SiteProperties } from "../../logic/types.ts";
import { minutesOf } from "../../warming/logic/hours.ts";

/** The fields of an event the app reads, beyond a site's. Any may be missing. */
export interface EventDetails {
  type?: string;
  /** "2026-10-31". */
  date?: string;
  /** "HH:MM", New York time. */
  starts?: string;
  ends?: string;
  /** The partner organizations that run it. */
  host?: string;
}
type EventProperties = SiteProperties & EventDetails;

/** A kind of event: what the list, the card and the filters call it, and its pin. */
export interface EventKind {
  label: string;
  mark: PinStyle;
}

/** A ghost with a wavy hem, two eyes and a round mouth cut out of it. */
const GHOST = "M12 3.5C8 3.5 5.5 6.6 5.5 10.6V19.8Q6.8 21.6 8.1 19.8T10.7 19.8T13.3 19.8"
  + "T15.9 19.8T18.5 19.8V10.6C18.5 6.6 16 3.5 12 3.5Z"
  + "M8.35 10.2a1.25 1.6 0 1 0 2.5 0a1.25 1.6 0 1 0 -2.5 0Z"
  + "M13.15 10.2a1.25 1.6 0 1 0 2.5 0a1.25 1.6 0 1 0 -2.5 0Z"
  + "M10.9 14.2a1.1 1.4 0 1 0 2.2 0a1.1 1.4 0 1 0 -2.2 0Z";

/** A pumpkin with its stem, and a jack-o'-lantern's eyes and toothy grin cut out of it,
 *  so the pin's orange shows through them. */
const JACK_O_LANTERN = "M3.4 14a8.6 6.8 0 1 0 17.2 0a8.6 6.8 0 1 0 -17.2 0Z"
  + "M11.1 6.9Q10.9 4.6 13 3.4L13.9 4.5Q12.6 5.3 12.9 6.9Z"
  + "M6.9 13L8.9 10.2L10.7 13Z"
  + "M13.3 13L15.1 10.2L17.1 13Z"
  + "M6.6 15.4Q12 20.4 17.4 15.4L15.5 16.1L14.6 15.3L13.3 16.5L12 15.6L10.7 16.5L9.4 15.3"
  + "L8.5 16.1Z";

/**
 * The kinds, by the value of an event's `type`, in the order the filters list them. DOT's
 * own map draws its few Signature events as ghosts and every other event as a pumpkin;
 * these pins do the same. Each pin clears 3:1 against the basemap's land (the purple
 * 6.3:1, the orange 3.4:1), and each mark 3:1 against its pin.
 */
export const EVENT_KINDS = new Map<string, EventKind>([
  ["signature", {
    label: "Signature event",
    mark: { color: "#6d28d9", glyph: GHOST, fill: true },
  }],
  ["partner", {
    label: "Partner event",
    mark: { color: "#e2550a", accent: "#2a0f2e", glyph: JACK_O_LANTERN, fill: true },
  }],
]);

/** The site's own mark, before its name in the top bar: the jack-o'-lantern. */
export const SITE_MARK: PinStyle = EVENT_KINDS.get("partner")!.mark;

/** Each kind's pin, for map-core. */
export const EVENT_PINS: PinCategories = {
  field: "type",
  values: Object.fromEntries([...EVENT_KINDS].map(([type, kind]) => [type, kind.mark])),
};

/** What an event's card shows, as the block's config.json would say it (see Card in ui/):
 *  who hosts it, and Directions to the point on its street, since a stretch of street
 *  ("Hillel Place, Kenilworth Place to Flatbush Avenue") is not an address Maps can find.
 *  Its day and times are worked out from `date`, `starts` and `ends` instead (EventCard). */
export const EVENT_CONFIG: Config = {
  openInMaps: { query: [] },
  facts: [{ key: "host", source: "site", label: "Hosted by", icon: "info" }],
};

/** An event's kind. Undefined for a type not listed above. */
export function eventKind(feature: Site): EventKind | undefined {
  const { type } = feature.properties as EventProperties;
  return type === undefined ? undefined : EVENT_KINDS.get(type);
}

/** An event's own fields. */
export function eventDetails(feature: Site): EventDetails {
  return feature.properties as EventProperties;
}

/** Where an event stands: on now, later today, on a day still to come, or over. */
export type EventStatus = "now" | "today" | "upcoming" | "ended";

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** An event's day, "2026-10-31", and its start and end as minutes past midnight. Null
 *  when any of them cannot be read. */
export function eventWhen(feature: Site): { date: string; from: number; to: number } | null {
  const { date, starts, ends } = eventDetails(feature);
  const from = minutesOf(starts);
  const to = minutesOf(ends);
  return date && DAY.test(date) && from !== null && to !== null ? { date, from, to } : null;
}

/** Where an event stands at `minute` past midnight on `today` ("2026-10-29"), New York
 *  time. Null when its day or times cannot be read. */
export function eventStatus(feature: Site, today: string, minute: number): EventStatus | null {
  const when = eventWhen(feature);
  if (!when) return null;
  const { date, from, to } = when;
  if (date < today || (date === today && minute >= to)) return "ended";
  if (date > today) return "upcoming";
  return minute >= from ? "now" : "today";
}

/** `features` in their order, but with the events that are over moved to the end, so the
 *  list opens on what is still to come. */
export function endedLast(features: Site[], today: string, minute: number): Site[] {
  const ended = (f: Site) => eventStatus(f, today, minute) === "ended";
  return [...features.filter((f) => !ended(f)), ...features.filter(ended)];
}

/** Today in New York at `now`, as "2026-10-29", wherever the reader is. */
export function nycDay(now: Date): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)!.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/** "2026-10-31" as "Sat, Oct 31", or with `long` as "Saturday, October 31", as the
 *  language being shown writes a day. */
export function dayName(date: string, long = false): string {
  const [year, month, day] = date.split("-").map(Number);
  return formatter(`day ${language()} ${long ? "long" : "short"}`, () =>
    new Intl.DateTimeFormat(language(), {
      weekday: long ? "long" : "short", month: long ? "long" : "short", day: "numeric",
      timeZone: "UTC",
    })).format(Date.UTC(year, month - 1, day));
}
