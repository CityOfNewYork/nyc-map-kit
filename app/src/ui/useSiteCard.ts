/**
 * useSiteCard.ts — one site's card: what is selected, the modal it opens in, its address,
 * focus, and the small map at its top. An app hands map-core's onSelect to `onSelect` and
 * renders <SiteDialog> with what this returns.
 *
 *   const card = useSiteCard({ model, style });
 *   const map = createMap(el, { ..., onSelect: card.onSelect });
 *   card.attach(map);                    // from the effect that made the map
 *   <Panel onOpen={card.openFromList} ... />
 *   <SiteDialog ref={card.dialogElement} miniMapElement={card.miniMapElement}
 *               feature={card.feature}
 *               group={card.group} onStep={card.step} onClose={card.close} ... />
 *
 * Opening a card from the map or the list adds a history entry with ?site=<id>, so the
 * card has an address that can be shared, and the browser's Back button — the one a
 * phone user reaches for — closes the card instead of leaving the page. Every way of
 * closing it (the × button, Escape, a click on the blurred map) goes back through that
 * same entry, so the history never collects a trail of closed cards.
 *
 * Moving between cards while one is open (the stepper, or a pin on the small map)
 * replaces the entry instead of adding one: Back closes the card, whichever site it has
 * reached, rather than stepping back through each one.
 *
 * Inside an iframe the address that changes is the frame's, not the host page's, so the
 * link is the frame's own address with ?site=<id>. Back still works, because the browser
 * keeps one history for the page and its frames.
 */
import { useCallback, useEffect, useEffectEvent, useLayoutEffect, useRef, useState } from "react";
import type { StyleSpecification } from "maplibre-gl";
import { createMap } from "../core/map-core.ts";
import type { MapCore, PinCategories, SelectInfo } from "../core/map-core.ts";
import { track } from "../logic/analytics.ts";
import { coincidentWith } from "../logic/data.ts";
import type { Model, Site, SiteProperties } from "../logic/types.ts";
import type { StepDirection } from "./SiteDialog.tsx";
import { t } from "../logic/i18n.ts";

/** Street level, a little closer than the main map's: the card's map answers "where is
 *  this" for one place, not "what is near me". */
const MINI_MAP_ZOOM = 15.5;

interface SiteCardOptions {
  /** null until the data has loaded. */
  model: Model | null;
  /** The basemap, for the card's small map. null until it has loaded. */
  style: StyleSpecification | null;
  /** The main map's pin categories, so the small map's pins match. */
  categories?: PinCategories | null;
  /** Open the card as a panel beside the list, with the map still in use and no small
   *  map of its own, rather than as a modal. */
  panel?: boolean;
}

export function useSiteCard({ model, style, categories = null, panel = false }: SiteCardOptions) {
  // The site whose card is open. `seq` counts selections, so selecting a site again (Back
  // to it, say) still runs the effect that opens and focuses the card.
  const [selection, setSelection] = useState<{ feature: Site | null; seq: number }>(
    { feature: null, seq: 0 });
  const dialogRef = useRef<HTMLDialogElement>(null);
  const miniContainer = useRef<HTMLDivElement>(null);
  const miniMapRef = useRef<MapCore<SiteProperties>>(null);   // the card's map; made on first open

  // Bookkeeping that event handlers read and write but nothing renders: refs, not state.
  const selectedId = useRef<string | null>(null);   // what map-core has selected, readable at once
  const stepFocus = useRef<StepDirection | null>(null);  // while a stepper click is in flight
  const returnFocusTo = useRef<HTMLElement | null>(null);  // the control that opened the card
  const pushed = useRef(false);        // the open card has a history entry of its own
  const urlDriven = useRef(false);     // the URL, not the reader, chose the site
  const mainMapRef = useRef<MapCore<SiteProperties> | null>(null);   // see attach
  const mainMap = () => mainMapRef.current;

  /** The main map, once the app has made it, or null when it is gone. Call it from the
   *  effect that makes the map. */
  const attach = useCallback((map: MapCore<SiteProperties> | null) => {
    mainMapRef.current = map;
  }, []);

  // The dialog and the small map's <div>, as React renders them (see SiteDialog).
  const dialogElement = useCallback((el: HTMLDialogElement | null) => {
    dialogRef.current = el;
  }, []);
  const miniMapElement = useCallback((el: HTMLDivElement | null) => {
    miniContainer.current = el;
  }, []);

  useEffect(() => () => {
    miniMapRef.current?.destroy();
    miniMapRef.current = null;
  }, []);

  // Everything below runs only once the data has loaded and the main map exists: a
  // selection, a step and a close all start from that map. So these handlers assert
  // `model`, `style`, the dialog and the main map with `!` rather than checking for them.

  /** map-core's onSelect: the one place a selection lands, however it was made. */
  function onSelect(feature: Site | null, info: SelectInfo) {
    if (!feature) {
      selectedId.current = null;
      setSelection((s) => (s.feature ? { feature: null, seq: s.seq } : s));
      return;
    }
    const p = feature.properties;
    selectedId.current = p.id;
    recordInUrl(p.id);
    setSelection((s) => ({ feature, seq: s.seq + 1 }));
    announceSelected(mainMap(), p);
    if (info.via === "map") {
      returnFocusTo.current = null;
      track("map_pin_open", { org_id: p.org_id, site_id: p.id, via: "map" });
    }
  }

  // After a selection renders: open the modal, show the place on the card's map, and move
  // focus. Runs as a layout effect so focus moves before the browser paints.
  const showCard = useEffectEvent((feature: Site) => {
    const dialog = dialogRef.current!;
    if (!dialog.open) {
      if (panel) dialog.show();
      else dialog.showModal();
    }
    if (!panel) showMiniMap(feature);

    // Focus the card's heading so a keyboard or screen-reader user lands on the content
    // they just asked for instead of being left behind in the list. The exception is a
    // stepper click: focus goes back to the arrow they pressed, so a second press steps
    // again.
    const arrow = stepFocus.current &&
      dialog.querySelector<HTMLElement>(`.step-${stepFocus.current}`);
    stepFocus.current = null;
    (arrow || dialog.querySelector<HTMLElement>("#card-title")!).focus();
  });

  function showMiniMap(feature: Site) {
    // The small map at the top of the card: where this place is, at street level, with
    // the sites around it. It is the same map-core as the main map, so its pins look and
    // behave the same — tapping another pin here opens that site's card in place.
    // Scroll-to-zoom is off because the wheel belongs to the card's text, and it has no
    // zoom buttons; dragging, double-click and pinch still move it.
    let miniMap = miniMapRef.current;
    if (!miniMap) {
      miniMap = miniMapRef.current = createMap(miniContainer.current!, {
        style: structuredClone(style!),
        data: model!.data,
        categories,
        zoomButtons: false,
        onSelect: (picked, info) => {
          if (info.via === "map" && picked && picked.properties.id !== selectedId.current) {
            mainMap()!.select(picked.properties.id);
            track("map_pin_open", {
              org_id: picked.properties.org_id, site_id: picked.properties.id, via: "mini_map",
            });
          }
        },
      });
      miniMap.raw.scrollZoom.disable();
      // MapLibre opens the compact attribution expanded until the first drag; on a map
      // this small it would cover the bottom third. Collapsed, it is the (i) button.
      miniMap.ready(() => miniMap!.raw.getContainer()
        .querySelector(".maplibregl-ctrl-attrib")?.classList.remove("maplibregl-compact-show"));
    }
    // The dialog was display:none until a moment ago; the canvas has to measure again.
    miniMap.raw.resize();
    miniMap.ready(() => {
      miniMap.raw.jumpTo({
        center: feature.geometry.coordinates as [number, number], zoom: MINI_MAP_ZOOM,
      });
      miniMap.select(feature.properties.id);
    });
  }

  useLayoutEffect(() => {
    if (selection.feature) showCard(selection.feature);
  }, [selection]);

  /** A row in the list was chosen: open its card, and come back to the row on close. */
  function openFromList(button: HTMLElement, feature: Site) {
    const map = mainMap();
    if (!map) return;                  // the list is up before the map is
    returnFocusTo.current = button;
    map.select(feature.properties.id);
    track("map_pin_open", {
      org_id: feature.properties.org_id, site_id: feature.properties.id, via: "list",
    });
  }

  /** Call just before selecting a site because a link with ?site=<id> named it: its card
   *  opens without a history entry of its own, since the address already says so. */
  const selectingFromUrl = useCallback(() => { urlDriven.current = true; }, []);

  /** Step to the previous (-1) or next (+1) record in this group, wrapping round. */
  function step(delta: number, dir: StepDirection) {
    const group = coincidentWith(model!.atCoord, selection.feature!);
    const index = group.findIndex((f) => f.properties.id === selection.feature!.properties.id);
    const next = group[(index + delta + group.length) % group.length];
    stepFocus.current = dir;
    // Re-select through the core so the map's own state moves with the card.
    mainMap()!.select(next.properties.id);
    track("map_pin_open", {
      org_id: next.properties.org_id, site_id: next.properties.id, via: "stepper",
    });
  }

  /** Put the selected site in the address bar: a new entry when a card opens, else in place. */
  function recordInUrl(id: string) {
    if (urlDriven.current) {
      urlDriven.current = false;       // the address already says so
      return;
    }
    if (dialogRef.current!.open) {
      history.replaceState(history.state, "", siteUrl(id));
    } else {
      history.pushState({ mapkitSite: id }, "", siteUrl(id));
      pushed.current = true;
    }
  }

  /** Close the card. If it has its own history entry, close it by going back. */
  function close() {
    if (pushed.current) {
      history.back();                  // popstate finds no ?site= and calls hideCard
      return;
    }
    hideCard();
    history.replaceState(history.state, "", siteUrl(null));
  }

  function hideCard() {
    pushed.current = false;
    if (dialogRef.current!.open) dialogRef.current!.close();
    mainMap()?.select(null);           // clears the selection
    const back = returnFocusTo.current;
    returnFocusTo.current = null;
    if (back && document.contains(back)) back.focus();
  }

  const onPopState = useEffectEvent(() => {
    const map = mainMap();
    if (!map) return;
    const id = new URLSearchParams(window.location.search).get("site");
    if (id && model!.byId.has(id)) {
      urlDriven.current = true;
      map.select(id);
      pushed.current = Boolean(history.state && history.state.mapkitSite);
    } else if (dialogRef.current!.open) {
      hideCard();
    }
  });

  useEffect(() => {
    const listener = () => onPopState();
    window.addEventListener("popstate", listener);
    return () => window.removeEventListener("popstate", listener);
  }, []);

  const feature = selection.feature;
  return {
    /** The site whose card is open, or null. */
    feature,
    /** Every record at the open site's location, itself included. */
    group: feature && model ? coincidentWith(model.atCoord, feature) : [],
    dialogElement,
    miniMapElement,
    attach,
    onSelect,
    openFromList,
    selectingFromUrl,
    step,
    close,
  };
}

/** Announce a selection through the one live region map-core owns. */
function announceSelected(map: MapCore<SiteProperties> | null, p: SiteProperties) {
  if (!map) return;
  map.announce(t("Selected: {name}, {address}", { name: p.org, address: p.address }));
}

/** This page's address with ?site=<id>, or without it for null. */
export function siteUrl(id: string | null): URL {
  const url = new URL(window.location.href);
  if (id) url.searchParams.set("site", id);
  else url.searchParams.delete("site");
  return url;
}
