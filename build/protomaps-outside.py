#!/usr/bin/env python3
"""
nyc-map-kit — strip the Protomaps basemap down to what the map shows outside the city.

    python3 build/protomaps-outside.py          # run by build/protomaps.sh

Rewrites app/public/nyc.pmtiles in place. Outside the city line (app/src/core/city-limits.json)
the map shows the land and water, the parks, the highways, and from STREETS_ZOOM the other
streets, which the style draws pale. Everything else that lies wholly outside the line is
dropped from the file: buildings, place names, points of interest, and the streets below
STREETS_ZOOM. At the opening zoom about 70% of the bytes a browser downloads describe things
outside the city, so dropping them makes the map lighter to load, and the browser has
nothing to hide.

Roads are cut at the city line. The part inside the city is kept as it was; the part
outside is kept only where the map shows it, and marked `outside_city`, so the style can
draw it pale without testing anything in the browser. Other features are never cut: a
tile the line does not cross is decided whole, and in a tile it crosses each separate
shape is tested vertex by vertex and dropped if it lies wholly outside the city. (Up to
z14 Protomaps merges many streets or buildings into one feature, which is why shapes, not
features, are tested.) So a building or park that crosses the line keeps its outside part.

Writes the result through an MBTiles file, which `pmtiles convert` turns back into a
PMTiles archive, so it needs the pmtiles CLI on PATH, as build/protomaps.sh does.

Stdlib only. No installs.
"""

import gzip
import json
import math
import os
import sqlite3
import struct
import subprocess
import sys
import tempfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TILES = os.path.join(ROOT, "app", "public", "nyc.pmtiles")
CITY = os.path.join(ROOT, "app", "src", "core", "city-limits.json")

# What stays outside the city: the land and the water whole, highways, parks, and piers,
# which shape the waterfront. Each layer's features are filtered on their `kind`. Woods,
# scrub and lawns are left out: in New Jersey and Westchester they are most of the green,
# and at the opening zoom they would add about 160 KB of tiles to the parks' 45 KB.
PARKS = {"park", "national_park", "nature_reserve", "protected_area", "golf_course",
         "cemetery", "playground", "village_green", "allotments"}
KEEP_OUTSIDE = {"earth": None, "water": None, "landuse": PARKS | {"pier"}}
# Roads outside the city: highways at every zoom, other streets from this zoom, the one
# at which the tiles first carry local streets, so the blocks outside the city fill in at
# the same zoom as those inside it (and as on the NYC basemap). Below it the tiles carry
# major roads, which would add bytes to the views that show the whole city.
STREETS_ZOOM = 12
# The mark on a road's part outside the city: a boolean property.
MARK = "outside_city"


# ------------------------------------------------------------------------- the city line

def load_city():
    feature = json.load(open(CITY, encoding="utf-8"))
    rings = [polygon[0] for polygon in feature["geometry"]["coordinates"]]
    edges = [(r[i], r[i + 1]) for r in rings for i in range(len(r) - 1)]
    xs = [p[0] for r in rings for p in r]
    ys = [p[1] for r in rings for p in r]
    return edges, (min(xs), min(ys), max(xs), max(ys))


EDGES, CITY_BOX = load_city()


def inside(lon, lat):
    if not (CITY_BOX[0] <= lon <= CITY_BOX[2] and CITY_BOX[1] <= lat <= CITY_BOX[3]):
        return False
    hit = False
    for (x1, y1), (x2, y2) in EDGES:
        if (y1 > lat) != (y2 > lat) and lon < (x2 - x1) * (lat - y1) / (y2 - y1) + x1:
            hit = not hit
    return hit


def tile_box(z, x, y):
    n = 2 ** z
    lat = lambda t: math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * t / n))))
    return x / n * 360 - 180, lat(y + 1), (x + 1) / n * 360 - 180, lat(y)


def line_crosses(box):
    """Whether any edge of the city line passes through the box."""
    w, s, e, n = box
    def side(a, b, c):
        return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])
    corners = [(w, s), (e, s), (e, n), (w, n)]
    for a, b in EDGES:
        if max(a[0], b[0]) < w or min(a[0], b[0]) > e or max(a[1], b[1]) < s or min(a[1], b[1]) > n:
            continue
        if w <= a[0] <= e and s <= a[1] <= n:
            return True
        for i in range(4):
            c, d = corners[i], corners[(i + 1) % 4]
            if side(a, b, c) * side(a, b, d) < 0 and side(c, d, a) * side(c, d, b) < 0:
                return True
    return False


# --------------------------------------------------------------------- protobuf, by hand

def varint(buf, pos):
    value = shift = 0
    while True:
        byte = buf[pos]
        pos += 1
        value |= (byte & 0x7F) << shift
        shift += 7
        if not byte & 0x80:
            return value, pos


def fields(buf):
    """(field number, value, raw bytes of the whole field) for each field in a message."""
    pos = 0
    while pos < len(buf):
        start = pos
        key, pos = varint(buf, pos)
        number, wire = key >> 3, key & 7
        if wire == 0:
            value, pos = varint(buf, pos)
        elif wire == 2:
            length, pos = varint(buf, pos)
            value = buf[pos:pos + length]
            pos += length
        elif wire == 5:
            value, pos = buf[pos:pos + 4], pos + 4
        elif wire == 1:
            value, pos = buf[pos:pos + 8], pos + 8
        else:
            raise ValueError(f"wire type {wire}")
        yield number, value, buf[start:pos]


def packed(buf):
    out, pos = [], 0
    while pos < len(buf):
        value, pos = varint(buf, pos)
        out.append(value)
    return out


def encode_varint(value):
    out = bytearray()
    while True:
        byte = value & 0x7F
        value >>= 7
        if value:
            out.append(byte | 0x80)
        else:
            out.append(byte)
            return bytes(out)


def string_value(buf):
    for number, value, _ in fields(buf):
        if number == 1:
            return value.decode()
    return None


# ------------------------------------------------------------------------ vector tiles

def feature_kind(feature, keys, values):
    for number, value, _ in fields(feature):
        if number == 2:
            tags = packed(value)
            for i in range(0, len(tags), 2):
                if keys[tags[i]] == "kind":
                    return values[tags[i + 1]]
    return None


def parts(geometry, kind):
    """A feature's geometry as separate shapes, each a list of rings or lines of absolute
    tile coordinates. A polygon's holes stay with the ring before them."""
    shapes, current, i, cx, cy = [], None, 0, 0, 0
    while i < len(geometry):
        command, count = geometry[i] & 7, geometry[i] >> 3
        i += 1
        if command == 7:
            continue
        for k in range(count):
            cx += (geometry[i] >> 1) ^ -(geometry[i] & 1)
            cy += (geometry[i + 1] >> 1) ^ -(geometry[i + 1] & 1)
            i += 2
            if command == 1:
                current = [(cx, cy)]
                shapes.append([current])
            else:
                current.append((cx, cy))
    if kind != 3:
        return shapes
    # Rings: each exterior ring (positive area in tile coordinates) starts a shape.
    grouped = []
    for (ring,) in shapes:
        if area(ring) > 0 or not grouped:
            grouped.append([ring])
        else:
            grouped[-1].append(ring)
    return grouped


def area(ring):
    return sum(a[0] * b[1] - b[0] * a[1] for a, b in zip(ring, ring[1:] + ring[:1])) / 2


def encode(shapes, kind):
    """Shapes back to a geometry command stream, the cursor carried from one to the next."""
    out, cx, cy = [], 0, 0
    def zz(n):
        return n * 2 if n >= 0 else -n * 2 - 1
    if kind == 1:                     # points: one MoveTo carrying every point, as the spec asks
        out.append(len(shapes) << 3 | 1)
        for (((x, y),),) in shapes:
            out += [zz(x - cx), zz(y - cy)]
            cx, cy = x, y
        return b"".join(encode_varint(v) for v in out)
    for shape in shapes:
        for line in shape:
            x, y = line[0]
            out += [1 << 3 | 1, zz(x - cx), zz(y - cy)]
            cx, cy = x, y
            rest = line[1:]
            if rest:
                out.append(len(rest) << 3 | 2)
                for x, y in rest:
                    out += [zz(x - cx), zz(y - cy)]
                    cx, cy = x, y
            if kind == 3:
                out.append(1 << 3 | 7)
    return b"".join(encode_varint(v) for v in out)


def shape_outside(shape, z, x, y, extent):
    """True if every vertex of the shape lies outside the city."""
    n = 2 ** z
    for line in shape:
        for px, py in line:
            lon = (x + px / extent) / n * 360 - 180
            lat = math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * (y + py / extent) / n))))
            if inside(lon, lat):
                return False
    return True


def inside_part(feature, z, x, y, extent):
    """The feature with its shapes wholly outside the city dropped, or None if none is left."""
    kind, geometry = 1, None
    for number, value, _ in fields(feature):
        if number == 3:
            kind = value
        elif number == 4:
            geometry = packed(value)
    if geometry is None:
        return None
    shapes = parts(geometry, kind)
    kept = [shape for shape in shapes if not shape_outside(shape, z, x, y, extent)]
    if not kept:
        return None
    if len(kept) == len(shapes):
        return feature
    body = bytearray()
    for number, value, field in fields(feature):
        if number != 4:
            body += field
    geometry = encode(kept, kind)
    return bytes(body) + encode_varint(4 << 3 | 2) + encode_varint(len(geometry)) + geometry


def geometry_kind(feature):
    for number, value, _ in fields(feature):
        if number == 3:
            return value
    return 1


def tile_edges(z, x, y, extent):
    """The city line in this tile's coordinates."""
    n = 2 ** z
    def project(lon, lat):
        r = math.radians(lat)
        tx = (lon + 180) / 360 * n
        ty = (1 - math.log(math.tan(r) + 1 / math.cos(r)) / math.pi) / 2 * n
        return (tx - x) * extent, (ty - y) * extent
    return [(project(*a), project(*b)) for a, b in EDGES]


def inside_tile(px, py, edges):
    hit = False
    for (x1, y1), (x2, y2) in edges:
        if (y1 > py) != (y2 > py) and px < (x2 - x1) * (py - y1) / (y2 - y1) + x1:
            hit = not hit
    return hit


def crossings(a, b, edges):
    """Where the segment a-b crosses the city line, as fractions along it."""
    out = []
    (ax, ay), (bx, by) = a, b
    for (cx, cy), (dx, dy) in edges:
        if max(ax, bx) < min(cx, dx) or min(ax, bx) > max(cx, dx):
            continue
        if max(ay, by) < min(cy, dy) or min(ay, by) > max(cy, dy):
            continue
        den = (bx - ax) * (dy - cy) - (by - ay) * (dx - cx)
        if den == 0:
            continue
        t = ((cx - ax) * (dy - cy) - (cy - ay) * (dx - cx)) / den
        u = ((cx - ax) * (by - ay) - (cy - ay) * (bx - ax)) / den
        if 0 < t < 1 and 0 <= u <= 1:
            out.append(t)
    return sorted(out)


def with_geometry(feature, shapes, kind):
    body = bytearray()
    for number, value, field in fields(feature):
        if number != 4:
            body += field
    geometry = encode(shapes, kind)
    return bytes(body) + encode_varint(4 << 3 | 2) + encode_varint(len(geometry)) + geometry


def split_at_line(feature, edges):
    """A line feature cut where it crosses the city line: (inside part, outside part), each
    a feature or None."""
    kind, geometry = 1, []
    for number, value, _ in fields(feature):
        if number == 3:
            kind = value
        elif number == 4:
            geometry = packed(value)
    if kind != 2:
        return feature, None
    pieces = {True: [], False: []}
    for (line,) in parts(geometry, kind):
        state = inside_tile(*line[0], edges)
        current = [line[0]]
        for a, b in zip(line, line[1:]):
            for t in crossings(a, b, edges):
                c = (round(a[0] + (b[0] - a[0]) * t), round(a[1] + (b[1] - a[1]) * t))
                current.append(c)
                pieces[state].append(current)
                current, state = [c], not state
            current.append(b)
        pieces[state].append(current)
    def clean(lines):
        out = []
        for line in lines:
            line = [p for i, p in enumerate(line) if i == 0 or p != line[i - 1]]
            if len(line) >= 2:
                out.append([line])
        return out
    inner, outer = clean(pieces[True]), clean(pieces[False])
    return (with_geometry(feature, inner, kind) if inner else None,
            with_geometry(feature, outer, kind) if outer else None)


def marked(feature, key, value):
    """The feature with one more tag, key and value given as indexes into its layer."""
    tags, rest = [], bytearray()
    for number, v, field in fields(feature):
        if number == 2:
            tags = packed(v)
        else:
            rest += field
    data = b"".join(encode_varint(t) for t in tags + [key, value])
    return encode_varint(2 << 3 | 2) + encode_varint(len(data)) + data + bytes(rest)


def trim(tile, z, x, y, line_crosses_tile):
    """The tile with everything outside the city dropped that the map does not show there,
    and the roads cut at the line with their outside parts marked."""
    out = bytearray()
    for number, layer, raw in fields(tile):
        if number != 3:
            out += raw
            continue
        name, keys, values, extent = None, [], [], 4096
        for n, value, _ in fields(layer):
            if n == 1:
                name = value.decode()
            elif n == 3:
                keys.append(value.decode())
            elif n == 4:
                values.append(string_value(value))
            elif n == 5:
                extent = value
        if name in KEEP_OUTSIDE and KEEP_OUTSIDE[name] is None:
            out += raw
            continue
        kinds = KEEP_OUTSIDE.get(name, set())
        body, kept, marks, edges = bytearray(), 0, 0, None
        for n, value, field in fields(layer):
            if n != 2:
                body += field
                continue
            kind = feature_kind(value, keys, values)
            if name == "roads":
                if not line_crosses_tile:
                    inner, outer = None, value
                elif geometry_kind(value) == 2:
                    edges = edges or tile_edges(z, x, y, extent)
                    inner, outer = split_at_line(value, edges)
                else:
                    inner, outer = inside_part(value, z, x, y, extent), None
                if not (kind == "highway" or z >= STREETS_ZOOM):
                    outer = None
                pieces = [(inner, False), (outer, True)]
            elif kind in kinds:
                pieces = [(value, False)]
            elif line_crosses_tile:
                pieces = [(inside_part(value, z, x, y, extent), False)]
            else:
                pieces = []
            for feature, outside in pieces:
                if feature is None:
                    continue
                if outside:
                    feature = marked(feature, len(keys), len(values))
                    marks += 1
                body += encode_varint(2 << 3 | 2) + encode_varint(len(feature)) + feature
                kept += 1
        if marks:                       # the mark's key, and the value true (field 7)
            body += encode_varint(3 << 3 | 2) + encode_varint(len(MARK)) + MARK.encode()
            true = encode_varint(7 << 3) + encode_varint(1)
            body += encode_varint(4 << 3 | 2) + encode_varint(len(true)) + true
        if kept:
            out += encode_varint(3 << 3 | 2) + encode_varint(len(body)) + body
    return bytes(out)


# ----------------------------------------------------------------------------- PMTiles

def tile_zxy(tile_id):
    """A PMTiles tile id back to z/x/y, along the Hilbert curve the format uses."""
    acc = 0
    for z in range(32):
        count = 4 ** z
        if acc + count > tile_id:
            position, xy, s = tile_id - acc, [0, 0], 1
            while s < (1 << z):
                rx = 1 & (position // 2)
                ry = 1 & (position ^ rx)
                if ry == 0:
                    if rx == 1:
                        xy = [s - 1 - xy[0], s - 1 - xy[1]]
                    xy = [xy[1], xy[0]]
                xy[0] += s * rx
                xy[1] += s * ry
                position //= 4
                s *= 2
            return z, xy[0], xy[1]
        acc += count
    raise ValueError(tile_id)


def directory(buf):
    values = packed(gzip.decompress(buf))
    n, pos = values[0], 1
    ids, last = [], 0
    for _ in range(n):
        last += values[pos]
        pos += 1
        ids.append(last)
    runs = values[pos:pos + n]
    lengths = values[pos + n:pos + 2 * n]
    offsets, raw = [], values[pos + 2 * n:pos + 3 * n]
    for i in range(n):
        offsets.append(offsets[i - 1] + lengths[i - 1] if raw[i] == 0 and i > 0 else raw[i] - 1)
    return list(zip(ids, runs, lengths, offsets))


def read_pmtiles(path):
    with open(path, "rb") as fh:
        head = fh.read(127)
        if head[:7] != b"PMTiles" or head[7] != 3:
            raise SystemExit(f"{path} is not a PMTiles v3 archive")
        (root_off, root_len, meta_off, meta_len, leaf_off, _, data_off, _,
         _, _, _) = struct.unpack_from("<11Q", head, 8)
        if head[97] != 2 or head[98] != 2:
            raise SystemExit("expected gzip directories and tiles")
        minzoom, maxzoom = head[100], head[101]
        bounds = [v / 1e7 for v in struct.unpack_from("<4i", head, 102)]
        fh.seek(meta_off)
        metadata = json.loads(gzip.decompress(fh.read(meta_len)))

        def walk(offset, length):
            fh.seek(offset)
            for tile_id, run, size, at in directory(fh.read(length)):
                if run == 0:
                    yield from walk(leaf_off + at, size)
                else:
                    fh.seek(data_off + at)
                    data = fh.read(size)
                    for k in range(run):
                        yield tile_zxy(tile_id + k), data

        return metadata, minzoom, maxzoom, bounds, list(walk(root_off, root_len))


def main():
    metadata, minzoom, maxzoom, bounds, tiles = read_pmtiles(TILES)
    before = os.path.getsize(TILES)
    with tempfile.TemporaryDirectory() as tmp:
        mbtiles = os.path.join(tmp, "nyc.mbtiles")
        db = sqlite3.connect(mbtiles)
        db.execute("CREATE TABLE metadata (name TEXT, value TEXT)")
        db.execute("CREATE TABLE tiles (zoom_level INTEGER, tile_column INTEGER, "
                   "tile_row INTEGER, tile_data BLOB)")
        rows = {"format": "pbf", "minzoom": str(minzoom), "maxzoom": str(maxzoom),
                "bounds": ",".join(map(str, bounds)),
                "json": json.dumps({"vector_layers": metadata.get("vector_layers", [])})}
        for key, value in metadata.items():
            if key != "vector_layers" and isinstance(value, str):
                rows.setdefault(key, value)
        db.executemany("INSERT INTO metadata VALUES (?, ?)", rows.items())
        for (z, x, y), data in tiles:
            box = tile_box(z, x, y)
            crosses = line_crosses(box)
            if not crosses and inside((box[0] + box[2]) / 2, (box[1] + box[3]) / 2):
                out = data                                     # inside the city: untouched
            else:
                out = gzip.compress(trim(gzip.decompress(data), z, x, y, crosses), mtime=0)
            db.execute("INSERT INTO tiles VALUES (?, ?, ?, ?)", (z, x, 2 ** z - 1 - y, out))
        db.commit()
        db.close()
        trimmed = os.path.join(tmp, "nyc.pmtiles")
        subprocess.run(["pmtiles", "convert", "--quiet", mbtiles, trimmed], check=True)
        os.replace(trimmed, TILES)
    after = os.path.getsize(TILES)
    print(f"{len(tiles)} tiles: {before / 1e6:.0f} MB -> {after / 1e6:.0f} MB", file=sys.stderr)


if __name__ == "__main__":
    main()
