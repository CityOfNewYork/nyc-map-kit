import type { LngLat } from "../../logic/places.ts";
import type { Model, Site } from "../../logic/types.ts";
import { Card } from "../../ui/Card.tsx";
import { CategoryIcon } from "../../ui/CategoryIcon.tsx";
import { Pause } from "../../ui/Pause.tsx";
import { clockTime } from "../../warming/logic/hours.ts";
import { dayName, eventKind, eventWhen } from "../logic/events.ts";
import { EventStatusLine } from "./EventStatusLine.tsx";
import { useNycNow } from "./useNycNow.ts";
import { t } from "../../logic/i18n.ts";

interface EventCardProps {
  feature: Site;
  model: Model;
  /** Where the reader searched for, or null. */
  origin: LngLat | null;
}

/**
 * One event's card: the block's Card (ui/Card.tsx), configured by EVENT_CONFIG, with what
 * only an event has — its kind under the name, where it stands now, and its day and times.
 */
export function EventCard({ feature, model, origin }: EventCardProps) {
  const kind = eventKind(feature);
  const now = useNycNow();
  return (
    <Card feature={feature} model={model} origin={origin}
          meta={kind && (
            <span className="card-meta-item">
              <CategoryIcon {...kind.mark} />
              <span>{t(kind.label)}</span>
            </span>
          )}
          status={<EventStatusLine feature={feature} now={now} />}
          hours={<When feature={feature} />} />
  );
}

/** "Saturday, October 31 · 4 PM – 8 PM". Nothing when the day or times cannot be read. */
function When({ feature }: { feature: Site }) {
  const when = eventWhen(feature);
  if (!when) return null;
  return (
    <span>
      <span>{dayName(when.date, true)}</span><Pause />{" "}<span aria-hidden="true">·</span>{" "}
      <span>{t("{from} – {to}", { from: clockTime(when.from), to: clockTime(when.to) })}</span>
    </span>
  );
}
