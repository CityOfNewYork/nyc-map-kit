import { track } from "../../logic/analytics.ts";
import { Check } from "../../ui/Check.tsx";
import { FilterDisclosure, FiltersPanel } from "../../ui/Filters.tsx";
import { EVENT_KINDS } from "../logic/events.ts";
import { NO_FILTERS } from "../logic/filters.ts";
import type { Filters } from "../logic/filters.ts";
import { FilterToggles } from "./FilterBar.tsx";
import { t } from "../../logic/i18n.ts";

interface FilterPanelProps {
  id: string;
  filters: Filters;
  /** How many events the filters leave. */
  shown: number;
  onChange: (filters: Filters) => void;
  /** Done: close the panel. Focus goes back to the button that opened it. */
  onClose: () => void;
}

/**
 * Every Trick-or-Streets filter, in the kit's panel (ui/Filters.tsx): the kinds of event,
 * then, under "Show only", Happening now, as the same toggle the bar shows. More filters
 * opens it on a desktop or tablet, and the Filters button on a phone; either way it is a
 * modal card over the blurred map.
 */
export function FilterPanel({ id, filters, shown, onChange, onClose }: FilterPanelProps) {
  function set(next: Partial<Filters>, filter: string, value: string | boolean) {
    onChange({ ...filters, ...next });
    track("map_filter", { filter, value });
  }
  function toggleType(type: string, on: boolean) {
    const types = on ? [...filters.types, type] : filters.types.filter((t) => t !== type);
    set({ types }, "type", `${type}:${on}`);
  }
  function clear() {
    onChange(NO_FILTERS);
    track("map_filter", { filter: "clear" });
  }

  const chosen = filters.types.map((type) => t(EVENT_KINDS.get(type)?.label ?? type));

  return (
    <FiltersPanel id={id} shown={shown} onClear={clear} onClose={onClose} modal>
      <FilterDisclosure label={t("Event type")} chosen={chosen}>
        {[...EVENT_KINDS].map(([type, kind]) => (
          <Check key={type} className="filter-check" checked={filters.types.includes(type)}
                 onChange={(on) => toggleType(type, on)}>
            {t(kind.label)}
          </Check>
        ))}
      </FilterDisclosure>

      <fieldset>
        <legend className="filter-label">{t("Show only")}</legend>
        <div className="filter-toggles">
          <FilterToggles filters={filters} set={set} />
        </div>
      </fieldset>
    </FiltersPanel>
  );
}
