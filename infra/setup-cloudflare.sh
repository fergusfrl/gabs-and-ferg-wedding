#!/usr/bin/env bash
# One-time Cloudflare R2 setup for this project. Requires `wrangler` to be
# installed and authenticated (`wrangler login`) first.
#
# Run this ONCE when setting the project up on a new Cloudflare account.
# It is not part of the regular import/build workflow.
set -euo pipefail

# Replace with your real custom domain before running.
DOMAIN="images.example.com"

wrangler r2 bucket create photo-gallery-images
wrangler r2 bucket domain add photo-gallery-images --domain "$DOMAIN"
