#!/usr/bin/env node
// One-time backfill: sets Cache-Control metadata on every existing object in
// the R2 bucket. Objects uploaded before build-manifest.mjs started sending
// CacheControl have no Cache-Control header at all, so browsers fall back to
// heuristic caching and revalidate on every visit. Keys are content-addressed
// (photo id is a hash of the source file), so immutable/1-year is safe.
//
// Metadata-only and idempotent: CopyObject onto the same key with
// MetadataDirective REPLACE rewrites headers without touching the bytes, and
// objects that already have the right Cache-Control are skipped, so re-running
// after an interruption is cheap.
//
// Usage: node scripts/backfill-cache-headers.mjs

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  S3Client,
  ListObjectsV2Command,
  HeadObjectCommand,
  CopyObjectCommand,
} from '@aws-sdk/client-s3';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');

// Must match CACHE_CONTROL in build-manifest.mjs.
const CACHE_CONTROL = 'public, max-age=31536000, immutable';
const CONCURRENCY = 20;

loadDotEnv();

const REQUIRED_ENV = ['R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET_NAME'];

function loadDotEnv() {
  // Same minimal .env loader as build-manifest.mjs.
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

function makeS3Client() {
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

async function listAllKeys(s3, bucket) {
  const keys = [];
  let continuationToken;
  do {
    const page = await s3.send(
      new ListObjectsV2Command({ Bucket: bucket, ContinuationToken: continuationToken }),
    );
    for (const object of page.Contents ?? []) keys.push(object.Key);
    continuationToken = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (continuationToken);
  return keys;
}

async function backfillKey(s3, bucket, key) {
  const head = await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
  if (head.CacheControl === CACHE_CONTROL) return 'skipped';

  await s3.send(
    new CopyObjectCommand({
      Bucket: bucket,
      Key: key,
      CopySource: `${bucket}/${encodeURIComponent(key).replaceAll('%2F', '/')}`,
      MetadataDirective: 'REPLACE',
      // REPLACE drops all existing metadata, so re-state everything we want kept.
      ContentType: head.ContentType ?? 'image/webp',
      CacheControl: CACHE_CONTROL,
    }),
  );
  return 'updated';
}

async function main() {
  const missing = REQUIRED_ENV.filter((key) => !process.env[key]);
  if (missing.length > 0) {
    console.error('Missing R2 credentials in .env: ' + missing.join(', '));
    process.exit(1);
  }

  const s3 = makeS3Client();
  const bucket = process.env.R2_BUCKET_NAME;

  console.log(`Listing objects in ${bucket}...`);
  const keys = await listAllKeys(s3, bucket);
  console.log(`${keys.length} objects found.`);

  let updated = 0;
  let skipped = 0;
  let failed = 0;
  let done = 0;

  for (let i = 0; i < keys.length; i += CONCURRENCY) {
    const batch = keys.slice(i, i + CONCURRENCY);
    const results = await Promise.allSettled(batch.map((key) => backfillKey(s3, bucket, key)));
    results.forEach((result, j) => {
      if (result.status === 'fulfilled') {
        result.value === 'updated' ? updated++ : skipped++;
      } else {
        failed++;
        console.error(`  failed ${batch[j]}: ${result.reason?.message ?? result.reason}`);
      }
    });
    done += batch.length;
    if (done % 500 < CONCURRENCY || done === keys.length) {
      console.log(`  ${done}/${keys.length} (${updated} updated, ${skipped} already set, ${failed} failed)`);
    }
  }

  console.log(`Done: ${updated} updated, ${skipped} already set, ${failed} failed.`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
