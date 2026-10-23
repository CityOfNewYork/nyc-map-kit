import { useEffect, useState } from "react";
import { nycMinute } from "../logic/hours.ts";

/** How often the minute is read again: on the clock's half hours, :00 and :30. New York
 *  is a whole number of hours from UTC, so these are its half hours too. */
const HALF_HOUR = 30 * 60_000;
/** A timer can fire a moment early, which would read the minute before the half hour. */
const MARGIN = 1_000;

/**
 * The minute of the day in New York, read on load, on every half hour, and when the page
 * is shown again (a hidden page's timers can stop). Centers open and close on the hour,
 * so a status worked out from it is never out of date, and the list is not redrawn
 * every minute for nothing. Hours that fall between half hours would show the old status
 * until the next one.
 */
export function useNycMinute(): number {
  const [minute, setMinute] = useState(() => nycMinute(new Date()));
  useEffect(() => {
    let timer: number;
    const read = () => {
      clearTimeout(timer);
      setMinute(nycMinute(new Date()));
      timer = window.setTimeout(read, HALF_HOUR - (Date.now() % HALF_HOUR) + MARGIN);
    };
    const onShow = () => {
      if (document.visibilityState === "visible") read();
    };
    timer = window.setTimeout(read, HALF_HOUR - (Date.now() % HALF_HOUR) + MARGIN);
    document.addEventListener("visibilitychange", onShow);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onShow);
    };
  }, []);
  return minute;
}
