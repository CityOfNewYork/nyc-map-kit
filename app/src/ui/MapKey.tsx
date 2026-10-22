import { useState } from "react";
import { CategoryIcon } from "./CategoryIcon.tsx";
import { t } from "../logic/i18n.ts";

/** One row of the key: a category's label and the mark its pins carry. */
export interface MapKeyItem {
  label: string;
  color: string;
  glyph?: string;
  fill?: boolean;
}

/** The map's key: each category's mark beside its label, under `caption` when given (what
 *  the categories are, such as "Overseen by"). Open to start with on a desktop, closed on
 *  a phone, where the map has less room. The labels arrive translated, or as the data
 *  gives them. */
export function MapKey({ caption, items }: { caption?: string; items: MapKeyItem[] }) {
  const [startOpen] = useState(() => matchMedia("(min-width: 768px)").matches);
  return (
    <details className="map-key" open={startOpen}>
      <summary><span>{t("Map key")}</span></summary>
      {caption && <p className="map-key-caption">{caption}</p>}
      <ul>
        {items.map(({ label, color, glyph, fill }) => (
          <li key={label}>
            <CategoryIcon color={color} glyph={glyph} fill={fill} />
            <span>{label}</span>
          </li>
        ))}
      </ul>
    </details>
  );
}
