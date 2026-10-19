import { clockTime } from "../logic/hours.ts";
import type { OpenStatus } from "../logic/hours.ts";

/** "Open 24 hours", "Open until 5 AM" or "Closed · Opens at 10 PM", with a check or a
 *  clock beside it so the colour is not the only sign. Each phrase is its own element,
 *  and the time its own, for the translation proxy (see App.tsx in ui/). */
export function OpenStatusLine({ status }: { status: OpenStatus }) {
  const open = status.state !== "closed";
  return (
    <span className={open ? "status open" : "status closed"}>
      {open ? (
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
        {status.state === "always" && <span>Open 24 hours</span>}
        {status.state === "open" && (
          <><span>Open until</span>{" "}<span>{clockTime(status.until)}</span></>
        )}
        {status.state === "closed" && (
          <>
            <span>Closed</span>{" "}<span aria-hidden="true">·</span>{" "}
            <span>Opens at</span>{" "}<span>{clockTime(status.opens)}</span>
          </>
        )}
      </span>
    </span>
  );
}
