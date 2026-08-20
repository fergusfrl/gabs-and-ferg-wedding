# Gabs & Ferg Wedding Photos

A photo gallery site built with [Astro](https://astro.build) and React, showing off a shared wedding photo collection in a justified (Flickr-style) layout with a full-screen lightbox. Photos are imported from Google Takeout exports, processed into responsive WebP variants, and served from Cloudflare R2.

## Project structure

```text
/
├── data/
│   ├── originals/            # imported source photos (gitignored)
│   └── import-index.json     # import ledger: hash → metadata + processed flag
├── docs/
│   └── IMPORTING-PHOTOS.md   # step-by-step guide for importing a new batch
├── infra/
│   └── setup-cloudflare.sh   # one-time R2 bucket setup
├── scripts/
│   ├── import-takeout.mjs    # Takeout export -> data/originals/
│   ├── build-manifest.mjs    # originals -> WebP variants + src/data/photos.json
│   └── backfill-cache-headers.mjs
└── src/
    ├── components/           # Gallery, Lightbox, ScrollRail (React) + Hero (Astro)
    ├── data/photos.ts         # typed accessor for the generated photo manifest
    ├── data/photos.json       # generated manifest (committed)
    ├── layouts/
    └── pages/
```

## Running and building

Requires Node >= 22.12 and [pnpm](https://pnpm.io).

```bash
pnpm install
pnpm dev       # start local dev server at localhost:4321
pnpm build     # build production site to ./dist/
pnpm preview   # preview the production build locally
```

Deployment is via Netlify (`netlify.toml`): pushing to `main` triggers a rebuild. The build only reads the committed `src/data/photos.json` — it never talks to Google or R2.

## Photo pipeline

New photos go through two scripts, run locally, that turn a Google Takeout export into the manifest the site reads at build time. Full walkthrough in [docs/IMPORTING-PHOTOS.md](docs/IMPORTING-PHOTOS.md); short version:

1. **Export** the desired albums from [Google Takeout](https://takeout.google.com) and unzip them.
2. **`pnpm run import <path-to-export>`** ([scripts/import-takeout.mjs](scripts/import-takeout.mjs)) walks the export, hashes each file (sha256) to dedupe against `data/import-index.json`, resolves a capture date (Takeout sidecar → EXIF → file mtime), and copies new files into `data/originals/`.
3. **`pnpm run manifest`** ([scripts/build-manifest.mjs](scripts/build-manifest.mjs)) processes every not-yet-`processed` entry: reads real dimensions, generates `thumb`/`medium`/`large`/`full` WebP variants plus a tiny blurred placeholder, and appends the result to `src/data/photos.json`.
   - If R2 credentials are set in `.env` (see `.env.example`), variants upload to Cloudflare R2 (content-addressed keys, immutable cache headers) and the manifest points at public R2 URLs.
   - Otherwise variants are written to `public/photos/` (gitignored) for local preview only — fine for `pnpm dev`, not for production.
4. Sanity-check with `git diff src/data/photos.json`, then commit `data/import-index.json` and `src/data/photos.json` and push — that's what ships the new photos.

Both scripts are idempotent: re-running skips already-imported hashes and already-processed/uploaded entries, so a failed run can just be re-run.

`infra/setup-cloudflare.sh` is a one-time script for provisioning the R2 bucket on a fresh Cloudflare account, and `scripts/backfill-cache-headers.mjs` is a one-off maintenance script for fixing cache headers on objects uploaded before the pipeline started setting them.

## Learn more

See [docs.astro.build](https://docs.astro.build) for Astro-specific guides.
