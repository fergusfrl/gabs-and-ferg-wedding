#!/usr/bin/env node
// Processes every not-yet-processed entry in data/import-index.json: reads real
// dimensions, generates WebP variants + a blur placeholder, and appends/updates
// the entry in src/data/photos.json.
//
// If R2 credentials are present in .env, variants are uploaded to R2 and
// src/data/photos.json points at the public R2 URLs. Otherwise, variants are
// written to public/photos/ for local preview and src/data/photos.json points
// at relative paths — fine for `astro dev`, but not meant for production (see
// docs/IMPORTING-PHOTOS.md).
//
// Usage: node scripts/build-manifest.mjs

import fs from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { S3Client, PutObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');
const DATA_DIR = path.join(PROJECT_ROOT, 'data');
const INDEX_PATH = path.join(DATA_DIR, 'import-index.json');
const MANIFEST_PATH = path.join(PROJECT_ROOT, 'src', 'data', 'photos.json');
const LOCAL_PHOTOS_DIR = path.join(PROJECT_ROOT, 'public', 'photos');

const VARIANT_WIDTHS = { thumb: 400, medium: 800, large: 1600, full: 2400 };
const BLUR_WIDTH = 20;

loadDotEnv();

const REQUIRED_ENV = ['R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET_NAME', 'R2_PUBLIC_BASE_URL'];

function loadDotEnv() {
  // Minimal .env loader so `pnpm run manifest` works without extra flags.
  // Doesn't override variables already set in the environment.
  const envPath = path.join(PROJECT_ROOT, '.env');
  let raw;
  try {
    raw = readFileSync(envPath, 'utf-8');
  } catch {
    return;
  }
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
}

function resolveMode() {
  const missing = REQUIRED_ENV.filter((key) => !process.env[key]);
  if (missing.length === 0) return 'r2';
  if (missing.length === REQUIRED_ENV.length) return 'local';

  console.error('Partially configured R2 credentials — missing: ' + missing.join(', '));
  console.error('Either fill in all R2_* variables in .env, or remove them entirely to use local mode.');
  process.exit(1);
}

async function loadIndex() {
  const raw = await fs.readFile(INDEX_PATH, 'utf-8');
  return JSON.parse(raw);
}

async function saveIndex(index) {
  await fs.writeFile(INDEX_PATH, JSON.stringify(index, null, 2) + '\n');
}

async function loadManifest() {
  try {
    const raw = await fs.readFile(MANIFEST_PATH, 'utf-8');
    return JSON.parse(raw);
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }
}

async function saveManifest(photos) {
  photos.sort((a, b) => new Date(a.createDate) - new Date(b.createDate));
  await fs.mkdir(path.dirname(MANIFEST_PATH), { recursive: true });
  await fs.writeFile(MANIFEST_PATH, JSON.stringify(photos, null, 2) + '\n');
}

function makeS3Client() {
  // R2_ENDPOINT is an undocumented override, useful for pointing at a local
  // S3-compatible server in tests; production always uses the real R2 endpoint.
  const endpoint = process.env.R2_ENDPOINT || `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`;
  return new S3Client({
    region: 'auto',
    endpoint,
    forcePathStyle: true,
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
    },
  });
}

async function objectExists(s3, key) {
  try {
    await s3.send(new HeadObjectCommand({ Bucket: process.env.R2_BUCKET_NAME, Key: key }));
    return true;
  } catch (err) {
    if (err.$metadata?.httpStatusCode === 404 || err.name === 'NotFound' || err.name === 'NoSuchKey') {
      return false;
    }
    throw err;
  }
}

async function uploadVariant(s3, key, buffer) {
  if (await objectExists(s3, key)) return false;
  await s3.send(
    new PutObjectCommand({
      Bucket: process.env.R2_BUCKET_NAME,
      Key: key,
      Body: buffer,
      ContentType: 'image/webp',
    }),
  );
  return true;
}

async function writeLocalVariant(objectKey, buffer) {
  const destPath = path.join(LOCAL_PHOTOS_DIR, objectKey);
  await fs.mkdir(path.dirname(destPath), { recursive: true });
  await fs.writeFile(destPath, buffer);
}

async function processEntry(s3, id, entry, mode) {
  const inputPath = path.join(PROJECT_ROOT, entry.sourcePath);
  const buffer = await fs.readFile(inputPath);
  const image = sharp(buffer);
  const metadata = await image.metadata();
  const width = metadata.width;
  const height = metadata.height;

  const src = {};
  for (const [key, targetWidth] of Object.entries(VARIANT_WIDTHS)) {
    const outputWidth = Math.min(targetWidth, width);
    const variantBuffer = await sharp(buffer)
      .resize({ width: outputWidth, withoutEnlargement: true })
      .webp({ quality: 82 })
      .toBuffer();
    const objectKey = `${id}/${targetWidth}.webp`;
    if (mode === 'r2') {
      await uploadVariant(s3, objectKey, variantBuffer);
      src[key] = `${process.env.R2_PUBLIC_BASE_URL}/${objectKey}`;
    } else {
      await writeLocalVariant(objectKey, variantBuffer);
      src[key] = `/photos/${objectKey}`;
    }
  }

  const blurBuffer = await sharp(buffer)
    .resize({ width: BLUR_WIDTH })
    .jpeg({ quality: 40 })
    .toBuffer();
  const blurDataURL = `data:image/jpeg;base64,${blurBuffer.toString('base64')}`;

  return {
    id,
    album: entry.album,
    createDate: entry.createDate,
    width,
    height,
    aspectRatio: Number((width / height).toFixed(4)),
    blurDataURL,
    src,
  };
}

async function main() {
  const mode = resolveMode();
  if (mode === 'local') {
    console.log('No R2 credentials found in .env — writing variants to public/photos/ for local preview.');
    console.log('These files are gitignored; set up R2 before deploying (see docs/IMPORTING-PHOTOS.md).');
  }

  const index = await loadIndex().catch(() => {
    console.error(`No ${path.relative(PROJECT_ROOT, INDEX_PATH)} found — run the import script first.`);
    process.exit(1);
  });

  const pending = Object.entries(index).filter(([, entry]) => !entry.processed);
  if (pending.length === 0) {
    console.log('Nothing to process — all imported photos are already in the manifest.');
    return;
  }

  const s3 = mode === 'r2' ? makeS3Client() : null;
  const manifest = await loadManifest();
  const byId = new Map(manifest.map((p) => [p.id, p]));

  let processed = 0;
  let failed = 0;

  for (const [id, entry] of pending) {
    try {
      const manifestEntry = await processEntry(s3, id, entry, mode);
      byId.set(id, manifestEntry);
      entry.processed = true;
      processed++;
      console.log(`  processed ${id} (${entry.album})`);
    } catch (err) {
      failed++;
      console.error(`  failed ${id}: ${err.message}`);
    }
  }

  await saveManifest([...byId.values()]);
  await saveIndex(index);

  console.log(`Processed ${processed} photo(s).${failed > 0 ? ` ${failed} failed — see above.` : ''}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
