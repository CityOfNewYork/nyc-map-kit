import type { Site } from "../../logic/types.ts";
import { CategoryIcon } from "../../ui/CategoryIcon.tsx";
import { Pause } from "../../ui/Pause.tsx";
import { CENTER_MARK, centerDetails, centerKind, centerStatus } from "../logic/centers.ts";
import { WheelchairIcon } from "./FeatureIcons.tsx";
import { OpenStatusLine } from "./OpenStatusLine.tsx";
import { t } from "../../logic/i18n.ts";

/** A center's lines in a list: its name, what kind of center it is, whether it is open at
 *  `minute`, with the wheelchair symbol after it where the center is accessible, and its
 *  address. A hospital and the warming bus parked at it share a name and an address, so
 *  the kind is what tells their rows apart. */
export function centerRow(feature: Site, minute: number) {
  const p = feature.properties;
  const kind = centerKind(feature);
  const status = centerStatus(feature, minute);
  const { wheelchair } = centerDetails(feature);
  return (
    <>
      <span className="name">{p.org}</span>
      {kind && <><Pause /><span className="type">{t(kind.label)}</span></>}
      {(status || wheelchair) && (
        <>
          <Pause />
          <span className="row-status">
            {status && <OpenStatusLine status={status} />}
            {status && wheelchair && <Pause />}
            {wheelchair && (
              <span className="row-access">
                <WheelchairIcon />
                <span className="visually-hidden">{t("Wheelchair accessible")}</span>
              </span>
            )}
          </span>
        </>
      )}
      <Pause />
      <span className="addr">{p.address}</span>
    </>
  );
}

/** Every center's mark, as its pin carries it. */
export function centerMarker() {
  return <CategoryIcon {...CENTER_MARK} />;
}
