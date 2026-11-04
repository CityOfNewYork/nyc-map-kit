FROM nginx:1.31-alpine

ARG TILEBUILD="${TILEBUILD:-unknown}"

LABEL nyc.map.kit.pmtiles=nyc-"${TILEBUILD}".pmtiles

WORKDIR /app

COPY ./dist/app .

# Precompressed copies for nginx's gzip_static. The .pmtiles file is left alone: its tiles are
# already compressed and the map reads it with range requests.
RUN find /app -type f \( -name '*.html' -o -name '*.js' -o -name '*.css' -o -name '*.json' -o -name '*.geojson' -o -name '*.svg' \) \
    -size +1k -exec gzip -9 -k {} +

COPY ./deploy/images/nginx.conf /etc/nginx/nginx.conf
