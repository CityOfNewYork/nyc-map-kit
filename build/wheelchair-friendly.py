#!/usr/bin/env python3
"""
nyc-map-kit — data pipeline for the wheelchair friendly restaurants map.

    python3 build/wheelchair-friendly.py

Reads every restaurant from the City's Wheelchair Friendly Restaurants feature layer and
writes

    app/public/wheelchair-friendly/sites.geojson     one Point feature per restaurant

in the block's point-data shape (app/src/logic/types.ts), with the fields
app/public/wheelchair-friendly/config.json shows. The source already carries coordinates,
so there is no geocoding step.

The layer answers at most PAGE records per request, so it is read a page at a time in
OBJECTID order. Each restaurant's `RecordID` is its Department of Health permit number
(CAMIS), which stays the same across refreshes, so it is the feature's `id`.

The source writes street addresses in capitals with runs of spaces ("14 EAST   42
STREET"). They are written here in title case with single spaces ("14 East 42 Street"),
followed by the city, state and ZIP as the source gives them. Names are kept as the source
spells them: a business's name has its own capitals ("McDonald's", "BXL") that no rule
can recover.

The file's `generated` date, which each card shows as "Updated", is the day the layer's
data was last edited, as the layer reports it, in New York time.

The build FAILS (exit 1) if the layer returns fewer than MIN_FEATURES restaurants, so a
broken query cannot quietly ship a near-empty map.

Stdlib only. No installs.
"""

import json
import os
import re
import sys
import urllib.parse
import urllib.request
from datetime import datetime
from zoneinfo import ZoneInfo

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "app", "public", "wheelchair-friendly", "sites.geojson")

# Public, no key needed. The layer behind the City's Wheelchair Friendly Restaurant Finder.
SOURCE = ("https://services6.arcgis.com/yG5s3afENB5iO9fj/arcgis/rest/services/"
          "Wheelchair_Friendly_Restaurant_PROD_view/FeatureServer/0")
USER_AGENT = ("nyc-map-kit wheelchair-friendly.py (NYC OTI; "
              "https://github.com/CityOfNewYork/nyc-map-kit)")
PAGE = 2000             # the layer's maxRecordCount
MIN_FEATURES = 10000    # the gate: 12,053 restaurants in October 2026


def clean(value):
    """One cell as text, whitespace trimmed and collapsed."""
    return re.sub(r"\s+", " ", str(value or "")).strip()


ORDINAL = re.compile(r"^\d+(ST|ND|RD|TH)$", re.I)


def street(value):
    """"14 EAST   42 STREET" as "14 East 42 Street". Ordinals are lower case ("1ST" is "1st");
    other words that start with a digit are kept as written ("686C", "40-06")."""
    return " ".join(w[:1].upper() + w[1:].lower() if w[:1].isalpha()
                    else w.lower() if ORDINAL.match(w) else w
                    for w in clean(value).split(" "))


def get(url):
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=60) as resp:
        data = json.load(resp)
    if "error" in data:
        sys.exit("FAIL: the layer answered with an error: %s" % data["error"])
    return data


def edited():
    """The day the layer's data was last edited, "2026-10-06"."""
    ms = get("%s?f=json" % SOURCE)["editingInfo"]["dataLastEditDate"]
    return datetime.fromtimestamp(ms / 1000, ZoneInfo("America/New_York")).date().isoformat()


def fetch(offset):
    query = urllib.parse.urlencode({
        "where": "1=1", "outFields": "*", "outSR": "4326", "orderByFields": "OBJECTID",
        "resultOffset": offset, "resultRecordCount": PAGE, "f": "geojson",
    })
    return get("%s/query?%s" % (SOURCE, query)).get("features", [])


def fetch_all():
    features, offset = [], 0
    while True:
        page = fetch(offset)
        features += page
        if len(page) < PAGE:
            return features
        offset += PAGE


def feature(src, seq):
    p = src["properties"]
    record = clean(p.get("RecordID"))
    address = ", ".join(part for part in (street(p.get("Address_Line_1")),
                                          clean(p.get("Address_Line_2"))) if part)
    props = {
        "id": record,
        "org": clean(p.get("Name")) or "Restaurant",
        "org_id": record,
        "org_type": clean(p.get("Cuisine")),
        "address": address,
        "borough": clean(p.get("Borough")),
    }
    lon, lat = src["geometry"]["coordinates"]
    return {
        "type": "Feature",
        "id": seq,                    # numeric id: MapLibre feature-state needs one
        "geometry": {"type": "Point", "coordinates": [round(lon, 5), round(lat, 5)]},
        # Empty fields are left out: the card skips them either way, and the file is smaller.
        "properties": {k: v for k, v in props.items() if v},
    }


def main():
    sources = [f for f in fetch_all() if f.get("geometry")]
    if len(sources) < MIN_FEATURES:
        sys.exit("FAIL: %d restaurants (the gate is %d). Nothing written."
                 % (len(sources), MIN_FEATURES))

    features = [feature(f, i + 1) for i, f in enumerate(sources)]
    ids = [f["properties"]["id"] for f in features]
    if len(set(ids)) != len(ids) or not all(ids):
        sys.exit("FAIL: restaurant ids are missing or repeated. Nothing written.")

    stamp = edited()
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as fh:
        json.dump({"type": "FeatureCollection", "source": SOURCE, "generated": stamp,
                   "features": features}, fh, ensure_ascii=False, separators=(",", ":"))
        fh.write("\n")

    boroughs = {}
    for f in features:
        borough = f["properties"].get("borough", "")
        boroughs[borough] = boroughs.get(borough, 0) + 1
    print("  restaurants  %d" % len(features))
    for borough, n in sorted(boroughs.items(), key=lambda kv: -kv[1]):
        print("    %5d  %s" % (n, borough))
    print("  cuisines     %d" % len({f["properties"].get("org_type") for f in features}))
    print("  edited       %s" % stamp)
    print("\n  %s    %.1f KB" % (os.path.relpath(OUT, ROOT), os.path.getsize(OUT) / 1024))


if __name__ == "__main__":
    main()
