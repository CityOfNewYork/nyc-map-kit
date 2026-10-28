import { useEffect, useId, useRef, useState } from "react";
import type { FocusEvent, KeyboardEvent, ReactNode } from "react";
import { track } from "../../logic/analytics.ts";
import { Check } from "../../ui/Check.tsx";
import { FiltersIcon } from "../../ui/Filters.tsx";
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
 * The filters as a row of buttons beside the search box on a wide screen: open now,
 * wheelchair access and pets as toggle buttons, then More filters, which opens a short
 * menu of the kinds of center. A button is tinted while its filter is on. Each change
 * applies at once, to the list and the map together. Narrower screens use the Filters
 * button and FilterPanel instead (see warming.css).
 */
export function FilterBar({ filters, onChange }: FilterBarProps) {
  function set(next: Partial<Filters>, filter: string, value: string | boolean) {
    onChange({ ...filters, ...next });
    track("map_filter", { filter, value });
  }
  function toggleType(type: string, on: boolean) {
    const types = on ? [...filters.types, type] : filters.types.filter((t) => t !== type);
    set({ types }, "type", `${type}:${on}`);
  }

  return (
    <div className="filter-bar" role="group" aria-label={t("Filters")}>
      <FilterToggles filters={filters} set={set} />
      <Dropdown label={<span>{t("More filters")}</span>} on={filters.types.length > 0}>
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

/** Open now, wheelchair access and pets: each a toggle with its icon, tinted while it is
 *  on. The bar and FilterPanel both show them first. */
export function FilterToggles({ filters, set }: {
  filters: Filters;
  set: (next: Partial<Filters>, filter: string, value: boolean) => void;
}) {
  return (
    <>
      <Toggle className="pill toggle-pill" pressed={filters.openNow}
              onChange={(on) => set({ openNow: on }, "open", on)} icon={<ClockIcon />}>
        {t("Open now")}
      </Toggle>
      <Toggle className="pill toggle-pill" pressed={filters.wheelchair}
              onChange={(on) => set({ wheelchair: on }, "wheelchair", on)} icon={<WheelchairIcon />}>
        {t("Wheelchair accessible")}
      </Toggle>
      <Toggle className="pill toggle-pill" pressed={filters.pets}
              onChange={(on) => set({ pets: on }, "pets", on)} icon={<PawIcon />}>
        {t("Pets allowed")}
      </Toggle>
    </>
  );
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
