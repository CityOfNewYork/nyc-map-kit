#!/usr/bin/env python3
"""
nyc-map-kit — the city line, for shading the land outside it and dotting its land border.

    python3 build/city-limits.py

Writes app/src/core/city-limits.json: the outline of New York City as one MultiPolygon,
from City Planning's borough boundaries with water areas included, so the line runs
down the middle of the Hudson and the Arthur Kill rather than along the shore. The five
boroughs are merged by dropping the edges they share, and the outline is simplified to
about 10 m: under a pixel at the city-wide zoom, and close enough that the grey outside
the city meets the city line at street level. Liberty and Ellis Islands come out as
rings of their own.

Also writes app/src/core/city-line.json: the stretches of that outline that run over land,
Queens against Nassau and the Bronx against Westchester, as one MultiLineString. They are
the points the outline shares with City Planning's boundaries clipped to the shoreline.

The app bundles both files. Rerun it when City Planning republishes the boundaries.

Stdlib only. No installs.
"""

import collections
import json
import math
import os
import urllib.parse
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "app", "src", "core", "city-limits.json")
OUT_LINE = os.path.join(ROOT, "app", "src", "core", "city-line.json")

SERVICES = "https://services5.arcgis.com/GfwWNkhOj9bNBqoJ/arcgis/rest/services"
WITH_WATER = f"{SERVICES}/NYC_Borough_Boundary_Water_Included/FeatureServer/0/query"
SHORELINE = f"{SERVICES}/NYC_Borough_Boundary/FeatureServer/0/query"
TOLERANCE = 0.0001       # degrees: about 10 m
MIN_BORDER = 400         # metres: shorter shared stretches are where a pier or a bridge
                         # meets the line at the shore, not land border
USER_AGENT = "nyc-map-kit city-limits.py (NYC OTI; https://github.com/CityOfNewYork/nyc-map-kit)"


def fetch(service):
    query = urllib.parse.urlencode({
        "where": "1=1", "outFields": "", "outSR": 4326, "geometryPrecision": 5,
        "f": "geojson",
    })
    req = urllib.request.Request(f"{service}?{query}", headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=60) as resp:
        data = json.load(resp)
    if len(data["features"]) != 5:
        raise SystemExit(f"{service}: expected five boroughs, got {len(data['features'])}")
    return data


def rings_points(data):
    for ring in rings(data):
        yield from ring


def rings(data):
    for feature in data["features"]:
        geom = feature["geometry"]
        polygons = [geom["coordinates"]] if geom["type"] == "Polygon" else geom["coordinates"]
        for polygon in polygons:
            for ring in polygon:
                yield [tuple(c) for c in ring]


def dissolve(all_rings):
    """The outline of the boroughs together: every edge two boroughs share is dropped,
    and what is left is chained back into rings. Works because neighbouring boroughs
    share their boundary vertex for vertex."""
    count = collections.Counter()
    for ring in all_rings:
        for a, b in zip(ring, ring[1:]):
            if a != b:
                count[frozenset((a, b))] += 1
    following = collections.defaultdict(list)
    for ring in all_rings:
        for a, b in zip(ring, ring[1:]):
            if a != b and count[frozenset((a, b))] == 1:
                following[a].append(b)
    out = []
    while following:
        start = next(iter(following))
        ring, here = [start], start
        while True:
            there = following[here].pop()
            if not following[here]:
                del following[here]
            ring.append(there)
            here = there
            if here == start or here not in following:
                break
        if ring[0] == ring[-1] and len(ring) > 3:
            out.append(ring)
    return out


def simplify(points, tolerance):
    """Douglas-Peucker, in degrees."""
    if len(points) < 3:
        return points
    (x1, y1), (x2, y2) = points[0], points[-1]
    far, at = 0.0, 0
    for i in range(1, len(points) - 1):
        x0, y0 = points[i]
        if (x1, y1) == (x2, y2):
            d = math.hypot(x0 - x1, y0 - y1)
        else:
            d = abs((y2 - y1) * x0 - (x2 - x1) * y0 + x2 * y1 - y2 * x1) / math.hypot(x2 - x1, y2 - y1)
        if d > far:
            far, at = d, i
    if far <= tolerance:
        return [points[0], points[-1]]
    return simplify(points[:at + 1], tolerance)[:-1] + simplify(points[at:], tolerance)


def signed_area(ring):
    return sum(a[0] * b[1] - b[0] * a[1] for a, b in zip(ring, ring[1:])) / 2


def land_border(outline, shore):
    """The runs of the outline whose points the shoreline boundaries share: the city line
    where it crosses land."""
    runs = []
    for ring in outline:
        points = ring[:-1]
        if all(p in shore for p in points):
            continue
        start = next(i for i, p in enumerate(points) if p not in shore)
        points = points[start:] + points[:start]          # begin off the land border
        run = []
        for p in points + [points[0]]:
            if p in shore:
                run.append(p)
            else:
                if len(run) >= 2 and length(run) >= MIN_BORDER:
                    runs.append(run)
                run = []
    return [simplify(run, TOLERANCE) for run in runs]


def length(run):
    """Metres along a run of points, near enough at New York's latitude."""
    return sum(math.hypot((b[0] - a[0]) * 84_400, (b[1] - a[1]) * 111_320)
               for a, b in zip(run, run[1:]))


def main():
    whole = dissolve(list(rings(fetch(WITH_WATER))))
    shore = set(rings_points(fetch(SHORELINE)))
    border = land_border(whole, shore)
    with open(OUT_LINE, "w", encoding="utf-8") as fh:
        json.dump({"type": "Feature", "properties": {}, "geometry": {
            "type": "MultiLineString",
            "coordinates": [[[round(x, 5), round(y, 5)] for x, y in run] for run in border]}},
            fh, separators=(",", ":"))
        fh.write("\n")
    outline = [simplify(r, TOLERANCE) for r in whole]
    outline = [r for r in outline if len(r) >= 4]
    # Each ring is an outer ring, wound anticlockwise as GeoJSON asks.
    polygons = [[[[round(x, 5), round(y, 5)] for x, y in (r if signed_area(r) > 0 else r[::-1])]]
                for r in outline]
    feature = {"type": "Feature", "properties": {},
               "geometry": {"type": "MultiPolygon", "coordinates": polygons}}
    with open(OUT, "w", encoding="utf-8") as fh:
        json.dump(feature, fh, separators=(",", ":"))
        fh.write("\n")
    points = sum(len(p[0]) for p in polygons)
    print(f"wrote {len(polygons)} rings, {points} points, to {os.path.relpath(OUT, ROOT)} "
          f"({os.path.getsize(OUT) // 1024} KB), and {len(border)} stretches of land border "
          f"to {os.path.relpath(OUT_LINE, ROOT)}")


if __name__ == "__main__":
    main()
