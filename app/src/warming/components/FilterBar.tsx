import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { RefObject } from "react";
import { track } from "../../logic/analytics.ts";
import { FiltersIcon } from "../../ui/Filters.tsx";
import { itemsThatFit } from "../../ui/layout.ts";
import { Toggle } from "../../ui/Toggle.tsx";
import type { Filters } from "../logic/filters.ts";
import { ClockIcon, PawIcon, WheelchairIcon } from "./FeatureIcons.tsx";
import { t } from "../../logic/i18n.ts";

interface FilterBarProps {
  filters: Filters;
  onChange: (filters: Filters) => void;
  /** More filters was pressed: open the filters panel, or close it. */
  onMore: (button: HTMLButtonElement) => void;
  /** The filters panel (FilterPanel, id "filters") is open. */
  moreOpen: boolean;
}

/**
 * The filters as a row of buttons beside the search box on a desktop or tablet: open now,
 * wheelchair access and pets as toggle buttons, then More filters, which opens the
 * filters panel with every filter in it (FilterPanel). As the bar narrows, the toggles
 * leave the row one by one, from the right, for the panel alone: those that fit stay. A
 * button is tinted while its filter is on, More filters while one the row does not show
 * is. Each change applies at once, to the list and the map together. A phone uses the
 * Filters button instead (see warming.css).
 *
 * The toggles' widths are measured once, when all of them show. MapPage makes the bar
 * again in a new language, whose words are another width.
 */
export function FilterBar({ filters, onChange, onMore, moreOpen }: FilterBarProps) {
  const bar = useRef<HTMLDivElement>(null);
  const fit = useTogglesThatFit(bar);
  function set(next: Partial<Filters>, filter: string, value: string | boolean) {
    onChange({ ...filters, ...next });
    track("map_filter", { filter, value });
  }
  const hiddenOn = filters.types.length > 0
    || [filters.openNow, filters.wheelchair, filters.pets].slice(fit).some(Boolean);

  return (
    <div className="filter-bar" role="group" aria-label={t("Filters")} ref={bar}>
      <FilterToggles filters={filters} set={set} to={fit} />
      <button type="button" className={hiddenOn ? "pill more-filters on" : "pill more-filters"}
              aria-expanded={moreOpen} aria-controls="filters"
              onClick={(e) => onMore(e.currentTarget)}>
        <span>{t("More filters")}</span>
        <FiltersIcon size={18} />
      </button>
    </div>
  );
}

/** How many of the bar's toggles fit beside More filters, kept up to date as the bar's
 *  width changes. Each toggle is measured on the first render, when all of them show, and
 *  again, all showing, once the page's fonts have loaded, since a face that arrives late
 *  sets the words at another width. */
function useTogglesThatFit(bar: RefObject<HTMLDivElement | null>): number {
  const [fit, setFit] = useState(Infinity);
  const [measured, setMeasured] = useState(0);
  useEffect(() => {
    let live = true;
    document.fonts?.ready.then(() => {
      if (!live) return;
      setFit(Infinity);
      setMeasured((n) => n + 1);
    });
    return () => { live = false; };
  }, []);
  useLayoutEffect(() => {
    const el = bar.current!;
    const widths = [...el.querySelectorAll<HTMLElement>(":scope > .toggle-pill")]
      .map((toggle) => toggle.offsetWidth);
    const more = el.querySelector<HTMLElement>(":scope > .more-filters")!;
    const gap = parseFloat(getComputedStyle(el).columnGap) || 0;
    const refit = () => setFit(itemsThatFit(widths, el.clientWidth - more.offsetWidth, gap));
    refit();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(refit);
    observer.observe(el);
    return () => observer.disconnect();
  }, [bar, measured]);
  return fit;
}

/** Open now, wheelchair access and pets, from `from` up to `to` of them: each a toggle
 *  with its icon, tinted while it is on, in this order: in the bar first, and in
 *  FilterPanel after the kinds of center. */
export function FilterToggles({ filters, set, from = 0, to = Infinity }: {
  filters: Filters;
  set: (next: Partial<Filters>, filter: string, value: boolean) => void;
  from?: number;
  to?: number;
}) {
  return [
    <Toggle key="open" className="pill toggle-pill" pressed={filters.openNow}
            onChange={(on) => set({ openNow: on }, "open", on)} icon={<ClockIcon />}>
      {t("Open now")}
    </Toggle>,
    <Toggle key="wheelchair" className="pill toggle-pill" pressed={filters.wheelchair}
            onChange={(on) => set({ wheelchair: on }, "wheelchair", on)} icon={<WheelchairIcon />}>
      {t("Wheelchair accessible")}
    </Toggle>,
    <Toggle key="pets" className="pill toggle-pill" pressed={filters.pets}
            onChange={(on) => set({ pets: on }, "pets", on)} icon={<PawIcon />}>
      {t("Pets allowed")}
    </Toggle>,
  ].slice(from, to);
}
