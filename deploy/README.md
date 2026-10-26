# Containerized Deployment

**NOTE**: All commands and file refererences below assume you are in the project's root directory.

## Layout

```
deploy/
  build.sh                  Local build of the app (see Build App below)
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

Both manifests use `$(name)` placeholders that the pipeline fills in from its variables before applying them.

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
