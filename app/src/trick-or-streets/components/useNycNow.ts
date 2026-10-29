import { useEffect, useState } from "react";
import { nycMinute } from "../../warming/logic/hours.ts";
import { nycDay } from "../logic/events.ts";

/** The day and the minute of the day in New York. */
export interface NycNow {
  /** "2026-10-31". */
  today: string;
  minute: number;
}

/** How often the time is read again: on the clock's quarter hours. New York is a whole
 *  number of hours from UTC, so these are its quarter hours too. */
const QUARTER_HOUR = 15 * 60_000;
/** A timer can fire a moment early, which would read the minute before the quarter hour. */
const MARGIN = 1_000;

function read(): NycNow {
  const now = new Date();
  return { today: nycDay(now), minute: nycMinute(now) };
}

/**
 * The day and minute in New York, read on load, on every quarter hour, and when the page
 * is shown again (a hidden page's timers can stop). Events start and end on the quarter
 * hour, but for the odd one that ends at 11:59 PM, so a status worked out from it is
 * never out of date, and the list is not redrawn every minute for nothing.
 */
export function useNycNow(): NycNow {
  const [now, setNow] = useState(read);
  useEffect(() => {
    let timer: number;
    const update = () => {
      clearTimeout(timer);
      setNow(read());
      timer = window.setTimeout(update, QUARTER_HOUR - (Date.now() % QUARTER_HOUR) + MARGIN);
    };
    const onShow = () => {
      if (document.visibilityState === "visible") update();
    };
    timer = window.setTimeout(update, QUARTER_HOUR - (Date.now() % QUARTER_HOUR) + MARGIN);
    document.addEventListener("visibilitychange", onShow);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onShow);
    };
  }, []);
  return now;
}
