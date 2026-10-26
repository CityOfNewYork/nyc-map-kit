/**
 * station-icon.ts — the subway stations' icon, which basemap-style.ts's stations layer
 * names and map-core adds as the style loads. Its own file, so map-core can draw it
 * without loading the basemap code.
 */

/** The icon's id, as the stations layer asks for it. */
export const STATION_ICON = "subway-station";
/** The pixel ratio stationIcon draws at, so the icon is sharp on a high-density screen. */
export const STATION_ICON_DPR = 2;
/** The icon and the stations' names, in the borough labels' grey. */
export const STATION_COLOR = "#4a4a4a";

/** The icon's width and height, in CSS pixels. */
const SIZE = 18;
/** A train seen from the front, on a 24-unit square, filled even-odd: the body with its
 *  windscreen and two lamps cut out, and two legs. */
const TRAIN =
  "M9 3h6a3 3 0 0 1 3 3v8a3 3 0 0 1 -3 3h-6a3 3 0 0 1 -3 -3v-8a3 3 0 0 1 3 -3Z" +
  "M8.5 6.5h7v4h-7Z" +
  "M10.1 14a1.1 1.1 0 1 0 -2.2 0a1.1 1.1 0 1 0 2.2 0Z" +
  "M16.1 14a1.1 1.1 0 1 0 -2.2 0a1.1 1.1 0 1 0 2.2 0Z" +
  "M8.2 17h1.8l-1.6 4h-1.8Z" +
  "M14 17h1.8l1.6 4h-1.8Z";

/** The icon: TRAIN in STATION_COLOR on a white disc in a ring of the same grey, as
 *  OTI's basemap draws a station. */
export function stationIcon(): ImageData {
  const px = SIZE * STATION_ICON_DPR;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = px;
  const ctx = canvas.getContext("2d")!;
  ctx.scale(STATION_ICON_DPR, STATION_ICON_DPR);
  const r = SIZE / 2;
  ctx.beginPath();
  ctx.arc(r, r, r - 0.75, 0, Math.PI * 2);
  ctx.fillStyle = "#ffffff";
  ctx.fill();
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = STATION_COLOR;
  ctx.stroke();
  const glyph = SIZE * 0.66;
  ctx.translate(r - glyph / 2, r - glyph / 2);
  ctx.scale(glyph / 24, glyph / 24);
  ctx.fillStyle = STATION_COLOR;
  ctx.fill(new Path2D(TRAIN), "evenodd");
  return ctx.getImageData(0, 0, px, px);
}
