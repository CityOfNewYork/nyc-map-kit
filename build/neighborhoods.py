#!/usr/bin/env python3
"""
nyc-map-kit — the neighbourhood names OTI's basemap draws, for the Protomaps basemap.

    python3 build/neighborhoods.py

Writes app/public/neighborhoods.geojson: a point for every neighbourhood name in the
Neighborhoods layer of OTI's NYC Basemap v3 tiles, the names the City's maps on that
basemap show. They are City Planning's Neighborhood Names, the points from its map
"New York: A City of Neighborhoods", as OTI keeps them. The layer carries a name and
nothing else.

The tiles from z14 carry every name; further out they carry fewer. A name near a tile's
edge can repeat in the next tile's buffer, so a name is kept once per place, not once
per tile. Two places can share a name, as Chelsea does in Manhattan and Staten Island.

A few names are then edited (REMOVE, RENAME, ADD), each to the name City Planning's 2020
Neighborhood Tabulation Areas give the place, the names search matches (build/places.py),
with each point inside its area.

Rerun it when OTI republishes the basemap. Stdlib only. No installs.
"""

import concurrent.futures
import gzip
import json
import math
import os
import struct
import urllib.error
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "app", "public", "neighborhoods.geojson")

TILES = ("https://tiles.arcgis.com/tiles/yG5s3afENB5iO9fj/arcgis/rest/services/"
         "NYC_Basemap_v3/VectorTileServer/tile/{z}/{y}/{x}.pbf")
LAYER = "Neighborhoods"
ZOOM = 14
BBOX = (-74.2591, 40.4774, -73.7004, 40.9176)   # west, south, east, north: the five boroughs
SAME_PLACE = 4                                   # decimal places: about 10 m
USER_AGENT = "nyc-map-kit neighborhoods.py (NYC OTI; https://github.com/CityOfNewYork/nyc-map-kit)"

# The tabulation area there is Hell's Kitchen, added below; OTI's Clinton point is in
# Chelsea-Hudson Yards.
REMOVE = ["Clinton"]
RENAME = {"Central Harlem": "Harlem"}
# Name, longitude, latitude; the comment says where the point is from.
ADD = [
    ("Hell's Kitchen", -73.99238, 40.76442),   # OpenStreetMap
    ("Kips Bay", -73.97708, 40.73955),         # OpenStreetMap
    ("Hudson Square", -74.00798, 40.72680),    # OpenStreetMap
    ("Two Bridges", -73.99223, 40.71129),      # OpenStreetMap
    ("Union Square", -73.99019, 40.73607),     # OpenStreetMap
    ("Sugar Hill", -73.94361, 40.82755),       # OpenStreetMap
    ("Tremont", -73.89176, 40.84692),          # the area's own point, in places.json
    ("South Slope", -73.98500, 40.66100),      # Seventh Avenue and 17th Street
]


def tiles(z):
    """Every tile at zoom z that covers BBOX, as (x, y)."""
    n = 2 ** z
    def x(lon): return int((lon + 180) / 360 * n)
    def y(lat):
        r = math.radians(lat)
        return int((1 - math.log(math.tan(r) + 1 / math.cos(r)) / math.pi) / 2 * n)
    return [(tx, ty) for tx in range(x(BBOX[0]), x(BBOX[2]) + 1)
                     for ty in range(y(BBOX[3]), y(BBOX[1]) + 1)]


def fetch(xy):
    x, y = xy
    req = urllib.request.Request(TILES.format(z=ZOOM, x=x, y=y), headers={"User-Agent": USER_AGENT})
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            data = resp.read()
    except urllib.error.HTTPError as err:
        if err.code == 404:        # no tile: open water
            return x, y, b""
        raise
    return x, y, gzip.decompress(data) if data[:2] == b"\x1f\x8b" else data


# ---- the part of a Mapbox Vector Tile this needs: a layer's point features and their
# ---- string properties (spec: github.com/mapbox/vector-tile-spec/tree/master/2.1)

def varint(buf, pos):
    v = shift = 0
    while True:
        b = buf[pos]; pos += 1
        v |= (b & 0x7F) << shift; shift += 7
        if not b & 0x80:
            return v, pos


def fields(buf):
    """Yield (field number, value) for each field of a protobuf message."""
    pos = 0
    while pos < len(buf):
        key, pos = varint(buf, pos)
        number, wire = key >> 3, key & 7
        if wire == 0:
            value, pos = varint(buf, pos)
        elif wire == 2:
            size, pos = varint(buf, pos)
            value, pos = buf[pos:pos + size], pos + size
        elif wire == 5:
            value, pos = buf[pos:pos + 4], pos + 4
        elif wire == 1:
            value, pos = buf[pos:pos + 8], pos + 8
        else:
            raise ValueError(f"unknown wire type {wire}")
        yield number, value


def packed(buf):
    out, pos = [], 0
    while pos < len(buf):
        v, pos = varint(buf, pos); out.append(v)
    return out


def zigzag(n):
    return (n >> 1) ^ -(n & 1)


def value(buf):
    for number, v in fields(buf):
        if number == 1: return v.decode()
        if number == 2: return struct.unpack("<f", v)[0]
        if number == 3: return struct.unpack("<d", v)[0]
        return v


def points(tile, layer_name):
    """Yield (properties, x, y, extent) for each point feature in the named layer."""
    for number, layer in fields(tile):
        if number != 3:
            continue
        name, keys, values, features, extent = None, [], [], [], 4096
        for f, v in fields(layer):
            if f == 1: name = v.decode()
            elif f == 2: features.append(v)
            elif f == 3: keys.append(v.decode())
            elif f == 4: values.append(value(v))
            elif f == 5: extent = v
        if name != layer_name:
            continue
        for feature in features:
            tags, geometry, kind = [], [], 0
            for f, v in fields(feature):
                if f == 2: tags = packed(v)
                elif f == 3: kind = v
                elif f == 4: geometry = packed(v)
            if kind != 1 or len(geometry) < 3:
                continue
            props = {keys[tags[i]]: values[tags[i + 1]] for i in range(0, len(tags), 2)}
            yield props, zigzag(geometry[1]), zigzag(geometry[2]), extent


def lon_lat(x, y, px, py, extent):
    n = 2 ** ZOOM
    fx, fy = (x + px / extent) / n, (y + py / extent) / n
    return fx * 360 - 180, math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * fy))))


def main():
    places = {}
    with concurrent.futures.ThreadPoolExecutor(8) as pool:
        for x, y, tile in pool.map(fetch, tiles(ZOOM)):
            for props, px, py, extent in points(tile, LAYER):
                name = " ".join(str(props.get("_name", "")).split())   # "High  Bridge"
                if not name or not 0 <= px < extent or not 0 <= py < extent:
                    continue        # in the tile's buffer: the neighbouring tile has it
                lon, lat = lon_lat(x, y, px, py, extent)
                key = (name, round(lon, SAME_PLACE - 1), round(lat, SAME_PLACE - 1))
                places.setdefault(key, (name, round(lon, 5), round(lat, 5)))
    if not places:
        raise SystemExit(f"the tiles held no {LAYER} layer")
    names = {name for name, _, _ in places.values()}
    stale = [n for n in [*REMOVE, *RENAME] if n not in names] + [n for n, _, _ in ADD if n in names]
    if stale:
        raise SystemExit(f"the edits no longer fit OTI's names: {', '.join(stale)}")
    edited = [(RENAME.get(name, name), lon, lat)
              for name, lon, lat in places.values() if name not in REMOVE] + ADD
    features = [
        {"type": "Feature", "properties": {"name": name},
         "geometry": {"type": "Point", "coordinates": [lon, lat]}}
        for name, lon, lat in sorted(edited)
    ]
    with open(OUT, "w", encoding="utf-8") as fh:
        json.dump({"type": "FeatureCollection", "features": features}, fh,
                  separators=(",", ":"))
        fh.write("\n")
    print(f"wrote {len(features)} neighbourhood names to {os.path.relpath(OUT, ROOT)} "
          f"({os.path.getsize(OUT) // 1024} KB)")


if __name__ == "__main__":
    main()
