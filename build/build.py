#!/usr/bin/env python3
"""
nyc-map-kit — data pipeline for the ABAWD / SEVSP volunteer-site map.

    python3 build/build.py

Reads whichever input is present (KML preferred, CSV otherwise), geocodes every site
address against NYC GeoSearch, and writes the three files the app loads:

    app/sites.geojson     one Point feature per site
    app/orgs.json         one record per organization, with its sites
    app/one-site.geojson  a single feature, for the one-pin demo iframe

It also writes `data/sevsp-2026-09.csv` when reading the KML. That CSV is the committed
source of truth: it is the KML minus the three personal-contact columns, and a clean
clone with no KML can rebuild from it alone.

Design notes for whoever adapts this
------------------------------------
* The parsers are thin adapters (`read_kml`, `read_csv`). Both return the same list of
  plain dicts, and everything after that point is source-agnostic — when this data
  starts arriving as a Snowflake export, add a third reader and nothing else changes.
* Geocoding is cached in `data/geocode_cache.json`, keyed by the raw address string, so
  a rebuild costs zero network calls. Delete the file to re-resolve from scratch.
* `data/overrides.json` holds hand fixes and is consulted before the cache. Overrides
  survive rebuilds and re-geocodes; that is the point of keeping them in their own file.
* The build FAILS (exit 1) if fewer than MIN_RESOLVED of the addresses resolve, so a
  bad input file cannot quietly ship a half-empty map.

Stdlib only. No installs.
"""

import csv
import json
import os
import re
import sys
import time
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from datetime import date

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, "data")
APP = os.path.join(ROOT, "app")

KML_IN = os.path.join(DATA, "source-2026-09.kml")
CSV_IO = os.path.join(DATA, "sevsp-2026-09.csv")
CACHE = os.path.join(DATA, "geocode_cache.json")
OVERRIDES = os.path.join(DATA, "overrides.json")

KML_NS = {"k": "http://www.opengis.net/kml/2.2"}
GEOSEARCH = "https://geosearch.planninglabs.nyc/v2/search"
USER_AGENT = "nyc-map-kit build.py (NYC OTI; https://github.com/htownley/nyc-map-kit)"
SLEEP_S = 0.12          # be a good citizen; GeoSearch is free and unmetered
MIN_RESOLVED = 0.95     # the gate: fail the build below this share of sites geocoded

# The 16 ExtendedData fields, in KML order. The three marked PRIVATE are dropped on the
# way out: they name a person. They are on the public Google My Map today, but a
# published dataset is a different surface from a map someone has to click into, and the
# card never shows them (see app/config.json), so they are not carried in the pipeline.
FIELDS = [
    ("DBA or Program Name (if Applicable)", "dba"),
    ("Organization Address", "org_address"),
    ("Borough", "borough"),
    ("Website (if Available)", "website"),
    ("Primary Contact Person", None),                 # PRIVATE — dropped
    ("Primary Contact Title/Role", None),             # PRIVATE — dropped
    ("Email Address", None),                          # PRIVATE — dropped
    ("Phone Number", "phone"),
    ("Organization Type", "org_type"),
    ("Mission Statement or Organizational Summary", "mission"),
    ("Population Served", "populations"),
    ("Types of Services Provided", "services"),
    ("Description of Programs or Service Opportunities Available to Participants", "description"),
    ("Hours of Operation and Participant Schedule", "hours"),
    ("Service Location(s)", "service_locations"),
    ("Expected Participant Activities/Duties", "activities"),
]
KEEP = [(label, key) for label, key in FIELDS if key]
CSV_COLUMNS = ["org", "address"] + [label for label, _ in KEEP]

# Values that mean "this cell is empty" in a spreadsheet filled in by 75 different people.
EMPTY_VALUES = {"", "n/a", "na", "n.a.", "none", "not applicable", "-", "--", "tbd", "null"}


# --------------------------------------------------------------------------- utilities

def clean(value):
    """Normalize one cell: NBSPs to spaces, collapse runs of blank lines, N/A to ''."""
    if value is None:
        return ""
    s = str(value).replace("\xa0", " ").replace("\r\n", "\n").replace("\r", "\n")
    s = "\n".join(line.rstrip() for line in s.split("\n"))
    s = re.sub(r"\n{3,}", "\n\n", s).strip()
    if s.lower().strip(" .") in EMPTY_VALUES:
        return ""
    return s


def slug(name):
    s = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")
    return s or "org"


def load_json(path, default):
    if not os.path.exists(path):
        return default
    with open(path, encoding="utf-8") as fh:
        return json.load(fh)


def write_json(path, obj, compact=False):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as fh:
        if compact:
            json.dump(obj, fh, ensure_ascii=False, separators=(",", ":"))
        else:
            json.dump(obj, fh, ensure_ascii=False, indent=1)
        fh.write("\n")


# ------------------------------------------------------------------------ input readers
# Each reader returns: list of dicts with keys "org", "address", plus the KEEP keys.

def read_kml(path):
    root = ET.parse(path).getroot()
    rows = []
    for pm in root.findall(".//k:Placemark", KML_NS):
        name_el = pm.find("k:name", KML_NS)
        addr_el = pm.find("k:address", KML_NS)
        values = {}
        for data in pm.findall(".//k:Data", KML_NS):
            v = data.find("k:value", KML_NS)
            values[data.get("name")] = v.text if v is not None else ""
        row = {
            "org": clean(name_el.text if name_el is not None else ""),
            "address": clean(addr_el.text if addr_el is not None else ""),
        }
        for label, key in KEEP:
            row[key] = clean(values.get(label, ""))
        rows.append(row)
    return rows


def read_csv(path):
    rows = []
    with open(path, newline="", encoding="utf-8") as fh:
        for raw in csv.DictReader(fh):
            row = {"org": clean(raw.get("org", "")), "address": clean(raw.get("address", ""))}
            for label, key in KEEP:
                row[key] = clean(raw.get(label, ""))
            rows.append(row)
    return rows


def write_sanitized_csv(path, rows):
    """The committed source of truth: every field except the three personal ones."""
    with open(path, "w", newline="", encoding="utf-8") as fh:
        w = csv.writer(fh)
        w.writerow(CSV_COLUMNS)
        for r in rows:
            w.writerow([r["org"], r["address"]] + [r[key] for _, key in KEEP])


# ---------------------------------------------------------------------------- geocoding

def geosearch(text):
    """One GeoSearch call. Returns (lon, lat, label) or None. No key, no quota."""
    url = GEOSEARCH + "?" + urllib.parse.urlencode({"size": 1, "text": text})
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    try:
        with urllib.request.urlopen(req, timeout=20) as resp:
            payload = json.load(resp)
    except Exception as exc:                                  # network, timeout, bad JSON
        print("    ! GeoSearch error for %r: %s" % (text, exc))
        return None
    features = payload.get("features") or []
    if not features:
        return None
    lon, lat = features[0]["geometry"]["coordinates"]
    label = features[0].get("properties", {}).get("label", "")
    return float(lon), float(lat), label


def resolve(address, cache, overrides, stats):
    """raw address -> overrides -> cache -> GeoSearch -> cache. Returns dict or None."""
    ov = overrides.get(address)
    if ov and "lon" in ov and "lat" in ov:
        stats["override"] += 1
        return {"lon": float(ov["lon"]), "lat": float(ov["lat"]),
                "label": ov.get("label", ov.get("note", ""))}
    if address in cache:
        stats["cache"] += 1
        return cache[address]

    query = ov["query"] if ov and ov.get("query") else address
    if ov and ov.get("query"):
        stats["override"] += 1
    hit = geosearch(query)
    time.sleep(SLEEP_S)
    if not hit:
        return None
    lon, lat, label = hit
    cache[address] = {"lon": lon, "lat": lat, "label": label}
    stats["geocoded"] += 1
    return cache[address]


# -------------------------------------------------------------------------------- main

def main():
    if os.path.exists(KML_IN):
        source, rows = os.path.relpath(KML_IN, ROOT), read_kml(KML_IN)
        write_sanitized_csv(CSV_IO, rows)
        print("read %d rows from %s" % (len(rows), source))
        print("wrote %s (sanitized; %d columns, contact person/title/email dropped)"
              % (os.path.relpath(CSV_IO, ROOT), len(CSV_COLUMNS)))
    elif os.path.exists(CSV_IO):
        source, rows = os.path.relpath(CSV_IO, ROOT), read_csv(CSV_IO)
        print("read %d rows from %s" % (len(rows), source))
    else:
        sys.exit("no input: expected %s or %s" % (KML_IN, CSV_IO))

    cache = load_json(CACHE, {})
    # Keys starting with "_" are documentation, not data (see data/overrides.json).
    overrides = {k: v for k, v in load_json(OVERRIDES, {}).items() if not k.startswith("_")}
    stats = {"cache": 0, "geocoded": 0, "override": 0}

    # Stable org ids: slug of the org name, de-duplicated if two names slug the same.
    org_ids, seen = {}, {}
    for r in rows:
        if r["org"] not in org_ids:
            base = slug(r["org"])
            seen[base] = seen.get(base, 0) + 1
            org_ids[r["org"]] = base if seen[base] == 1 else "%s-%d" % (base, seen[base])

    # The org-level prose, kept once per org. Org fields are duplicated on every
    # placemark of that org in the source, so the first row of each org is authoritative.
    org_rows = {}

    features, unresolved = [], []
    site_seq = {}
    for r in rows:
        org_id = org_ids[r["org"]]
        org_rows.setdefault(org_id, r)
        site_seq[org_id] = site_seq.get(org_id, 0) + 1
        site_id = "%s-%d" % (org_id, site_seq[org_id])

        point = resolve(r["address"], cache, overrides, stats) if r["address"] else None
        if not point:
            unresolved.append((r["org"], r["address"]))
            continue

        # Feature properties are deliberately LEAN: identity plus the site-level fields,
        # plus the four short org fields the card needs above the fold. The five long
        # prose fields (services, populations, hours, description, activities) live in
        # orgs.json instead, once per org rather than once per site. Acacia has 60 sites
        # carrying identical prose; duplicating it here tripled sites.geojson (272 KB ->
        # 88 KB) for no new information. embed.js joins the two on org_id.
        props = {
            "id": site_id,
            "org": r["org"],
            "org_id": org_id,
            "address": r["address"],
            "geo_label": point.get("label", ""),
            "borough": r["borough"],
            "dba": r["dba"],
            "website": r["website"],
            "phone": r["phone"],
            "org_type": r["org_type"],
            "service_locations": r["service_locations"],
        }
        features.append({
            "type": "Feature",
            "id": len(features) + 1,          # numeric id: MapLibre feature-state needs one
            "geometry": {"type": "Point", "coordinates": [round(point["lon"], 5),
                                                          round(point["lat"], 5)]},
            "properties": props,
        })

    write_json(CACHE, cache)

    resolved_share = len(features) / len(rows) if rows else 0
    if unresolved:
        print("\n%d address(es) did not resolve:" % len(unresolved))
        for org, address in unresolved:
            print("  - %s — %s" % (org, address))
        print("  Fix by adding an entry to data/overrides.json:")
        print('    {"<raw address>": {"query": "<alternate text>"}}')
        print('    {"<raw address>": {"lon": -73.9, "lat": 40.8, "note": "hand-placed from ..."}}')
    if resolved_share < MIN_RESOLVED:
        sys.exit("\nFAIL: only %.1f%% of addresses resolved (gate is %.1f%%). Nothing written."
                 % (resolved_share * 100, MIN_RESOLVED * 100))

    stamp = date.today().isoformat()
    write_json(os.path.join(APP, "sites.geojson"),
               {"type": "FeatureCollection", "generated": stamp, "features": features},
               compact=True)

    # orgs.json carries the org-level prose once per org instead of once per site, which
    # is what keeps sites.geojson inside the payload budget for a 60-site org.
    orgs = {}
    for f in features:
        p = f["properties"]
        row = org_rows[p["org_id"]]
        org = orgs.setdefault(p["org_id"], {
            "org_id": p["org_id"], "name": p["org"], "dba": row["dba"],
            "website": row["website"], "phone": row["phone"], "org_type": row["org_type"],
            "services": row["services"], "populations": row["populations"],
            "hours": row["hours"], "description": row["description"],
            "activities": row["activities"], "mission": row["mission"], "sites": [],
        })
        org["sites"].append({
            "id": p["id"], "address": p["address"], "borough": p["borough"],
            "lon": f["geometry"]["coordinates"][0], "lat": f["geometry"]["coordinates"][1],
        })
    orgs_list = sorted(orgs.values(), key=lambda o: o["name"].lower())
    write_json(os.path.join(APP, "orgs.json"),
               {"generated": stamp, "orgs": orgs_list}, compact=True)

    # One feature, for the single-point demo iframe on demo.html.
    if features:
        one = next((f for f in features if f["properties"]["org"].startswith("Henry Street")),
                   features[0])
        write_json(os.path.join(APP, "one-site.geojson"),
                   {"type": "FeatureCollection", "generated": stamp, "features": [one]},
                   compact=True)

    def kb(path):
        return os.path.getsize(path) / 1024

    print("\n  sites        %d" % len(features))
    print("  orgs         %d" % len(orgs_list))
    print("  resolved     %d / %d  (%.1f%%)" % (len(features), len(rows), resolved_share * 100))
    print("  from cache   %d" % stats["cache"])
    print("  geocoded     %d" % stats["geocoded"])
    print("  overrides    %d" % stats["override"])
    print("  generated    %s" % stamp)
    print("\n  app/sites.geojson    %6.1f KB" % kb(os.path.join(APP, "sites.geojson")))
    print("  app/orgs.json        %6.1f KB" % kb(os.path.join(APP, "orgs.json")))


if __name__ == "__main__":
    main()
