# Containerized Deployment


## Docker

### Build App

 ```sh
 npm ci
 npm test
 npm run lint
 npm run build
 ```
 
 ### Build Docker Image

 ```sh
 docker build -t nyc-map-kit:latest -f deploy/Dockerfile .
 ```

### Run Docker Image Locally

#### Blocks at the terminal

 ```sh
 docker run --rm --name nyc-map-kit -p 8088:80 nyc-map-kit:latest
 ```

#### As a daemon

 ```sh
 docker run --rm -d --name nyc-map-kit -p 8088:80 nyc-map-kit:latest
 ```

## Kubernetes

### Helm Chart

**TODO**
