# Containerized Deployment

**NOTE**: All commands and file refererences below assume you are in the project's root directory.

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
docker build -t nyc-map-kit:<version> --build-arg TILEBUILD=nyc-<timestamp>.pmtiles -f deploy/Dockerfile .
```

```sh
# Run the image
docker run --rm --name nyc-map-kit -p <local-port>:80 nyc-map-kit:<version>
```
