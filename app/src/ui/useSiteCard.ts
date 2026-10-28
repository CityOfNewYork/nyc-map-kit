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
 * A pin on the main map that holds more than one site the filters leave (`shown`; see
 * coincidentWith in logic/data.ts) opens the pop-up on a list of them instead, to choose
 * one from; the chosen site's card then opens in its place, with the stepper above it.
 * The list has a history entry of its own, as a card does but without ?site=, and the
 * chosen card takes it over: Back closes the pop-up at either step. A row in the app's
 * list, a link and the small map open a card directly.
 *
 * Inside an iframe the address that changes is the frame's, not the host page's, so the
 * link is the frame's own address with ?site=<id>. Back still works, because the browser
 * keeps one history for the page and its frames.
 */
import {
  useCallback, useEffect, useEffectEvent, useLayoutEffect, useMemo, useRef, useState,
} from "react";
import type { StyleSpecification } from "maplibre-gl";
import { createMap } from "../core/map-core.ts";
import type { MapCore, PinCategories, PinStyle, SelectInfo } from "../core/map-core.ts";
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
  /** The main map's pin and pin categories, so the small map's pins match. */
  pin?: PinStyle | null;
  categories?: PinCategories | null;
  /** The sites the filters leave, when the app has filters: the list of choices and the
   *  stepper offer only these. Every site unless given. */
  shown?: Site[] | null;
}

export function useSiteCard({
  model, style, pin = null, categories = null, shown = null,
}: SiteCardOptions) {
  // The site whose card is open, or the sites a pin holds that the reader is choosing
  // between. `seq` counts selections, so selecting a site again (Back to it, say) still
  // runs the effect that opens and focuses the card.
  const [selection, setSelection] = useState<{
    feature: Site | null; choices: Site[]; seq: number;
  }>({ feature: null, choices: [], seq: 0 });
  const dialogRef = useRef<HTMLDialogElement>(null);
  const miniContainer = useRef<HTMLDivElement>(null);
  const miniMapRef = useRef<MapCore<SiteProperties>>(null);   // the card's map; made on first open

  // Bookkeeping that event handlers read and write but nothing renders: refs, not state.
  const selectedId = useRef<string | null>(null);   // what map-core has selected, readable at once
  const stepFocus = useRef<StepDirection | null>(null);  // while a stepper click is in flight
  const chosen = useRef(false);        // while a pick from the list of choices is in flight
  const returnFocusTo = useRef<HTMLElement | null>(null);  // the row that opened the card; see closedCardFocus
  const pushed = useRef(false);        // the open card has a history entry of its own
  const urlDriven = useRef(false);     // the URL, not the reader, chose the site
  const mainMapRef = useRef<MapCore<SiteProperties> | null>(null);   // see attach
  const mainMap = () => mainMapRef.current;

  // The records at a site's location that the filters leave, the site itself always.
  const showing = useMemo(() => shown && new Set(shown.map((f) => f.properties.id)), [shown]);
  const groupOf = (feature: Site) => coincidentWith(model!.atCoord, feature).filter((f) =>
    !showing || showing.has(f.properties.id) || f.properties.id === feature.properties.id);

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
      setSelection((s) => (s.feature || s.choices.length
        ? { feature: null, choices: [], seq: s.seq } : s));
      return;
    }
    const p = feature.properties;
    selectedId.current = p.id;
    // A pin that holds more than one site: the list of them first, with a history entry
    // of its own, so Back closes it (see the top of this file). The pin stays selected.
    const group = groupOf(feature);
    if (info.via === "map" && group.length > 1) {
      history.pushState({ mapkitSite: p.id }, "", siteUrl(null));
      pushed.current = true;
      returnFocusTo.current = null;
      setSelection((s) => ({ feature: null, choices: group, seq: s.seq + 1 }));
      track("map_pin_choices", { count: group.length });
      return;
    }
    recordInUrl(p.id);
    setSelection((s) => ({ feature, choices: [], seq: s.seq + 1 }));
    // Opening a card moves focus into it, where the name is heard, so announcing it as
    // well only says it twice. A stepper press leaves focus on the arrow, so the place
    // stepped to is announced: through the card's own map when it is a pop-up, since
    // the modal hides the main map's live region along with everything else behind it.
    if (stepFocus.current) announceSelected(miniMapRef.current ?? mainMap(), p);
    if (info.via === "map") {
      returnFocusTo.current = null;
      track("map_pin_open", { org_id: p.org_id, site_id: p.id, via: "map" });
    }
  }

  // After a selection renders: open the modal, show the place on the card's map, and move
  // focus. Runs as a layout effect so focus moves before the browser paints.
  const showCard = useEffectEvent((feature: Site) => {
    const dialog = dialogRef.current!;
    if (!dialog.open) dialog.showModal();
    showMiniMap(feature);

    // Focus the card's heading so a keyboard or screen-reader user lands on the content
    // they just asked for instead of being left behind in the list. Where others share
    // the location, focus starts on the stepper's Next arrow instead, as a sighted reader
    // sees the stepper above the card: a screen reader hears the dialog's description,
    // "1 of 2 at this location" (SiteDialog.tsx), then "Next site at this location,
    // button", and reading on goes into the card. After a stepper click, focus goes back
    // to the arrow they pressed, so a second press steps again. A site picked from the
    // list of choices is the one the reader asked for, so focus goes to its name.
    const arrow = chosen.current ? null
      : dialog.querySelector<HTMLElement>(`.step-${stepFocus.current ?? "next"}`);
    stepFocus.current = null;
    chosen.current = false;
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
        pin,
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
      // Out of screen readers' way and out of the tab order: the card's address says in
      // words where this is, and the map ("Map, region") and its credits button ("Toggle
      // attribution") were two stops between the stepper and the card. Its live region,
      // which the stepper announces through, stays.
      const canvas = miniMap.raw.getCanvas();
      const controls = miniMap.raw.getContainer().querySelector(".maplibregl-control-container");
      canvas.setAttribute("aria-hidden", "true");
      canvas.tabIndex = -1;
      controls?.setAttribute("aria-hidden", "true");
      controls?.querySelector(".maplibregl-ctrl-attrib-button")?.setAttribute("tabindex", "-1");
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

  // The list of choices: the modal opens on it, focused on its heading, which names it.
  const showChoices = useEffectEvent(() => {
    const dialog = dialogRef.current!;
    if (!dialog.open) dialog.showModal();
    dialog.querySelector<HTMLElement>("#card-title")!.focus();
  });

  useLayoutEffect(() => {
    if (selection.feature) showCard(selection.feature);
    else if (selection.choices.length) showChoices();
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

  /** A site was picked from the list of choices: its card opens in the list's place. */
  function choose(feature: Site) {
    chosen.current = true;
    mainMap()!.select(feature.properties.id);
    track("map_pin_open", {
      org_id: feature.properties.org_id, site_id: feature.properties.id, via: "chooser",
    });
  }

  /** Call just before selecting a site because a link with ?site=<id> named it: its card
   *  opens without a history entry of its own, since the address already says so. */
  const selectingFromUrl = useCallback(() => { urlDriven.current = true; }, []);

  /** Step to the previous (-1) or next (+1) record in this group, wrapping round. */
  function step(delta: number, dir: StepDirection) {
    const group = groupOf(selection.feature!);
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
    const id = selectedId.current;     // before select(null) clears it
    const dialog = dialogRef.current!;
    pushed.current = false;
    if (dialog.open) dialog.close();
    mainMap()?.select(null);           // clears the selection
    const back = returnFocusTo.current;
    returnFocusTo.current = null;
    if (back && document.contains(back)) back.focus();
    else if (focusLost(dialog)) closedCardFocus(id)?.focus();
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
    group: feature && model ? groupOf(feature) : [],
    /** The sites a pin holds, to choose one from, while the pop-up lists them; else []. */
    choices: selection.choices,
    dialogElement,
    miniMapElement,
    attach,
    onSelect,
    openFromList,
    choose,
    selectingFromUrl,
    step,
    close,
  };
}

/** Whether closing `dialog` left focus nowhere: on the page itself, or still inside the
 *  closed card. */
function focusLost(dialog: HTMLDialogElement) {
  const active = document.activeElement;
  return !active || active === document.body || dialog.contains(active);
}

/** Where focus goes when a card closes that no list row opened — a link with ?site=, or a
 *  pin: the site's row in the list, so the reader is left where it is in the list, or, if
 *  the list is shut or off, the map's heading (the element marked data-card-return). The
 *  row is the list's (#site-list), not the pop-up's own list of choices. */
function closedCardFocus(id: string | null): HTMLElement | null {
  const row = id ? document.querySelector<HTMLElement>(
    `#site-list .site-button[data-site-id="${CSS.escape(id)}"]`) : null;
  if (row && row.getClientRects().length) return row;   // not in a shut list
  return document.querySelector<HTMLElement>("[data-card-return]");
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
