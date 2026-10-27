import { useRef, useState } from "react";
import type { FormEvent, KeyboardEvent } from "react";
import { track } from "../logic/analytics.ts";
import { geocode } from "../logic/geocode.ts";
import type { Suggestion } from "../logic/geocode.ts";
import { placeMatcher } from "../logic/places.ts";
import type { Found, PlacesDoc } from "../logic/places.ts";
import { t } from "../logic/i18n.ts";

/** Geoclient's subscription key, from VITE_GEOCLIENT_KEY at build time. Without one the
 *  box still finds boroughs, neighborhoods and ZIP codes, and says that is all it finds. */
const GEOCLIENT_KEY: string = import.meta.env.VITE_GEOCLIENT_KEY || "";

type Status =
  | { type: "idle" }
  | { type: "searching" }
  | { type: "found"; place: Found }
  // `active`: the choice the arrow keys are on, or -1 for none.
  | { type: "choices"; matches: Found[]; active: number }
  | { type: "suggest"; suggestions: Suggestion[]; active: number }
  | { type: "none" }
  | { type: "error" }
  | { type: "locating" }
  | { type: "no-location" };

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
 * a close spelling to suggest, the choices appear under the box.
 *
 * The box and its choices are a combobox (WAI-ARIA APG combobox pattern). Down and Up
 * move through the choices while focus stays in the box, Enter picks one, and Escape
 * closes them and then, pressed again, clears the box. A click or tap picks one too.
 *
 * The status line under the box is a live region, so a screen reader hears "Searching…",
 * the result, or why there is none, without leaving the input. The hint in the empty box
 * is its <label>, laid over the input, not a placeholder: the translation proxy cannot
 * see attribute values (see App.tsx). The label is aria-hidden, so a screen reader moving
 * through the page does not read it a second time as text. The input takes its name from
 * it through aria-labelledby, which reaches hidden text in every browser; a hidden <label>
 * alone does not.
 *
 * Use my location asks the browser where the reader is and treats the answer as a place
 * found, so the list orders itself nearest-first from there. The browser asks the reader's
 * permission first; inside an iframe, the host page has to allow it (allow="geolocation").
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
        settle({ type: "choices", matches: result.matches, active: -1 });
      } else if (result.type === "suggest") {
        settle({ type: "suggest", suggestions: result.suggestions, active: -1 });
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

  /** Use my location: the browser's position as a place found. */
  function locate() {
    inflight.current?.abort();
    if (!navigator.geolocation) {
      settle({ type: "no-location" });
      return;
    }
    setStatus({ type: "locating" });
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setValue("");
        show({
          kind: "location", name: "your location", cross: null, borough: null,
          center: [position.coords.longitude, position.coords.latitude], bbox: null,
        }, "location");
      },
      () => {
        settle({ type: "no-location" });
        track("map_search", { via: "location", result: "error" });
      },
      { timeout: 10_000, maximumAge: 60_000 },
    );
  }

  function clear() {
    inflight.current?.abort();
    setValue("");
    settle({ type: "idle" });
    inputRef.current!.focus();
  }

  // The choices under the box: what each one says, and what picking it does.
  const choices =
    status.type === "choices" ? status.matches.map((m) => ({
      key: `${m.center[0]},${m.center[1]}`,
      label: <PlaceName place={m} />,
      pick: () => choose(m),
    })) :
    status.type === "suggest" ? status.suggestions.map((s) => ({
      key: s.query,
      label: <>
        <span className="place-name"><span>{s.house}</span> <span>{s.street}</span></span>
        <span className="place-boro">{s.borough}</span>
      </>,
      pick: () => retry(s),
    })) :
    [];
  const active = status.type === "choices" || status.type === "suggest" ? status.active : -1;

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (status.type === "choices" || status.type === "suggest") {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        // From the box, Down goes to the first choice and Up to the last; then round.
        const n = choices.length;
        const step = e.key === "ArrowDown" ? 1 : -1;
        const next = active < 0 ? (step > 0 ? 0 : n - 1) : (active + step + n) % n;
        setStatus({ ...status, active: next });
        return;
      }
      if (e.key === "Enter" && active >= 0) {
        e.preventDefault();
        choices[active].pick();
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        settle({ type: "idle" });
        return;
      }
    }
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
               role="combobox" aria-expanded={choices.length > 0}
               aria-controls={choices.length > 0 ? "search-choices" : undefined}
               aria-activedescendant={active >= 0 ? `search-choice-${active}` : undefined}
               aria-labelledby="search-label" aria-describedby="search-status" />
        <label htmlFor="search-input" id="search-label" aria-hidden="true"
               className={value ? "search-label filled" : "search-label"}>
          {GEOCLIENT_KEY
            ? <span>{t("Enter an address or neighborhood")}</span>
            : <span>{t("Neighborhood, borough or ZIP code")}</span>}
        </label>
        {(value || status.type !== "idle") && (
          <button type="button" className="search-clear" onClick={clear}>
            <svg aria-hidden="true" viewBox="0 0 20 20" width="20" height="20">
              <path d="M5 5l10 10M15 5L5 15" stroke="currentColor" strokeWidth="2"
                    strokeLinecap="round" />
            </svg>
            <span className="visually-hidden">{t("Clear the search")}</span>
          </button>
        )}
        <button type="button" className="search-locate" onClick={locate}>
          <svg aria-hidden="true" viewBox="0 0 24 24" width="22" height="22">
            <g fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <circle cx="12" cy="12" r="6.5" />
              <circle cx="12" cy="12" r="2" fill="currentColor" />
              <path d="M12 2v3M12 19v3M2 12h3M19 12h3" />
            </g>
          </svg>
          <span className="visually-hidden">{t("Use my location")}</span>
        </button>
        <button type="submit" className="search-submit">
          <svg aria-hidden="true" viewBox="0 0 20 20" width="22" height="22">
            <circle cx="8.5" cy="8.5" r="5.5" fill="none" stroke="currentColor" strokeWidth="2.2" />
            <path d="M13 13l4 4" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
          </svg>
          <span className="visually-hidden">{t("Search")}</span>
        </button>
      </div>

      {/* What opens under the box, in one piece, so a page can float it over what is below
          (see warming.css). */}
      <div className="search-drop">
        <div className="search-status" id="search-status" role="status">
          <StatusLine status={status} />
        </div>

        {choices.length > 0 && (
          <ul className="search-choices" id="search-choices" role="listbox"
              aria-labelledby="search-status">
            {choices.map((c, i) => (
              <li key={c.key} id={`search-choice-${i}`} className="search-choice" role="option"
                  aria-selected={i === active} onClick={c.pick}>
                {c.label}
              </li>
            ))}
          </ul>
        )}
      </div>
    </form>
  );
}

/** What the live region says. Every string in its own element (see App.tsx). */
function StatusLine({ status }: { status: Status }) {
  switch (status.type) {
    case "idle":
      return null;
    case "searching":
      return <p><span>{t("Searching…")}</span></p>;
    case "found":
      return (
        <p className="search-found">
          <span>{t("Closest to")}</span>{" "}
          <PlaceName place={status.place} inline />
        </p>
      );
    case "choices":
      return <p><span>{t("Which one do you mean?")}</span></p>;
    case "suggest":
      return <p><span>{t("Did you mean:")}</span></p>;
    case "none":
      return (
        <p>
          <span>{t("No match in New York City.")}</span>{" "}
          {GEOCLIENT_KEY
            ? <span>{t("Try an address, an intersection, a neighborhood or a ZIP code.")}</span>
            : <span>{t("Try a neighborhood, a borough or a ZIP code.")}</span>}
        </p>
      );
    case "error":
      return (
        <p>
          <span>{t("Address search is not working right now.")}</span>{" "}
          <span>{t("Try a neighborhood, a borough or a ZIP code.")}</span>
        </p>
      );
    case "locating":
      return <p><span>{t("Finding your location…")}</span></p>;
    case "no-location":
      return (
        <p>
          <span>{t("We couldn't get your location.")}</span>{" "}
          <span>{t("Try typing an address instead.")}</span>
        </p>
      );
  }
}

/** A found place's name, each part its own element: "ZIP code" next to "10027", "and"
 *  between an intersection's streets, the borough after a comma. */
export function PlaceName({ place, inline = false }: { place: Found; inline?: boolean }) {
  const name = place.kind === "zip" ? (
    <span className="place-name"><span>{t("ZIP code")}</span> <span>{place.name}</span></span>
  ) : place.kind === "intersection" ? (
    <span className="place-name">
      <span>{place.name}</span> <span>{t("and")}</span> <span>{place.cross}</span>
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
