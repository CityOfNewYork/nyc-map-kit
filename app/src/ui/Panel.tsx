import { useEffect, useMemo, useRef, useState } from "react";
import type { PointerEvent } from "react";
import { compareSites } from "../logic/data.ts";
import type { Settings } from "../logic/params.ts";
import type { Model, Site } from "../logic/types.ts";

/** The bottom sheet's three heights on a phone; the handle cycles through them in order. */
const SHEET_HEIGHTS = { collapsed: "48px", half: "45dvh", full: "85dvh" };
type SheetStep = keyof typeof SHEET_HEIGHTS;
const NEXT_STEP: Record<SheetStep, SheetStep> =
  { collapsed: "half", half: "full", full: "collapsed" };

interface PanelProps {
  model: Model | null;
  list: Settings["list"];
  selectedId: string | null;
  /** A row was chosen: the button that was pressed, and its site. */
  onOpen: (button: HTMLElement, feature: Site) => void;
}

/**
 * The list of sites: a panel floating over the map on a desktop, a bottom sheet on a phone.
 *
 * The list is a TEXT ALTERNATIVE to the map, not a finder: no search, no filters, no
 * sort. It exists so that everything the map shows is reachable without a pointer and
 * without sight. Focus order is title -> list -> map controls, which is why it sits
 * before the map in the DOM. The card is a modal and takes focus when it opens.
 *
 * `model` is null until the data has loaded; until then the panel shows its frame and
 * nothing in it responds.
 */
export function Panel({ model, list, selectedId, onOpen }: PanelProps) {
  const [step, setStep] = useState<SheetStep>("collapsed");
  const [dragging, setDragging] = useState(false);
  const panelRef = useRef<HTMLElement>(null);
  const drag = useRef<{ y: number; h: number } | null>(null);

  // The sheet's height is a CSS variable on <html>, because the map's own controls read
  // it too, to stay clear of the sheet (see the phone layout in style.css).
  useEffect(() => {
    if (model) document.documentElement.style.setProperty("--sheet-h", SHEET_HEIGHTS[step]);
  }, [model, step]);

  const sites = useMemo(
    () => (model && list !== "off" ? model.features.slice().sort(compareSites) : []),
    [model, list]);

  // Drag, in addition to tap. Pointer events cover mouse, touch and pen with one path.
  // While dragging, the height is set directly on the element rather than through state,
  // so the sheet follows the finger without a render per pointer move.
  function onPointerDown(e: PointerEvent<HTMLButtonElement>) {
    if (!model) return;
    drag.current = { y: e.clientY, h: panelRef.current!.getBoundingClientRect().height };
    e.currentTarget.setPointerCapture(e.pointerId);
    setDragging(true);
  }
  function onPointerMove(e: PointerEvent<HTMLButtonElement>) {
    if (!drag.current) return;
    const h = Math.min(window.innerHeight * 0.9,
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
    const frac = h / window.innerHeight;
    setStep(frac < 0.2 ? "collapsed" : frac < 0.65 ? "half" : "full");
  }

  const orgCount = model ? model.orgs.length : undefined;
  const siteCount = model ? model.features.length : undefined;

  return (
    <nav className={dragging ? "panel dragging" : "panel"} id="panel" ref={panelRef}
         aria-label="Volunteer sites">
      <button className="sheet-handle" id="sheet-handle" type="button"
              aria-expanded={step !== "collapsed"} aria-controls="site-list"
              onClick={() => model && setStep((s) => NEXT_STEP[s])}
              onPointerDown={onPointerDown} onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}>
        {/* Both the singular and the plural noun are rendered and one is hidden. Building
            "1 site" / "2 sites" in code would hand the translation proxy a single text
            node containing a number, and a language whose plural rules are not English's
            cannot be served from it. Two complete alternatives, each its own text node,
            translate correctly on their own. The spaces between the spans are the ones
            the reader sees. */}
        <span className="counts">
          <span id="sheet-orgs">{orgCount}</span>{" "}
          <span hidden={orgCount === 1}>organizations</span>{" "}
          <span hidden={orgCount !== 1}>organization</span>{" "}
          <span aria-hidden="true">·</span>{" "}
          <span id="sheet-sites">{siteCount}</span>{" "}
          <span hidden={siteCount === 1}>sites</span>{" "}
          <span hidden={siteCount !== 1}>site</span>
        </span>
        <span className="chev" aria-hidden="true">{step === "full" ? "▼" : "▲"}</span>
        <span className="visually-hidden">Show the list of sites</span>
      </button>

      <p className="panel-intro">
        <span>Every site on the map. Select one to see the details.</span>
      </p>

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
        the address string, so a row is two lines, not three.

        Sorted north to south, borough by borough — see `compareSites` in logic/data.ts.
      */}
      <ul className="site-list" id="site-list">
        {sites.map((feature) => {
          const p = feature.properties;
          return (
            <li key={p.id}>
              <button type="button" className="site-button" data-site-id={p.id}
                      aria-current={p.id === selectedId ? "true" : undefined}
                      onClick={(e) => onOpen(e.currentTarget, feature)}>
                <span className="name">{p.org}</span>
                <span className="addr">{p.address}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
