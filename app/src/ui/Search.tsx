import { useRef, useState } from "react";
import type { FormEvent, KeyboardEvent } from "react";
import { track } from "../logic/analytics.ts";
import { geocode } from "../logic/geocode.ts";
import type { Suggestion } from "../logic/geocode.ts";
import { placeMatcher } from "../logic/places.ts";
import type { Found, PlacesDoc } from "../logic/places.ts";

/** Geoclient's subscription key, from VITE_GEOCLIENT_KEY at build time. Without one the
 *  box still finds boroughs, neighborhoods and ZIP codes, and says that is all it finds. */
const GEOCLIENT_KEY: string = import.meta.env.VITE_GEOCLIENT_KEY || "";

type Status =
  | { type: "idle" }
  | { type: "searching" }
  | { type: "found"; place: Found }
  | { type: "choices"; matches: Found[] }
  | { type: "suggest"; suggestions: Suggestion[] }
  | { type: "none" }
  | { type: "error" };

interface SearchProps {
  /** A place was found, or chosen from several. */
  onFound: (place: Found) => void;
  /** The search was cleared. */
  onClear: () => void;
}

/**
 * The search box: a neighborhood, an address, an intersection or a landmark, and the map
 * goes there.
 *
 * It searches on Enter and not while typing. Boroughs, neighborhoods and ZIP codes are
 * matched in the page from places.json (logic/places.ts); anything else goes to Geoclient
 * (logic/geocode.ts). When Geoclient finds the address in more than one borough, or has
 * a close spelling to suggest, the choices appear under the box as buttons.
 *
 * The status line under the box is a live region, so a screen reader hears "Searching…",
 * the result, or why there is none, without leaving the input. The hint in the empty box
 * is its <label>, laid over the input, not a placeholder: the translation proxy cannot
 * see attribute values (see App.tsx).
 *
 * The search never hides a site. App re-orders the list nearest-first and frames the map.
 */
export function Search({ onFound, onClear }: SearchProps) {
  const [value, setValue] = useState("");
  const [status, setStatus] = useState<Status>({ type: "idle" });
  const inputRef = useRef<HTMLInputElement>(null);
  const places = useRef<Promise<((q: string) => Found | null) | null>>(null);
  const inflight = useRef<AbortController>(null);
  const showing = useRef(false);   // the map and list are showing a result

  /** places.json, fetched once, on first focus. */
  function loadPlaces() {
    places.current ??= fetch("places.json")
      .then((r) => (r.ok ? r.json() as Promise<PlacesDoc> : null))
      .then((doc) => (doc ? placeMatcher(doc) : null))
      .catch(() => null);
    return places.current;
  }

  function show(place: Found, via: string) {
    showing.current = true;
    setStatus({ type: "found", place });
    onFound(place);
    track("map_search", { via, result: place.kind });
  }

  /** Any outcome but a place: the previous place goes too, so the list is never left
   *  ordered from somewhere the status line no longer names. */
  function settle(next: Status) {
    if (showing.current) {
      showing.current = false;
      onClear();
    }
    setStatus(next);
  }

  async function search(query: string, via: string) {
    inflight.current?.abort();
    const controller = new AbortController();
    inflight.current = controller;
    setStatus({ type: "searching" });

    const match = await loadPlaces();
    if (controller.signal.aborted) return;
    const place = match && match(query);
    if (place) return show(place, via);
    if (!GEOCLIENT_KEY) {
      settle({ type: "none" });
      track("map_search", { via, result: "none" });
      return;
    }

    try {
      const result = await geocode(query, GEOCLIENT_KEY, controller.signal);
      if (controller.signal.aborted) return;
      if (result.type === "found" && result.matches.length === 1) {
        return show(result.matches[0], via);
      }
      if (result.type === "found") {
        settle({ type: "choices", matches: result.matches });
      } else if (result.type === "suggest") {
        settle({ type: "suggest", suggestions: result.suggestions });
      } else {
        settle({ type: "none" });
      }
      track("map_search", { via, result: result.type === "found" ? "choices" : result.type });
    } catch (err) {
      if (controller.signal.aborted) return;
      console.warn(`[search] ${(err as Error).message}`);
      settle({ type: "error" });
      track("map_search", { via, result: "error" });
    }
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    const query = value.trim();
    if (query) search(query, "search");
  }

  function choose(place: Found) {
    setValue(plainName(place));
    show(place, "choice");
    inputRef.current!.focus();
  }

  function retry(s: Suggestion) {
    setValue(s.query);
    search(s.query, "suggestion");
    inputRef.current!.focus();
  }

  function clear() {
    inflight.current?.abort();
    setValue("");
    settle({ type: "idle" });
    inputRef.current!.focus();
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Escape" && (value || status.type !== "idle")) {
      e.preventDefault();
      clear();
    }
  }

  return (
    <form className="search" id="search" role="search" onSubmit={onSubmit}>
      <div className="search-bar">
        <input ref={inputRef} className="search-input" id="search-input" type="text"
               value={value} onChange={(e) => setValue(e.target.value)}
               onFocus={loadPlaces} onKeyDown={onKeyDown}
               autoComplete="off" autoCapitalize="off" enterKeyHint="search"
               aria-describedby="search-status" />
        <label htmlFor="search-input" className={value ? "search-label filled" : "search-label"}>
          {GEOCLIENT_KEY
            ? <span>Address, neighborhood or ZIP code</span>
            : <span>Neighborhood, borough or ZIP code</span>}
        </label>
        {(value || status.type !== "idle") && (
          <button type="button" className="search-clear" onClick={clear}>
            <svg aria-hidden="true" viewBox="0 0 20 20" width="20" height="20">
              <path d="M5 5l10 10M15 5L5 15" stroke="currentColor" strokeWidth="2"
                    strokeLinecap="round" />
            </svg>
            <span className="visually-hidden">Clear the search</span>
          </button>
        )}
        <button type="submit" className="search-submit">
          <svg aria-hidden="true" viewBox="0 0 20 20" width="22" height="22">
            <circle cx="8.5" cy="8.5" r="5.5" fill="none" stroke="currentColor" strokeWidth="2.2" />
            <path d="M13 13l4 4" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
          </svg>
          <span className="visually-hidden">Search</span>
        </button>
      </div>

      <div className="search-status" id="search-status" role="status">
        <StatusLine status={status} />
      </div>

      {status.type === "choices" && (
        <ul className="search-choices" id="search-choices">
          {status.matches.map((m) => (
            <li key={`${m.center[0]},${m.center[1]}`}>
              <button type="button" className="search-choice" onClick={() => choose(m)}>
                <PlaceName place={m} />
              </button>
            </li>
          ))}
        </ul>
      )}
      {status.type === "suggest" && (
        <ul className="search-choices" id="search-choices">
          {status.suggestions.map((s) => (
            <li key={s.query}>
              <button type="button" className="search-choice" onClick={() => retry(s)}>
                <span className="place-name">
                  <span>{s.house}</span> <span>{s.street}</span>
                </span>
                <span className="place-boro">{s.borough}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </form>
  );
}

/** What the live region says. Every string in its own element (see App.tsx). */
function StatusLine({ status }: { status: Status }) {
  switch (status.type) {
    case "idle":
      return null;
    case "searching":
      return <p><span>Searching…</span></p>;
    case "found":
      return (
        <p className="search-found">
          <span>Sites nearest</span>{" "}
          <PlaceName place={status.place} inline />
        </p>
      );
    case "choices":
      return <p><span>Which one do you mean?</span></p>;
    case "suggest":
      return <p><span>Did you mean:</span></p>;
    case "none":
      return (
        <p>
          <span>No match in New York City.</span>{" "}
          {GEOCLIENT_KEY
            ? <span>Try an address, an intersection, a neighborhood or a ZIP code.</span>
            : <span>Try a neighborhood, a borough or a ZIP code.</span>}
        </p>
      );
    case "error":
      return (
        <p>
          <span>Address search is not working right now.</span>{" "}
          <span>Try a neighborhood, a borough or a ZIP code.</span>
        </p>
      );
  }
}

/** A found place's name, each part its own element: "ZIP code" next to "10027", "and"
 *  between an intersection's streets, the borough after a comma. */
function PlaceName({ place, inline = false }: { place: Found; inline?: boolean }) {
  const name = place.kind === "zip" ? (
    <span className="place-name"><span>ZIP code</span> <span>{place.name}</span></span>
  ) : place.kind === "intersection" ? (
    <span className="place-name">
      <span>{place.name}</span> <span>and</span> <span>{place.cross}</span>
    </span>
  ) : (
    <span className="place-name"><span>{place.name}</span></span>
  );
  if (!place.borough) return name;
  return inline ? (
    <>{name}, <span className="place-boro">{place.borough}</span></>
  ) : (
    <>{name}<span className="place-boro">{place.borough}</span></>
  );
}

/** The place as one line of text for the input, which holds a value, not markup. */
function plainName(place: Found): string {
  const name = place.kind === "intersection" ? `${place.name} & ${place.cross}` : place.name;
  return place.borough ? `${name}, ${place.borough}` : name;
}
