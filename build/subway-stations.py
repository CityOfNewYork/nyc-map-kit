#!/usr/bin/env python3
"""
nyc-map-kit — the subway's stations, for every basemap.

    python3 build/subway-stations.py

Writes app/public/subway-stations.geojson: one point for each station complex on the
subway and the Staten Island Railway, from the MTA's "MTA Subway Stations and
Complexes" dataset on New York State's open data portal
(https://data.ny.gov/d/5f5g-n3cz). A complex is what a rider calls one station:
Fulton St is four stations to the MTA and one row here, so the map draws one icon for
it where the basemaps' own station layers draw one per platform.

Each point carries the station's name as the MTA signs it (`name`), the services that
stop there on weekday daytime (`routes`, space-separated), and whether it is accessible
(`ada`: 0 no, 1 fully, 2 partly). Coordinates are rounded to about a metre. Rerun it
when the MTA republishes the dataset.

Stdlib only. No installs.
"""

import json
import os
import urllib.parse
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "app", "public", "subway-stations.geojson")

DATASET = "https://data.ny.gov/resource/5f5g-n3cz.json"
USER_AGENT = ("nyc-map-kit subway-stations.py "
              "(NYC OTI; https://github.com/CityOfNewYork/nyc-map-kit)")
LIMIT = 1000                              # the dataset has 445 rows; one page holds them all
NYC = (-74.26, 40.49, -73.69, 40.92)      # west, south, east, north: the city, with a margin


def main():
    query = urllib.parse.urlencode({
        "$select": "complex_id,stop_name,daytime_routes,ada,latitude,longitude",
        "$order": "complex_id",
        "$limit": LIMIT,
    })
    req = urllib.request.Request(f"{DATASET}?{query}", headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=60) as resp:
        rows = json.load(resp)
    if len(rows) >= LIMIT:
        raise SystemExit("the dataset returned a full page; page the query")

    features = []
    for row in rows:
        lon, lat = float(row["longitude"]), float(row["latitude"])
        if not (NYC[0] <= lon <= NYC[2] and NYC[1] <= lat <= NYC[3]):
            raise SystemExit(f"station {row['complex_id']} lies outside the city: {lon}, {lat}")
        features.append({
            "type": "Feature",
            "properties": {
                "name": row["stop_name"].strip(),
                "routes": row["daytime_routes"].strip(),
                "ada": int(row["ada"]),
            },
            "geometry": {"type": "Point", "coordinates": [round(lon, 5), round(lat, 5)]},
        })
    if not features:
        raise SystemExit("the dataset returned no stations")
    with open(OUT, "w", encoding="utf-8") as fh:
        json.dump({"type": "FeatureCollection", "features": features}, fh,
                  ensure_ascii=False, separators=(",", ":"))
        fh.write("\n")
    print(f"wrote {len(features)} stations to {os.path.relpath(OUT, ROOT)} "
          f"({os.path.getsize(OUT) // 1024} KB)")


if __name__ == "__main__":
    main()
