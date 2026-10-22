import { useEffect, useMemo, useRef, useState } from "react";
import type { PointerEvent, ReactNode } from "react";
import { compareSites, metresBetween } from "../logic/data.ts";
import { number, t } from "../logic/i18n.ts";
import type { Settings } from "../logic/params.ts";
import type { Found } from "../logic/places.ts";
import type { Model, Site } from "../logic/types.ts";
import { PlaceName } from "./Search.tsx";

const METRES_PER_MILE = 1609.344;

/** The bottom sheet's two heights on a phone; the handle switches between them. At its
 *  tallest the sheet stays lower than the card that opens over it as a panel (style.css). */
const SHEET_HEIGHTS = { collapsed: "48px", half: "45dvh" };
type SheetStep = keyof typeof SHEET_HEIGHTS;
const NEXT_STEP: Record<SheetStep, SheetStep> = { collapsed: "half", half: "collapsed" };
/** Wider than this the list is a panel, not a sheet (see style.css). */
const DESKTOP = "(min-width: 768px)";

interface PanelProps {
  model: Model | null;
  list: Settings["list"];
  selectedId: string | null;
  /** The place the search box found, or null. The list is ordered nearest-first from it,
   *  and says so under the count. */
  found: Found | null;
  /** Clears the filters; given while any are on. With no site left, the list says so and
   *  offers this. */
  onClearFilters?: () => void;
  /** A row was chosen: the button that was pressed, and its site. */
  onOpen: (button: HTMLElement, feature: Site) => void;
  /** The list's name to a screen reader: "Volunteer sites". */
  label: string;
  /** What the phone sheet's handle says about the list, such as how many sites it holds. */
  summary: ReactNode;
  /** A control on the handle's line, between the summary and the chevron, such as Copy
   *  link. Nothing unless given; hidden while the list is shut. */
  action?: ReactNode;
  /** A row's lines above the distance. The site's name and address unless given. */
  row?: (feature: Site) => ReactNode;
  /** Shown above the rows and kept in view, before the place found, such as a count of
   *  the sites. Nothing unless given. */
  header?: ReactNode;
  /** Shown at the top of the rows and scrolled away with them, such as a notice. Nothing
   *  unless given. */
  intro?: ReactNode;
  /** A mark before a row's lines, such as an icon of the site's kind. None unless given. */
  marker?: (feature: Site) => ReactNode;
}

/**
 * The list of sites: a panel floating over the map on a desktop, a bottom sheet on a phone.
 *
 * The list is a TEXT ALTERNATIVE to the map, not a finder: it holds every site the map
 * draws, and an app that filters the map filters this list the same way. It exists so
 * that everything the map shows is reachable without a pointer and without sight. After
 * a search (ui/Search.tsx) it is ordered nearest-first from the place found, with each
 * site's distance; otherwise north to south. Focus order is title -> search -> list ->
 * map controls, which is why it sits before the map in the DOM. The card is a modal and
 * takes focus when it opens.
 *
 * `model` is null until the data has loaded; until then the panel shows its frame and
 * nothing in it responds.
 */
export function Panel({
  model, list, selectedId, found, onClearFilters, onOpen, label, summary, action, row, header,
  intro, marker,
}: PanelProps) {
  const origin = found && found.center;
  const empty = model && onClearFilters && model.features.length === 0;
  const [step, setStep] = useState<SheetStep>("collapsed");
  const [dragging, setDragging] = useState(false);
  // On a desktop the handle is the panel's top line, and hides the list under it; the
  // panel then shrinks to a box that says "Show list". On a phone it steps the sheet's
  // height.
  const [desktop, setDesktop] = useState(() => matchMedia(DESKTOP).matches);
  const [shut, setShut] = useState(false);
  useEffect(() => {
    const query = matchMedia(DESKTOP);
    const onChange = () => setDesktop(query.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);
  const panelRef = useRef<HTMLElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ y: number; h: number } | null>(null);

  // The sheet's height is a CSS variable on <html>, because the map's own controls read
  // it too, to stay clear of the sheet (see the phone layout in style.css).
  useEffect(() => {
    if (model) document.documentElement.style.setProperty("--sheet-h", SHEET_HEIGHTS[step]);
  }, [model, step]);

  const sites = useMemo(() => {
    if (!model || list === "off") return [];
    const rows = model.features.map((feature) => ({
      feature,
      metres: origin ? metresBetween(origin, feature.geometry.coordinates) : null,
    }));
    return rows.sort((a, b) =>
      (a.metres ?? 0) - (b.metres ?? 0) || compareSites(a.feature, b.feature));
  }, [model, list, origin]);

  // A new order starts at the top, where the nearest site now is.
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
  }, [origin]);

  // Drag, in addition to tap. Pointer events cover mouse, touch and pen with one path.
  // While dragging, the height is set directly on the element rather than through state,
  // so the sheet follows the finger without a render per pointer move.
  function onPointerDown(e: PointerEvent<HTMLButtonElement>) {
    if (!model || desktop) return;
    drag.current = { y: e.clientY, h: panelRef.current!.getBoundingClientRect().height };
    e.currentTarget.setPointerCapture(e.pointerId);
    setDragging(true);
  }
  function onPointerMove(e: PointerEvent<HTMLButtonElement>) {
    if (!drag.current) return;
    const h = Math.min(window.innerHeight * 0.45,
                       Math.max(48, drag.current.h + (drag.current.y - e.clientY)));
    panelRef.current!.style.height = `${h}px`;
  }
  function onPointerUp(e: PointerEvent<HTMLButtonElement>) {
    if (!drag.current) return;
    const moved = Math.abs(e.clientY - drag.current.y);
    const h = panelRef.current!.getBoundingClientRect().height;
    drag.current = null;
    setDragging(false);
    panelRef.current!.style.height = "";
    if (moved < 8) return;                       // a tap; the click handler owns it
    setStep(h / window.innerHeight < 0.2 ? "collapsed" : "half");
  }

  // A collapsed sheet's rows are below the screen's edge: out of the tab order, and out of
  // a screen reader's reach, until the handle opens it.
  const hidden = !desktop && step === "collapsed";

  return (
    <nav className={["panel", dragging && "dragging", desktop && shut && "shut"]
                      .filter(Boolean).join(" ")}
         id="panel" ref={panelRef} aria-label={label}>
      {/* The handle spans the line; an app's control sits over it, a button of its own
          rather than one inside the handle (see .panel-top in style.css). */}
      <div className="panel-top">
        <button className="sheet-handle" id="sheet-handle" type="button"
                aria-expanded={desktop ? !shut : step !== "collapsed"} aria-controls="site-list"
                onClick={() => model && (desktop
                  ? setShut((s) => !s) : setStep((s) => NEXT_STEP[s]))}
                onPointerDown={onPointerDown} onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}>
          {desktop && shut ? (
            <>
              <span className="chev" aria-hidden="true">▶</span>
              <span className="counts">{t("Show list")}</span>
            </>
          ) : (
            <>
              <span className="counts">{summary}</span>
              <span className="chev" aria-hidden="true">{step === "half" ? "▼" : "▲"}</span>
              <span className="visually-hidden">{t("Show or hide the list")}</span>
            </>
          )}
        </button>
        {action && !(desktop && shut) && <div className="panel-action">{action}</div>}
      </div>

      {/* Under the count, on a desktop: that no site matches the filters, and after a
          search, the place the rows are ordered from. The place line stands in for the
          search box's own (see style.css), so it is a live region too, and a screen reader
          hears it without leaving the input. */}
      <div className="list-head" inert={hidden}>
        {header}
        {empty && (
          <p className="list-empty">
            <span>{t("No locations match your filters.")}</span>{" "}
            <button type="button" className="filters-clear" onClick={onClearFilters}>
              <span>{t("Clear filters")}</span>
            </button>
          </p>
        )}
        <div className="list-closest" role="status">
          {found && <p><span>{t("Closest to")}</span>{" "}<PlaceName place={found} inline /></p>}
        </div>
      </div>

      {/*
        One row per site. Not per organization.

        The list used to be organizations, with the multi-site ones expanding to reveal
        their sites. That made a row mean two different things depending on which
        organization it named — "Aempowerments Global Foundation Inc." opened a card, "A
        Blend of Services · 2 sites" expanded a sublist — and the only tells were a blank
        chevron and a missing count, both of which are absences rather than signals.

        Flat is the version with nothing to learn: every row is one site and opens one
        card, the same card the pin opens. The cost is 60 consecutive rows reading "Acacia
        Housing and Preservation", which is why the address is a second line rather than a
        tooltip — it is what makes each row its own place. The borough is already inside
        the address string, so a row is two lines, not three. An app can give its rows
        other lines through `row`; the distance always comes last.

        Sorted north to south, borough by borough — see `compareSites` in logic/data.ts —
        or, after a search, nearest first. The distance is straight-line, in its own
        elements: the number, then "mi" for the eye and "miles" for a screen reader, then
        "away".
      */}
      <div className="site-scroll" ref={scrollRef} inert={hidden}>
        {intro && <div className="list-intro">{intro}</div>}
        <ul className="site-list" id="site-list">
          {sites.map(({ feature, metres }) => {
            const p = feature.properties;
            const lines = (
              <>
                {row ? row(feature) : (
                  <>
                    <span className="name">{p.org}</span>
                    <span className="addr">{p.address}</span>
                  </>
                )}
                {metres != null && (
                  <span className="dist">
                    <span aria-hidden="true">{t("{miles} mi away", { miles: miles(metres) })}</span>
                    <span className="visually-hidden">
                      {t("{miles} miles away", { miles: miles(metres) })}
                    </span>
                  </span>
                )}
              </>
            );
            return (
              <li key={p.id}>
                <button type="button" className={marker ? "site-button marked" : "site-button"}
                        data-site-id={p.id}
                        aria-current={p.id === selectedId ? "true" : undefined}
                        onClick={(e) => onOpen(e.currentTarget, feature)}>
                  {marker ? (
                    <>
                      <span className="site-marker">{marker(feature)}</span>
                      <span className="site-lines">{lines}</span>
                    </>
                  ) : lines}
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </nav>
  );
}

/** One decimal place; never "0.0", which would read as "here". */
function miles(metres: number): string {
  return number(Math.max(0.1, metres / METRES_PER_MILE), 1);
}
