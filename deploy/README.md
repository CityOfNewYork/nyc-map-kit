# Containerized Deployment

**NOTE**: All commands and file refererences below assume you are in the project's root directory.

## Layout

```
deploy/
  build.sh                  Local build of the app (see Build App below)
  render.sh                 Fills in a manifest's $(name) placeholders from environment variables
  ci/
    azure-pipelines.yml     Azure Pipelines definition (point the pipeline at this path)
    vars-nonprod.yml        Per-environment pipeline variables, selected by the `environment` parameter
    vars-prod.yml
  images/
    Dockerfile              Container image; build context is the project root
    nginx.conf              nginx configuration copied into the image
  manifests/
    deployment.yaml         Deployment, suffixed by color (blue/green)
    service.yaml            Service, suffixed by color (blue/green)
    ingress.yaml            Ingress; applied only by the pipeline's Cutover stage
```

The manifests use `$(name)` placeholders. `deploy/render.sh` fills each one in from the upper-case environment variable `NAME` (`$(imageVersion)` comes from `IMAGEVERSION`) and fails on any undefined variable. The pipeline runs it with its variables in the environment; see Deploy to a Local Cluster below to run it yourself.

## Docker

### Build App

 Read the comments and then run `deploy/build.sh`.
 
 ### Build and Run Docker Image

Make sure you've built the app as described in [Build App](#build-app).

In this section, the following must be substituted with real values:

* `<version>` - the version for the Docker image (do NOT use "latest" for deployments to shared servers!)
* `<timestamp>` - the timestamp used for `*.pmtiles` releases from GitHub repo
* `<local-port>` - the local port use when running the container


```sh
# Build the image
docker build -t nyc-map-kit:<version> --platform linux/amd64 --build-arg TILEBUILD=nyc-<timestamp>.pmtiles -f deploy/images/Dockerfile .
```

```sh
# Run the image
docker run  --platform linux/amd64 --rm --name nyc-map-kit -p <local-port>:80 nyc-map-kit:<version>
```

### Deploy to a Local Cluster (Docker Desktop)

This section describes how to deploy the app to Docker's bundled Kubernetes server that runs on your local workstation. It assumes you have a recent version of Docker Desktop installed. Docker Desktop's Kubernetes server runs images from the local Docker image store, so no registry is needed.

For now, only the Deployment and Service are applied. The Ingress is skipped: it needs an ingress controller and a TLS secret, and in the pipeline only the Cutover stage applies it. The app is reachable `port-forward` instead of an ingress controller.

Enable Kubernetes by opening the Docker Dashboard and then going to "Settings" (gear icon in the upper right corner) and then "Kubernetes" (one of the choices in the left side sidebar). On the Kubernetes settings page, go the first setting, labled "Enable Kubernetes", and use the slider to enable Kubernetes.

If you have not done so already, build the Docker image as described in the [Build App](#build-app) section.

```sh
# Variables for the manifests' $(name) placeholders. REGISTRYSECRET is a dummy value
# because the image is already local and is never pulled.
export COLOR=blue REGISTRY=local IMAGEREPOSITORY=nyc-map-kit IMAGEVERSION=dev REGISTRYSECRET=unused

# OPTIONAL: re-tag the image with the same name the manifests will ask for
# by replacing the <version> with the real value
#
# Alternatively, adjust the variable values in the previous export command with
# your local image configuration
docker tag nyc-map-kit:<version> local/nyc-map-kit:dev

# Once: the manifests are in this namespace
kubectl --context docker-desktop create namespace gis-apps

# Render and apply (no ingress.yaml); the echo separates the YAML documents
for f in deployment service; do echo '---'; deploy/render.sh deploy/manifests/$f.yaml; done \
  | kubectl --context docker-desktop apply -f -

# Browse to http://localhost:8080
kubectl --context docker-desktop -n gis-apps port-forward svc/nyc-map-kit-blue 8080:80
```

`--context docker-desktop` makes sure nothing is applied to another cluster. Rebuild with a new `IMAGEVERSION` and re-run the render and apply to roll out a change.
