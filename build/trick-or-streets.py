#!/usr/bin/env python3
"""
nyc-map-kit — data pipeline for the Trick-or-Streets map.

    python3 build/trick-or-streets.py

Reads NYC DOT's Trick-or-Streets events and the streets they close from the two feature
layers behind DOT's own map, and writes

    app/public/trick-or-streets/events.geojson     one Point feature per event
    app/public/trick-or-streets/streets.geojson    one LineString per closed street segment

The events are in the block's point-data shape (app/src/logic/types.ts), with the fields
app/src/trick-or-streets/logic/events.ts reads:

    type      "signature" or "partner". DOT's map draws its Signature events as one kind
              and every other type (community, open street, plaza and school partners,
              parades) as the other; so does this one.
    date      "2026-10-31"
    starts    "16:00", New York time
    ends      "20:00"
    host      the partner organizations, as DOT lists them

Each event's `id` is its name and day ("corona-plaza-10-31"), and its block where one
name holds several on one day, so a link to one event's card keeps working when DOT
republishes the layer and its OBJECTIDs change. The events are written in date order,
then by start time.

Each street segment carries the `id` of its event, matched on the name, streets, borough,
day and times the two layers share. The build FAILS (exit 1) if a segment matches no event
or more than one, if a date or time cannot be read, or if the layer returns fewer than
MIN_EVENTS events, so a broken query cannot quietly ship a near-empty map.

The file's `generated` date, which each card shows as "Updated", is the day the points
layer's data was last edited, as the layer reports it, in New York time.

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
OUT_DIR = os.path.join(ROOT, "app", "public", "trick-or-streets")

# Public, no key needed. The layers DOT's Trick-or-Streets map draws.
LAYERS = "https://services.arcgis.com/wmZOI9vyUBq1zTZx/arcgis/rest/services"
POINTS = LAYERS + "/TrickOrStreet_Point_View/FeatureServer/0"
LINES = LAYERS + "/TrickOrStreet_Line_View/FeatureServer/0"
USER_AGENT = ("nyc-map-kit trick-or-streets.py (NYC OTI; "
              "https://github.com/CityOfNewYork/nyc-map-kit)")
MIN_EVENTS = 100        # the gate: 177 events in October 2026

# The fields both layers carry, which together name one event.
SHARED = ("Open_Street_Plaza_Parade_Name", "On_Street", "From_Street", "To_Street",
          "Borough", "Event_Date", "Start_Time", "End_Time")


def clean(value):
    """One cell as text, whitespace trimmed and collapsed. "n/a" counts as empty."""
    text = re.sub(r"\s+", " ", str(value or "")).strip()
    return "" if text.lower() == "n/a" else text


def get(url):
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=60) as resp:
        data = json.load(resp)
    if "error" in data:
        sys.exit("FAIL: the layer answered with an error: %s" % data["error"])
    return data


def edited(layer):
    """The day the layer's data was last edited, "2026-10-06"."""
    ms = get("%s?f=json" % layer)["editingInfo"]["dataLastEditDate"]
    return datetime.fromtimestamp(ms / 1000, ZoneInfo("America/New_York")).date().isoformat()


def fetch(layer):
    """Every feature in the layer. Each holds a few hundred, under its 2,000 a page."""
    query = urllib.parse.urlencode({
        "where": "1=1", "outFields": "*", "outSR": "4326", "orderByFields": "OBJECTID",
        "f": "geojson",
    })
    data = get("%s/query?%s" % (layer, query))
    if data.get("exceededTransferLimit") or data.get("properties", {}).get("exceededTransferLimit"):
        sys.exit("FAIL: %s holds more features than one page. Nothing written." % layer)
    return [f for f in data.get("features", []) if f.get("geometry")]


def day(value):
    """"Saturday, October 31, 2026" as "2026-10-31"."""
    try:
        return datetime.strptime(clean(value), "%A, %B %d, %Y").date().isoformat()
    except ValueError:
        sys.exit("FAIL: a date cannot be read: %r. Nothing written." % value)


def clock(value):
    """"4:00 PM", or "4:00PM", as "16:00"."""
    match = re.fullmatch(r"(\d{1,2}):(\d{2}) ?([AP])M", clean(value).upper())
    if not match or not 1 <= int(match[1]) <= 12:
        sys.exit("FAIL: a time cannot be read: %r. Nothing written." % value)
    hour = int(match[1]) % 12 + (12 if match[3] == "P" else 0)
    return "%02d:%s" % (hour, match[2])


def slug(text):
    return re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")


def place(p):
    """"Hillel Place, Kenilworth Place to Flatbush Avenue, Brooklyn", or for an event at
    one corner, "Goulden Avenue at Mosholu Parkway, Bronx"."""
    on, start, end = clean(p.get("On_Street")), clean(p.get("From_Street")), clean(p.get("To_Street"))
    where = "%s, %s to %s" % (on, start, end) if start else "%s at %s" % (on, end) if end else on
    return ", ".join(part for part in (where, clean(p.get("Borough"))) if part)


def event(src):
    p = src["properties"]
    name = clean(p.get("Open_Street_Plaza_Parade_Name")) or "%s event" % clean(p.get("On_Street"))
    date = day(p.get("Event_Date"))
    starts, ends = clock(p.get("Start_Time")), clock(p.get("End_Time"))
    if ends <= starts:
        sys.exit("FAIL: %s on %s ends before it starts. Nothing written." % (name, date))
    props = {
        "id": "%s-%s" % (slug(name), date[5:]),
        "org": name,
        "address": place(p),
        "borough": clean(p.get("Borough")),
        "type": "signature" if clean(p.get("Type")) == "Signature" else "partner",
        "date": date,
        "starts": starts,
        "ends": ends,
        "host": clean(p.get("Partner_s")),
    }
    props["org_id"] = props["id"]
    lon, lat = src["geometry"]["coordinates"]
    return {
        "type": "Feature",
        "geometry": {"type": "Point", "coordinates": [round(lon, 5), round(lat, 5)]},
        # Empty fields are left out: the card skips them either way, and the file is smaller.
        "properties": {k: v for k, v in props.items() if v},
    }


def key(p):
    return tuple(clean(p.get(field)) for field in SHARED)


def write(name, collection):
    path = os.path.join(OUT_DIR, name)
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(collection, fh, ensure_ascii=False, separators=(",", ":"))
        fh.write("\n")
    return path


def main():
    points, lines = fetch(POINTS), fetch(LINES)
    if len(points) < MIN_EVENTS:
        sys.exit("FAIL: %d events (the gate is %d). Nothing written." % (len(points), MIN_EVENTS))

    events = [event(f) for f in points]
    ids = [e["properties"]["id"] for e in events]
    # One name on one day can be several blocks at once ("Halloween Block Party"), two of
    # them on one street: each is told apart by its street and the corner it starts at.
    for src, e, base in zip(points, events, ids):
        if ids.count(base) > 1:
            p = src["properties"]
            corner = clean(p.get("From_Street")) or clean(p.get("To_Street"))
            e["properties"]["id"] = e["properties"]["org_id"] = "%s-%s-%s" % (
                base, slug(clean(p.get("On_Street"))), slug(corner))
    ids = [e["properties"]["id"] for e in events]
    if len(set(ids)) != len(ids):
        sys.exit("FAIL: event ids are repeated. Nothing written.")

    by_key = {}
    for src, e in zip(points, events):
        by_key.setdefault(key(src["properties"]), []).append(e["properties"]["id"])
    streets = []
    for src in lines:
        match = by_key.get(key(src["properties"]), [])
        if len(match) != 1:
            sys.exit("FAIL: a street segment matches %d events: %s. Nothing written."
                     % (len(match), key(src["properties"])))
        streets.append({
            "type": "Feature",
            "geometry": {"type": "LineString", "coordinates": [
                [round(lon, 5), round(lat, 5)] for lon, lat in src["geometry"]["coordinates"]]},
            "properties": {"event": match[0]},
        })

    events.sort(key=lambda e: (e["properties"]["date"], e["properties"]["starts"],
                               e["properties"]["org"]))
    for i, e in enumerate(events):
        e["id"] = i + 1                   # numeric id: MapLibre feature-state needs one

    stamp = edited(POINTS)
    os.makedirs(OUT_DIR, exist_ok=True)
    out = [
        write("events.geojson", {"type": "FeatureCollection", "source": POINTS,
                                 "generated": stamp, "features": events}),
        write("streets.geojson", {"type": "FeatureCollection", "source": LINES,
                                  "generated": stamp, "features": streets}),
    ]

    signature = sum(e["properties"]["type"] == "signature" for e in events)
    print("  events       %d  (%d signature, %d partner)"
          % (len(events), signature, len(events) - signature))
    print("  streets      %d segments" % len(streets))
    print("  days         %s to %s" % (events[0]["properties"]["date"],
                                       events[-1]["properties"]["date"]))
    print("  edited       %s\n" % stamp)
    for path in out:
        print("  %s    %.1f KB" % (os.path.relpath(path, ROOT), os.path.getsize(path) / 1024))


if __name__ == "__main__":
    main()
