import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import type { FocusEvent, KeyboardEvent, ReactNode, RefObject } from "react";
import { track } from "../../logic/analytics.ts";
import { Check } from "../../ui/Check.tsx";
import { FiltersIcon } from "../../ui/Filters.tsx";
import { itemsThatFit } from "../../ui/layout.ts";
import { Toggle } from "../../ui/Toggle.tsx";
import { CENTER_KINDS } from "../logic/centers.ts";
import type { Filters } from "../logic/filters.ts";
import { ClockIcon, PawIcon, WheelchairIcon } from "./FeatureIcons.tsx";
import { t } from "../../logic/i18n.ts";

interface FilterBarProps {
  filters: Filters;
  onChange: (filters: Filters) => void;
}

/**
 * The filters as a row of buttons beside the search box on a desktop or tablet: open now,
 * wheelchair access and pets as toggle buttons, then More filters, which opens a short
 * menu of the kinds of center. As the bar narrows, the toggles move into that menu one by
 * one, from the right: those that fit stay in the row. A button is tinted while its
 * filter is on, More filters while any in its menu is. Each change applies at once, to
 * the list and the map together. A phone uses the Filters button and FilterPanel instead
 * (see warming.css).
 *
 * The toggles' widths are measured once, when all of them show. MapPage makes the bar
 * again in a new language, whose words are another width.
 */
export function FilterBar({ filters, onChange }: FilterBarProps) {
  const bar = useRef<HTMLDivElement>(null);
  const fit = useTogglesThatFit(bar);
  function set(next: Partial<Filters>, filter: string, value: string | boolean) {
    onChange({ ...filters, ...next });
    track("map_filter", { filter, value });
  }
  function toggleType(type: string, on: boolean) {
    const types = on ? [...filters.types, type] : filters.types.filter((t) => t !== type);
    set({ types }, "type", `${type}:${on}`);
  }
  const moved = [filters.openNow, filters.wheelchair, filters.pets].slice(fit);

  return (
    <div className="filter-bar" role="group" aria-label={t("Filters")} ref={bar}>
      <FilterToggles filters={filters} set={set} to={fit} />
      <Dropdown label={<span>{t("More filters")}</span>}
                on={filters.types.length > 0 || moved.some(Boolean)}>
        {moved.length > 0 && (
          <div className="filter-toggles">
            <FilterToggles filters={filters} set={set} from={fit} />
          </div>
        )}
        <fieldset>
          <legend>{t("Location type")}</legend>
          {[...CENTER_KINDS].map(([type, kind]) => (
            <Check key={type} className="filter-check" checked={filters.types.includes(type)}
                   onChange={(on) => toggleType(type, on)}>
              {t(kind.label)}
            </Check>
          ))}
        </fieldset>
      </Dropdown>
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
    const more = el.querySelector<HTMLElement>(":scope > .dropdown")!;
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
 *  with its icon, tinted while it is on, in this order. The bar and FilterPanel both show
 *  them first. */
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

/** A button with the filters' sliders after its label that opens a short menu under it,
 *  closed by Done, Escape or a click elsewhere. Escape and Done put focus back on the
 *  button. */
function Dropdown({ label, on, children }: { label: ReactNode; on: boolean; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  function close() {
    setOpen(false);
    button.current?.focus();
  }
  // Tab out of the list closes it, so it does not cover what focus moves on to. A focus
  // that goes nowhere, as a click on the page does, is left to the pointerdown above.
  function onBlur(e: FocusEvent<HTMLDivElement>) {
    const next = e.relatedTarget as Node | null;
    if (open && next && !root.current?.contains(next)) setOpen(false);
  }
  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (open && e.key === "Escape") {
      e.preventDefault();
      close();
    }
  }

  return (
    <div className="dropdown" ref={root} onKeyDown={onKeyDown} onBlur={onBlur}>
      <button type="button" className={on ? "pill on" : "pill"} ref={button}
              aria-expanded={open} aria-controls={id} onClick={() => setOpen((o) => !o)}>
        {label}
        <FiltersIcon size={18} />
      </button>
      <div className="dropdown-panel" id={id} hidden={!open}>
        {children}
        <button type="button" className="dropdown-done" onClick={close}>
          <span>{t("Done")}</span>
        </button>
      </div>
    </div>
  );
}
