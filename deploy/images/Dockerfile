FROM nginx:1.31-alpine

ARG TILEBUILD="${TILEBUILD:-unknown}"

LABEL nyc.map.kit.pmtiles=nyc-"${TILEBUILD}".pmtiles

WORKDIR /app

COPY ./dist/app .

COPY ./deploy/images/nginx.conf /etc/nginx/nginx.conf
