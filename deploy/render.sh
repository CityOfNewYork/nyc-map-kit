#!/usr/bin/env bash
# nyc-map-kit — renders a Kubernetes manifest from deploy/manifests: replaces each $(name)
# with the value of the upper-case environment variable NAME (so $(imageVersion) comes from
# IMAGEVERSION) and prints the result. An undefined variable fails the script.
#
#     deploy/render.sh deploy/manifests/deployment.yaml | kubectl apply -f -
#
# The pipeline (deploy/ci/azure-pipelines.yml) runs this with its variables in the environment;
# see deploy/README.md for deploying to a local cluster.
set -euo pipefail

[[ $# -eq 1 && -f "$1" ]] || { echo "usage: $0 <manifest.yaml>" >&2; exit 2; }

perl -pe 's/\$\(([A-Za-z_]+)\)/defined $ENV{uc $1} ? $ENV{uc $1} : die "undefined variable: $1\n"/ge' "$1"
