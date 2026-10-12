#!/usr/bin/env python3
"""
nyc-map-kit — the city's cemeteries, for the NYC basemap.

    python3 build/cemeteries.py

Writes app/public/cemeteries.geojson: the outline of every cemetery in the city, from the
planimetric survey's open-space layer, which OTI publishes as a feature service. The
NYC basemap's tiles carry the same layer with no field to tell a cemetery from a
schoolyard or a vacant lot; the feature service has that field (FEATURE_CODE, 2500 for
a cemetery), so the block reads the cemeteries from here.

The file holds geometry only, simplified to about a metre: under a pixel at the zoom a
selected site opens at (z15), about four at the map's closest (z18). Rerun it when the
survey is republished.

Stdlib only. No installs.
"""

import json
import os
import urllib.parse
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "app", "public", "cemeteries.geojson")

SERVICE = ("https://services6.arcgis.com/yG5s3afENB5iO9fj/ArcGIS/rest/services/"
           "Open_Space_No_Park_2022/FeatureServer/11/query")
CEMETERY = 2500
USER_AGENT = "nyc-map-kit cemeteries.py (NYC OTI; https://github.com/CityOfNewYork/nyc-map-kit)"


def main():
    query = urllib.parse.urlencode({
        "where": f"FEATURE_CODE={CEMETERY}",
        "outFields": "",
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
    features = [
        {"type": "Feature", "properties": {}, "geometry": f["geometry"]}
        for f in data["features"] if f.get("geometry")
    ]
    if not features:
        raise SystemExit("the service returned no cemeteries")
    with open(OUT, "w", encoding="utf-8") as fh:
        json.dump({"type": "FeatureCollection", "features": features}, fh,
                  separators=(",", ":"))
        fh.write("\n")
    print(f"wrote {len(features)} cemeteries to {os.path.relpath(OUT, ROOT)} "
          f"({os.path.getsize(OUT) // 1024} KB)")


if __name__ == "__main__":
    main()
