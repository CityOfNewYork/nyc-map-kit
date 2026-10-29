import type { Site } from "../../logic/types.ts";
import { Pause } from "../../ui/Pause.tsx";
import { clockTime } from "../../warming/logic/hours.ts";
import { dayName, eventStatus, eventWhen } from "../logic/events.ts";
import type { NycNow } from "./useNycNow.ts";
import { t } from "../../logic/i18n.ts";

/** "Happening now · 4 PM – 8 PM", "Today · 4 PM – 8 PM", "Sat, Oct 31 · 4 PM – 8 PM" or
 *  "Ended · Sat, Oct 3", with a check beside what is on now and a clock beside the rest,
 *  so the colour is not the only sign. Nothing when the event's day or times cannot be
 *  read. Each phrase is its own element, the day and times as its language writes them
 *  (see logic/i18n.ts). */
export function EventStatusLine({ feature, now }: { feature: Site; now: NycNow }) {
  const when = eventWhen(feature);
  const status = eventStatus(feature, now.today, now.minute);
  if (!when || !status) return null;
  const times = t("{from} – {to}", { from: clockTime(when.from), to: clockTime(when.to) });
  return (
    <span className={`status ${status}`}>
      {status === "now" ? (
        <svg aria-hidden="true" viewBox="0 0 16 16" width="16" height="16">
          <path d="M3 8.5l3.2 3L13 4.5" fill="none" stroke="currentColor" strokeWidth="2"
                strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      ) : (
        <svg aria-hidden="true" viewBox="0 0 16 16" width="16" height="16">
          <circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" strokeWidth="1.8" />
          <path d="M8 4.8V8l2.2 1.6" fill="none" stroke="currentColor" strokeWidth="1.8"
                strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )}
      <span>
        {status === "now" && <span>{t("Happening now")}</span>}
        {status === "today" && <span>{t("Today")}</span>}
        {status === "upcoming" && <span>{dayName(when.date)}</span>}
        {status === "ended" && <span>{t("Ended")}</span>}
        <Pause />{" "}<span aria-hidden="true">·</span>{" "}
        <span>{status === "ended" ? dayName(when.date) : times}</span>
      </span>
    </span>
  );
}
