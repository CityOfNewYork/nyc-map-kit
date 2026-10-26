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

In this section, the following must be substituted with real values:

* `<version>` - the version for the Docker image (do NOT use "latest" for deployments to shared servers!)
* `<timestamp>` - the timestamp used for `*.pmtiles` releases from GitHub repo
* `<local-port>` - the local port use when running the container


```sh
# Build the image
docker build -t nyc-map-kit:<version> --build-arg TILEBUILD=nyc-<timestamp>.pmtiles -f deploy/images/Dockerfile .
```

```sh
# Run the image
docker run --rm --name nyc-map-kit -p <local-port>:80 nyc-map-kit:<version>
```

### Deploy to a Local Cluster

Uses the Kubernetes cluster built into Docker Desktop (Settings > Kubernetes), which runs images from the local Docker image store, so no registry is needed. Only the Deployment and Service are applied. The Ingress is skipped: it needs an ingress controller and a TLS secret, and in the pipeline only the Cutover stage applies it. Reach the app with `port-forward` instead.

```sh
# Variables for the manifests' $(name) placeholders. REGISTRYSECRET is a dummy value
# because the image is already local and is never pulled.
export COLOR=blue REGISTRY=local IMAGEREPOSITORY=nyc-map-kit IMAGEVERSION=dev REGISTRYSECRET=unused

# Build the image with the same name the manifests will ask for
docker build -t local/nyc-map-kit:dev -f deploy/images/Dockerfile .

# Once: the manifests are in this namespace
kubectl --context docker-desktop create namespace gis-apps

# Render and apply (no ingress.yaml); the echo separates the YAML documents
for f in deployment service; do echo '---'; deploy/render.sh deploy/manifests/$f.yaml; done \
  | kubectl --context docker-desktop apply -f -

# Browse to http://localhost:8080
kubectl --context docker-desktop -n gis-apps port-forward svc/nyc-map-kit-blue 8080:80
```

`--context docker-desktop` makes sure nothing is applied to another cluster. Rebuild with a new `IMAGEVERSION` and re-run the render and apply to roll out a change.
