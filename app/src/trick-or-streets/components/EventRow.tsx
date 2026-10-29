import type { Site } from "../../logic/types.ts";
import { CategoryIcon } from "../../ui/CategoryIcon.tsx";
import { Pause } from "../../ui/Pause.tsx";
import { SITE_MARK, eventKind } from "../logic/events.ts";
import { EventStatusLine } from "./EventStatusLine.tsx";
import type { NycNow } from "./useNycNow.ts";
import { t } from "../../logic/i18n.ts";

/** An event's lines in a list: its name, what kind of event it is, when it is, as of
 *  `now`, and the street it is on. */
export function eventRow(feature: Site, now: NycNow) {
  const kind = eventKind(feature);
  return (
    <>
      <span className="name">{feature.properties.org}</span>
      {kind && <><Pause /><span className="type">{t(kind.label)}</span></>}
      <Pause />
      <span className="row-status"><EventStatusLine feature={feature} now={now} /></span>
      <Pause />
      <span className="addr">{feature.properties.address}</span>
    </>
  );
}

/** An event's mark, as its pin carries it: the ghost or the jack-o'-lantern. */
export function eventMarker(feature: Site) {
  return <CategoryIcon {...(eventKind(feature)?.mark ?? SITE_MARK)} />;
}
