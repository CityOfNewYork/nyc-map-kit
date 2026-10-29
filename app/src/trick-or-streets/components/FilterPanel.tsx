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
  function set(next: Partial<Filters>) {
    onChange({ ...filters, ...next });
  }
  function toggleType(type: string, on: boolean) {
    set({ types: on ? [...filters.types, type] : filters.types.filter((t) => t !== type) });
  }

  const chosen = filters.types.map((type) => t(EVENT_KINDS.get(type)?.label ?? type));

  return (
    <FiltersPanel id={id} shown={shown} onClear={() => onChange(NO_FILTERS)} onClose={onClose}
                  modal>
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
