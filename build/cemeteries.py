#!/usr/bin/env python3
"""
nyc-map-kit — the city's cemeteries and their names, for the NYC basemap.

    python3 build/cemeteries.py

Writes app/public/cemeteries.geojson: the outline of every cemetery in the city, from the
planimetric survey's open-space layer, which OTI publishes as a feature service. The
NYC basemap's tiles carry the same layer with no field to tell a cemetery from a
schoolyard or a vacant lot; the feature service has that field (FEATURE_CODE, 2500 for
a cemetery), so the block reads the cemeteries from here.

The outlines carry no properties, simplified to about a metre: under a pixel at the zoom
a selected site opens at (z15), about four at the map's closest (z18).

Each named cemetery also gets one point, where its name is printed, with two
properties:

  name      the survey's NAME. Its placeholders ("NO NAME", or blank) get no point.
  min_zoom  the zoom the Protomaps basemap's tiles would give the same cemetery, by the
            same rules (Pois.java in github.com/protomaps/basemaps): graded by the
            area of its bounding box, one zoom later for a name over 30 characters, two
            for one over 45, and written one higher, as Protomaps writes it. So both
            basemaps name a cemetery from the same zoom. Protomaps can also take the
            zoom from a place's Wikidata popularity; the survey has no Wikidata, so
            this uses size alone.

The survey maps a cemetery that roads cross as several pieces of the same name.
Pieces of one name that lie within MERGE_METRES of each other are one place: graded
by the box around them all, and named once, at the point of its largest piece
farthest from the edge, so the name sits inside the cemetery wherever its shape.

Rerun it when the survey is republished. Stdlib only. No installs.
"""

import heapq
import json
import math
import os
import urllib.parse
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "app", "public", "cemeteries.geojson")

SERVICE = ("https://services6.arcgis.com/yG5s3afENB5iO9fj/ArcGIS/rest/services/"
           "Open_Space_No_Park_2022/FeatureServer/11/query")
CEMETERY = 2500
PLACEHOLDER_NAMES = {"", "NO NAME"}
MERGE_METRES = 100
USER_AGENT = "nyc-map-kit cemeteries.py (NYC OTI; https://github.com/CityOfNewYork/nyc-map-kit)"

EARTH_RADIUS = 6378137                  # Web Mercator's sphere, in metres
# Protomaps grades a named area by its bounding box in Web Mercator, in units of 70 m²,
# and names a cemetery or school from these zooms.
WAYAREA_UNIT = 70
CEMETERY_GRADES = [(10, 16), (100, 15), (1000, 14), (5000, 13)]
CEMETERY_LARGEST = 12


def main():
    query = urllib.parse.urlencode({
        "where": f"FEATURE_CODE={CEMETERY}",
        "outFields": "NAME",
        "outSR": 4326,
        "maxAllowableOffset": 0.00001,     # degrees: about a metre
        "geometryPrecision": 5,            # about a metre
        "f": "geojson",
    })
    req = urllib.request.Request(f"{SERVICE}?{query}", headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=60) as resp:
        data = json.load(resp)
    if data.get("properties", {}).get("exceededTransferLimit"):
        raise SystemExit("the service returned a partial result; page the query")
    pieces = [f for f in data["features"] if f.get("geometry")]
    if not pieces:
        raise SystemExit("the service returned no cemeteries")

    outlines = [{"type": "Feature", "properties": {}, "geometry": f["geometry"]}
                for f in pieces]
    names = [name_point(place) for place in places(pieces)]
    with open(OUT, "w", encoding="utf-8") as fh:
        json.dump({"type": "FeatureCollection", "features": outlines + names}, fh,
                  separators=(",", ":"))
        fh.write("\n")
    print(f"wrote {len(outlines)} cemeteries and {len(names)} names to "
          f"{os.path.relpath(OUT, ROOT)} ({os.path.getsize(OUT) // 1024} KB)")


def places(pieces):
    """The named pieces, grouped into places: same name, within MERGE_METRES."""
    by_name = {}
    for f in pieces:
        name = (f["properties"].get("NAME") or "").strip()
        if name.upper() not in PLACEHOLDER_NAMES:
            by_name.setdefault(name, []).append(f)
    for name, group in sorted(by_name.items()):
        boxes = [bbox(f["geometry"]) for f in group]
        cluster = list(range(len(group)))

        def root(i):
            while cluster[i] != i:
                i = cluster[i]
            return i
        for i in range(len(group)):
            for j in range(i + 1, len(group)):
                if box_gap_metres(boxes[i], boxes[j]) <= MERGE_METRES:
                    cluster[root(j)] = root(i)
        members = {}
        for i in range(len(group)):
            members.setdefault(root(i), []).append(i)
        for ids in members.values():
            yield name, [group[i]["geometry"] for i in ids], [boxes[i] for i in ids]


def name_point(place):
    name, geometries, boxes = place
    largest = max(geometries, key=lambda g: abs(ring_area(g["coordinates"][0])))
    lon, lat = polylabel(largest["coordinates"])
    return {
        "type": "Feature",
        "properties": {"name": name, "min_zoom": protomaps_min_zoom(name, union(boxes))},
        "geometry": {"type": "Point", "coordinates": [round(lon, 5), round(lat, 5)]},
    }


def protomaps_min_zoom(name, box):
    """Pois.java's min_zoom for a named cemetery polygon whose bounding box is `box`."""
    west, south, east, north = box
    x = lambda lon: EARTH_RADIUS * math.radians(lon)
    y = lambda lat: EARTH_RADIUS * math.log(math.tan(math.pi / 4 + math.radians(lat) / 2))
    wayarea = (x(east) - x(west)) * (y(north) - y(south)) / WAYAREA_UNIT
    zoom = next((z for limit, z in CEMETERY_GRADES if wayarea < limit), CEMETERY_LARGEST)
    if zoom < 14:
        zoom += 2 if len(name) > 45 else 1 if len(name) > 30 else 0
    return zoom + 1


def bbox(geometry):
    lons = [p[0] for ring in geometry["coordinates"] for p in ring]
    lats = [p[1] for ring in geometry["coordinates"] for p in ring]
    return min(lons), min(lats), max(lons), max(lats)


def union(boxes):
    return (min(b[0] for b in boxes), min(b[1] for b in boxes),
            max(b[2] for b in boxes), max(b[3] for b in boxes))


def box_gap_metres(a, b):
    """How far apart two boxes are, 0 if they overlap."""
    lat = math.radians((a[1] + a[3]) / 2)
    dx = max(0, b[0] - a[2], a[0] - b[2]) * 111320 * math.cos(lat)
    dy = max(0, b[1] - a[3], a[1] - b[3]) * 110540
    return math.hypot(dx, dy)


def ring_area(ring):
    return sum(x0 * y1 - x1 * y0 for (x0, y0), (x1, y1) in zip(ring, ring[1:])) / 2


def polylabel(rings, precision_metres=1.0):
    """The point inside the polygon farthest from its edge (Mapbox's polylabel), as lon/lat.

    Worked in metres on a local plane, so the distance it maximises is a true one."""
    lat0 = math.radians(sum(p[1] for p in rings[0]) / len(rings[0]))
    kx, ky = 111320 * math.cos(lat0), 110540
    plane = [[(p[0] * kx, p[1] * ky) for p in ring] for ring in rings]
    xs = [p[0] for p in plane[0]]
    ys = [p[1] for p in plane[0]]
    min_x, min_y, max_x, max_y = min(xs), min(ys), max(xs), max(ys)
    size = min(max_x - min_x, max_y - min_y)
    if size == 0:
        return min_x / kx, min_y / ky

    def distance(x, y):
        """Signed distance to the polygon's edge: positive inside."""
        inside, best = False, math.inf
        for ring in plane:
            for (ax, ay), (bx, by) in zip(ring, ring[1:] + ring[:1]):
                if (ay > y) != (by > y) and x < (bx - ax) * (y - ay) / (by - ay) + ax:
                    inside = not inside
                dx, dy = bx - ax, by - ay
                t = 0 if dx == dy == 0 else max(0, min(1, ((x - ax) * dx + (y - ay) * dy)
                                                         / (dx * dx + dy * dy)))
                best = min(best, math.hypot(x - ax - t * dx, y - ay - t * dy))
        return best if inside else -best

    def cell(x, y, h):
        d = distance(x, y)
        return (-(d + h * math.sqrt(2)), x, y, h, d)

    queue = []
    h = size / 2
    x = min_x
    while x < max_x:
        y = min_y
        while y < max_y:
            heapq.heappush(queue, cell(x + h, y + h, h))
            y += size
        x += size
    best = cell((min_x + max_x) / 2, (min_y + max_y) / 2, 0)
    while queue:
        _, x, y, h, d = heapq.heappop(queue)
        if d > best[4]:
            best = (0, x, y, h, d)
        if d + h * math.sqrt(2) - best[4] <= precision_metres:
            continue
        h /= 2
        for cx, cy in ((x - h, y - h), (x + h, y - h), (x - h, y + h), (x + h, y + h)):
            heapq.heappush(queue, cell(cx, cy, h))
    return best[1] / kx, best[2] / ky


if __name__ == "__main__":
    main()
