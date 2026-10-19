import { useState } from "react";
import { CategoryIcon } from "../../ui/CategoryIcon.tsx";
import { CENTER_KINDS } from "../logic/centers.ts";
import { t } from "../../logic/i18n.ts";

/** The map's key: each kind of center beside its icon. Open to start with on a desktop,
 *  closed on a phone, where the map has less room. */
export function MapKey() {
  const [startOpen] = useState(() => matchMedia("(min-width: 768px)").matches);
  return (
    <details className="map-key" open={startOpen}>
      <summary><span>{t("Map key")}</span></summary>
      <ul>
        {[...CENTER_KINDS].map(([type, { label, color, glyph }]) => (
          <li key={type}>
            <CategoryIcon color={color} glyph={glyph} />
            <span>{t(label)}</span>
          </li>
        ))}
      </ul>
    </details>
  );
}
