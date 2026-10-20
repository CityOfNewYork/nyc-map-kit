#!/usr/bin/env python3
"""
nyc-map-kit — data pipeline for the Public Computer Centers map.

    python3 build/computer-centers.py

Reads the open centers from OTI's Public Computer Centers feature layer and writes

    app/public/computer-centers/sites.geojson     one Point feature per center

in the block's point-data shape (app/src/logic/types.ts), with the fields
app/public/computer-centers/config.json shows. The source already carries coordinates,
so there is no geocoding step.

The source has one column per weekday for hours and one Y/N column per kind of help. The
card wants each of those as one readable value, so they are composed here:

* `hours`: the seven days, with consecutive days that share hours collapsed, one line
  each: "Mon–Fri: 10 AM – 6 PM" then "Sat–Sun: Closed".
* `services`: the kinds of help marked Y, separated by semicolons, which the card shows
  as a list.

The build FAILS (exit 1) if the layer returns fewer than MIN_FEATURES centers, so a
broken query cannot quietly ship a near-empty map.

Stdlib only. No installs.
"""

import json
import os
import re
import sys
import urllib.parse
import urllib.request
from datetime import date

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "app", "public", "computer-centers", "sites.geojson")

# Public, no key needed. NYC Open Data publishes a citywide list of public computer centers
# as dataset sejx-2gn3.
SOURCE = ("https://services6.arcgis.com/yG5s3afENB5iO9fj/arcgis/rest/services/"
          "Public_Computer_Centers_PRD/FeatureServer/0")
USER_AGENT = ("nyc-map-kit computer-centers.py (NYC OTI; "
              "https://github.com/CityOfNewYork/nyc-map-kit)")
MIN_FEATURES = 400      # the gate: 486 open centers in October 2026

DAYS = [("Mon_Hours", "Mon"), ("Tue_Hours", "Tue"), ("Wed_Hours", "Wed"),
        ("Thu_Hours", "Thu"), ("Fri_Hours", "Fri"), ("Sat_Hours", "Sat"),
        ("Sun_Hours", "Sun")]

# The Y/N columns, in the order the card lists them.
SERVICES = [
    ("General_Tech_Help", "General tech help"),
    ("Technology_Related_Courses", "Technology classes"),
    ("Productivity_Tools", "Productivity tools"),
    ("Job_Readiness", "Job readiness"),
    ("Education", "Education"),
    ("Digital_Media_and_Creativity", "Digital media and creativity"),
    ("Telehealth_Skills", "Telehealth skills"),
    ("Advanced_Tech_Skills", "Advanced tech skills"),
    ("Certifications", "Certifications"),
    ("Assistive_Technology", "Assistive technology"),
]

# The three library systems are one kind of place to a resident, so the map shows them as one
# group, with one pin colour and one filter. Each card still names its own system under
# "Operated by".
AGENCY_GROUPS = {
    "New York Public Library (NYPL)": "Public libraries",
    "Brooklyn Public Library (BPL)": "Public libraries",
    "Queens Public Library (QPL)": "Public libraries",
}

EMPTY_VALUES = {"", "n/a", "na", "none", "null", "-"}


def clean(value):
    """One cell as text: whitespace trimmed and collapsed, N/A to ''."""
    if value is None:
        return ""
    s = re.sub(r"\s+,", ",", re.sub(r"\s+", " ", str(value))).strip()
    return "" if s.lower().strip(" .") in EMPTY_VALUES else s


def listed(value):
    """A comma-separated cell ("Spanish,Russian") as the card reads it: "Spanish, Russian"."""
    return ", ".join(part.strip() for part in clean(value).split(",") if part.strip())


TIME = re.compile(r"^(\d{1,2})(?::(\d{2}))?\s*([ap])\.?\s*m\.?$", re.I)


def time_text(raw):
    """"10am", "10:00AM" or "10:00 AM" as "10 AM"; "8:30 am" as "8:30 AM". None if not a time."""
    m = TIME.match(raw.strip())
    if not m:
        return None
    hour, minute, half = int(m.group(1)), m.group(2), m.group(3).upper()
    return "%d%s %sM" % (hour, ":" + minute if minute and minute != "00" else "", half)


def day_hours(raw):
    """One day's cell in one spelling: "10 AM – 6 PM", "Closed", the source's own words, or ''."""
    s = clean(raw)
    if not s or s.lower().startswith("n/a"):
        return ""
    if s.lower().replace(" ", "") in ("closed", "closed-closed"):
        return "Closed"
    parts = re.split(r"\s*[-–—]\s*", s)
    if len(parts) == 2:
        opens, closes = time_text(parts[0]), time_text(parts[1])
        if opens and closes:
            return "%s – %s" % (opens, closes)
    return s        # free text such as "Varies": shown as written


def hours(props):
    """The week as lines, consecutive days with the same hours collapsed. '' if no day is known."""
    days = [(name, day_hours(props.get(field))) for field, name in DAYS]
    if not any(value for _, value in days):
        return ""
    lines, i = [], 0
    while i < len(days):
        j = i
        while j + 1 < len(days) and days[j + 1][1] == days[i][1]:
            j += 1
        if days[i][1]:
            span = days[i][0] if i == j else "%s–%s" % (days[i][0], days[j][0])
            lines.append("%s: %s" % (span, days[i][1]))
        i = j + 1
    return "\n".join(lines)


def services(props):
    return "; ".join(label for field, label in SERVICES
                     if clean(props.get(field)).upper() == "Y")


def fetch():
    query = urllib.parse.urlencode({
        "where": "Status = 'Currently open'", "outFields": "*", "outSR": "4326",
        "orderByFields": "Object_Identification_Number", "f": "geojson",
    })
    req = urllib.request.Request("%s/query?%s" % (SOURCE, query),
                                 headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=60) as resp:
        return json.load(resp)


def feature(src, seq):
    p = src["properties"]
    name = clean(p.get("Location_Name"))
    operator = clean(p.get("Operator_Name"))
    access = clean(p.get("Access_Notes")) if clean(p.get("Access_Requirements")).upper() == "Y" else ""
    wheelchair = "Yes" if clean(p.get("Wheelchair_Accessible")).upper() == "Y" else ""
    notes = clean(p.get("Wheelchair_Access_Notes"))
    if wheelchair and notes:
        wheelchair = "Yes. %s" % notes
    workstations = p.get("Workstation__")
    props = {
        "id": clean(p.get("Object_Identification_Number")),
        "org": name,
        "org_id": clean(p.get("Object_Identification_Number")),
        "org_type": AGENCY_GROUPS.get(clean(p.get("Oversight_Agency")),
                                      clean(p.get("Oversight_Agency"))),
        "address": clean(p.get("Full_Location_Address")),
        "borough": clean(p.get("Borough")),
        "phone": clean(p.get("Location_Phone_Number")),
        "website": clean(p.get("URL")),
        "hours": hours(p),
        "operator": operator if operator.lower() != name.lower() else "",
        "population": listed(p.get("target_population")),
        "access": access,
        "services": services(p),
        "devices": listed(p.get("Type_of_devices_avaliable")),
        "lending": "Yes" if clean(p.get("Device_Loaning")).upper() == "Y" else "",
        "computers": str(workstations) if isinstance(workstations, int) and workstations > 0 else "",
        "languages": listed(p.get("Language_Access")),
        "wheelchair": wheelchair,
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
    data = fetch()
    if "error" in data:
        sys.exit("FAIL: the layer answered with an error: %s" % data["error"])
    sources = [f for f in data.get("features", []) if f.get("geometry")]
    if len(sources) < MIN_FEATURES:
        sys.exit("FAIL: %d centers (the gate is %d). Nothing written." % (len(sources), MIN_FEATURES))

    features = [feature(f, i + 1) for i, f in enumerate(sources)]
    ids = [f["properties"]["id"] for f in features]
    if len(set(ids)) != len(ids) or not all(ids):
        sys.exit("FAIL: center ids are missing or repeated. Nothing written.")

    stamp = date.today().isoformat()
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as fh:
        json.dump({"type": "FeatureCollection", "source": SOURCE, "generated": stamp,
                   "features": features}, fh, ensure_ascii=False, separators=(",", ":"))
        fh.write("\n")

    agencies = {}
    for f in features:
        agency = f["properties"].get("org_type", "")
        agencies[agency] = agencies.get(agency, 0) + 1
    print("  centers      %d" % len(features))
    for agency, n in sorted(agencies.items(), key=lambda kv: -kv[1]):
        print("    %4d  %s" % (n, agency))
    print("  generated    %s" % stamp)
    print("\n  %s    %.1f KB" % (os.path.relpath(OUT, ROOT), os.path.getsize(OUT) / 1024))


if __name__ == "__main__":
    main()
