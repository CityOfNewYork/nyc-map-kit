/**
 * hours.ts — whether a center is open, from its daily opening and closing times.
 *
 * Each center opens and closes at the same times every day, written "HH:MM" in New York
 * time. A closing time earlier than the opening time runs past midnight: "22:00" to
 * "05:00" is open from 10 PM to 5 AM the next morning. "00:00" to "24:00" is open all day.
 */

import { formatter, language } from "../../logic/i18n.ts";

/** A center's status at one minute of the day. Times are minutes past midnight. */
export type OpenStatus =
  | { state: "always" }
  | { state: "open"; until: number }
  | { state: "closed"; opens: number };

const DAY = 24 * 60;

/** "22:00" as 1320, and "24:00" as 1440. Null for anything that is not a time of day. */
export function minutesOf(time: string | undefined): number | null {
  const match = /^(\d{2}):(\d{2})$/.exec(time ?? "");
  if (!match) return null;
  const minutes = Number(match[1]) * 60 + Number(match[2]);
  return Number(match[2]) < 60 && minutes <= DAY ? minutes : null;
}

/** The status at `minute` past midnight, for a center open from `opens` to `closes`.
 *  Null when either time cannot be read. */
export function statusAt(
  opens: string | undefined, closes: string | undefined, minute: number,
): OpenStatus | null {
  const from = minutesOf(opens);
  const to = minutesOf(closes);
  if (from === null || to === null) return null;
  if (to - from === DAY || from === to) return { state: "always" };
  const open = from < to ? minute >= from && minute < to : minute >= from || minute < to;
  return open ? { state: "open", until: to } : { state: "closed", opens: from };
}

/** Minutes past midnight in New York at `now`, wherever the reader is. */
export function nycMinute(now: Date): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York", hour: "numeric", minute: "numeric", hourCycle: "h23",
  }).formatToParts(now);
  const get = (type: string) => Number(parts.find((p) => p.type === type)!.value);
  return get("hour") * 60 + get("minute");
}

/** 1320 as "10 PM", 1350 as "10:30 PM", 0 and 1440 as "12 AM"; in another language, as
 *  that language writes a time of day. */
export function clockTime(minutes: number): string {
  const hour = Math.floor(minutes / 60) % 24;
  const minute = minutes % 60;
  if (language() !== "en") {
    return formatter(`time ${language()} ${minute ? "h:mm" : "h"}`, () =>
      new Intl.DateTimeFormat(language(), {
        hour: "numeric", minute: minute ? "2-digit" : undefined, timeZone: "UTC",
      })).format(Date.UTC(2000, 0, 1, hour, minute));
  }
  const h12 = hour % 12 === 0 ? 12 : hour % 12;
  return `${h12}${minute ? `:${String(minute).padStart(2, "0")}` : ""} ${hour < 12 ? "AM" : "PM"}`;
}
