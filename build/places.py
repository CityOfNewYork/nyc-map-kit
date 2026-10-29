#!/usr/bin/env python3
"""
nyc-map-kit — the place names the search box knows without asking a geocoder.

    python3 build/places.py

Writes app/public/places.json: every borough, neighborhood and ZIP code in the city, each
with a representative point and a bounding box, so that "Harlem", "the Bronx" or "10027"
moves the map at once. Geoclient, which answers addresses and intersections, has no
neighborhood or ZIP layer and rejects those names.

    boroughs  City Planning's borough boundaries (shoreline), as city-limits.py uses
    nbhds     City Planning's 2020 Neighborhood Tabulation Areas, residential ones only.
              NTA names join neighborhoods with hyphens ("SoHo-Little Italy-Hudson
              Square"); each part becomes a name of its own. A few colloquial names
              are added by hand (NBHD_ALIASES).
    zips      The Health Department's Modified ZIP Code Tabulation Areas. One area can
              cover several ZIP codes ("10001, 10118"); each code gets the area's shape.
    ntas      Every 2020 NTA's name by its code ("MN0101"), parks and airports too.
              Geoclient gives an address's neighborhood by code only, and analytics
              reports it by name.

Keys are normalized the way app/src/logic/places.ts normalizes what a resident types.
The point is the centroid of the largest polygon; the box is the whole shape's.

Rerun it when City Planning or the Health Department republishes. Stdlib only.
"""

import json
import os
import re
import urllib.parse
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "app", "public", "places.json")

BOROUGHS = ("https://services5.arcgis.com/GfwWNkhOj9bNBqoJ/arcgis/rest/services/"
            "NYC_Borough_Boundary/FeatureServer/0/query")
# https://data.cityofnewyork.us/City-Government/2020-Neighborhood-Tabulation-Areas-NTAs-/9nt8-h7nd
NTAS = "https://data.cityofnewyork.us/resource/9nt8-h7nd.geojson"
# https://data.cityofnewyork.us/Health/Modified-Zip-Code-Tabulation-Areas-MODZCTA-/pri4-ifjk
ZIPS = "https://data.cityofnewyork.us/resource/pri4-ifjk.geojson"
USER_AGENT = "nyc-map-kit places.py (NYC OTI; https://github.com/CityOfNewYork/nyc-map-kit)"

# Single neighborhoods whose names contain a hyphen, so must not be split.
HYPHEN_KEEP = {"bedford stuyvesant", "prospect lefferts gardens"}

# Colloquial name -> the normalized key the NTA data already produced.
NBHD_ALIASES = {
    "bed stuy": "bedford stuyvesant",
    "bedstuy": "bedford stuyvesant",
    "fidi": "financial district",
    "lic": "long island city",
    "spanish harlem": "east harlem",
    "el barrio": "east harlem",
    "the village": "greenwich village",
}

BOROUGH_ALIASES = {"the bronx": "bronx"}


def fetch(url, params):
    req = urllib.request.Request(f"{url}?{urllib.parse.urlencode(params)}",
                                 headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=120) as resp:
        return json.load(resp)["features"]


def norm(s):
    """Lowercase; drop apostrophes ("Hell's" -> "hells"); other punctuation to spaces."""
    s = s.lower().replace("'", "").replace("\u2019", "")
    return re.sub(r"\s+", " ", re.sub(r"[^a-z0-9]+", " ", s)).strip()


def polygons(geom):
    return geom["coordinates"] if geom["type"] == "MultiPolygon" else [geom["coordinates"]]


def ring_centroid(ring):
    """Shoelace centroid and area of one ring."""
    a = cx = cy = 0.0
    for (x0, y0), (x1, y1) in zip(ring, ring[1:]):
        cross = x0 * y1 - x1 * y0
        a += cross
        cx += (x0 + x1) * cross
        cy += (y0 + y1) * cross
    if a == 0:
        return [sum(p[0] for p in ring) / len(ring), sum(p[1] for p in ring) / len(ring)], 0.0
    a *= 0.5
    return [cx / (6 * a), cy / (6 * a)], abs(a)


def shape(geom):
    """{c, bb}: centroid of the largest polygon's outer ring, and the whole bounding box."""
    best_c, best_a = None, -1.0
    xs, ys = [], []
    for poly in polygons(geom):
        c, a = ring_centroid(poly[0])
        if a > best_a:
            best_c, best_a = c, a
        for ring in poly:
            xs.extend(p[0] for p in ring)
            ys.extend(p[1] for p in ring)
    return {"c": [round(best_c[0], 5), round(best_c[1], 5)],
            "bb": [round(min(xs), 5), round(min(ys), 5), round(max(xs), 5), round(max(ys), 5)]}


def build_boroughs():
    feats = fetch(BOROUGHS, {"where": "1=1", "outFields": "BoroName", "outSR": 4326,
                             "geometryPrecision": 5, "f": "geojson"})
    if len(feats) != 5:
        raise SystemExit(f"boroughs: expected five, got {len(feats)}")
    out = {}
    for f in feats:
        name = f["properties"]["BoroName"]
        out[norm(name)] = {"d": name, **shape(f["geometry"])}
    for alias, target in BOROUGH_ALIASES.items():
        out[alias] = out[target]
    return out


def build_neighborhoods():
    """On a name shared by two NTAs, the larger one wins."""
    feats = fetch(NTAS, {"$where": "ntatype='0'", "$limit": 1000})
    best = {}
    for f in feats:
        p = f["properties"]
        area = float(p.get("shape_area") or 0)
        base = re.sub(r"\s*\([^)]*\)", "", p["ntaname"]).strip()
        parts = [base] if (norm(base) in HYPHEN_KEEP or "-" not in base) else base.split("-")
        geo = shape(f["geometry"])
        for part in parts:
            k = norm(part)
            if not k or (k in best and best[k][0] >= area):
                continue
            best[k] = (area, {"d": part.strip(), "b": p["boroname"], **geo})
    out = {k: v[1] for k, v in sorted(best.items())}
    for alias, target in NBHD_ALIASES.items():
        if target not in out:
            raise SystemExit(f"alias '{alias}': no neighborhood '{target}'")
        out[alias] = out[target]
    return out


def build_zips():
    feats = fetch(ZIPS, {"$limit": 1000})
    out = {}
    for f in feats:
        geo = shape(f["geometry"])
        for z in re.findall(r"\b\d{5}\b", f["properties"].get("label") or ""):
            if z != "99999":
                out[z] = geo
    return dict(sorted(out.items()))


def build_ntas():
    rows = fetch(NTAS, {"$select": "nta2020,ntaname", "$limit": 1000})
    return dict(sorted((r["properties"]["nta2020"], r["properties"]["ntaname"]) for r in rows))


def main():
    places = {"boroughs": build_boroughs(), "nbhds": build_neighborhoods(), "zips": build_zips(),
              "ntas": build_ntas()}
    with open(OUT, "w") as f:
        json.dump(places, f, separators=(",", ":"))
        f.write("\n")
    print(f"places: {len(places['boroughs'])} borough names, {len(places['nbhds'])} "
          f"neighborhood names, {len(places['zips'])} ZIP codes, {len(places['ntas'])} NTAs "
          f"-> {os.path.relpath(OUT, ROOT)}")


if __name__ == "__main__":
    main()
