# Importing new photos

Run this every 2–3 months (or whenever new albums need to show up in the gallery).

## 1. Export from Google Takeout

1. Go to [takeout.google.com](https://takeout.google.com).
2. Click **Deselect all**, then select only **Google Photos**.
3. Click into the Google Photos options and choose **specific albums** — pick the albums you want to bring in this round (already-imported albums are safe to include again; the import script dedupes automatically).
4. Export, wait for Google's email, and download the resulting zip(s).

## 2. Unzip the export

Unzip it anywhere convenient, e.g. `~/Downloads/takeout-2026-08-17`. You should end up with a folder that contains a `Google Photos` directory (it may be nested under a `Takeout` directory — either layout works).

## 3. Run the import, then the manifest build

From the project root:

```bash
npm run import -- ~/Downloads/takeout-2026-08-17
npm run manifest
```

- `import` copies any genuinely new photos into `data/originals/` and records them in `data/import-index.json`. It prints a summary of how many were imported vs. skipped as duplicates.
- `manifest` reads every not-yet-processed photo and generates the WebP variants and blur placeholder. If R2 credentials are set in `.env` (copy `.env.example` if you haven't already), it uploads the variants to R2 and points `photos.json` at the public R2 URLs. If `.env` has no R2 variables at all, it instead writes the variants to `public/photos/` (gitignored) and points `photos.json` at those local paths — good enough for `npm run dev`, but not for production, since those files aren't hosted anywhere once deployed.
  - Once a photo is marked `processed: true` in `data/import-index.json`, re-running `manifest` won't touch it again — even if you set up R2 afterwards. If you processed photos in local mode and later configure R2, delete their `processed` flags (or just clear `data/import-index.json` and re-run `import`) so they get re-processed and uploaded.

## 4. Sanity-check the result

```bash
git diff src/data/photos.json
```

- Confirm the diff only *adds* entries (existing entries shouldn't change).
- Spot-check a couple of new entries: does the `album` name look right? Does `createDate` look plausible? Open one of the `src.medium` URLs in a browser to confirm the image uploaded correctly.
- Run `npm run dev` and scroll through the gallery locally before pushing.

## 5. Commit and push

```bash
git add data/import-index.json src/data/photos.json
git commit -m "Import photos from <album/date>"
git push
```

Pushing to the main branch is what triggers a Netlify rebuild — Netlify only needs the committed `photos.json`, it never talks to R2 or Google during the build.

## If something goes wrong

Both scripts are idempotent and safe to re-run:

- `import-takeout.mjs` skips any photo whose content hash is already in `data/import-index.json` — re-running against an overlapping or even fully-repeated export just reports more "skipped" and imports nothing new.
- `build-manifest.mjs` skips uploading a variant if it already exists in the R2 bucket, and skips any photo already marked `processed: true` in the ledger.

So if a run fails partway (e.g. network drop mid-upload), just fix the underlying issue and re-run the same command — it will pick up where it left off rather than duplicating work.
