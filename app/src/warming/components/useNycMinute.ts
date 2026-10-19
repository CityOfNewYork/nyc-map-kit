import { useEffect, useState } from "react";
import { nycMinute } from "../logic/hours.ts";

/** The minute of the day in New York, changing as each minute starts. */
export function useNycMinute(): number {
  const [minute, setMinute] = useState(() => nycMinute(new Date()));
  useEffect(() => {
    let timer: number;
    const tick = () => {
      setMinute(nycMinute(new Date()));
      timer = window.setTimeout(tick, 60_000 - (Date.now() % 60_000));
    };
    timer = window.setTimeout(tick, 60_000 - (Date.now() % 60_000));
    return () => clearTimeout(timer);
  }, []);
  return minute;
}
