#!/usr/bin/env node
// Imports photos from an unzipped Google Takeout export into data/originals/,
// deduping against data/import-index.json by content hash.
//
// Usage: node scripts/import-takeout.mjs <path-to-unzipped-takeout-export>

import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import exifr from 'exifr';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');
const DATA_DIR = path.join(PROJECT_ROOT, 'data');
const ORIGINALS_DIR = path.join(DATA_DIR, 'originals');
const INDEX_PATH = path.join(DATA_DIR, 'import-index.json');

const IMAGE_EXTENSIONS = new Set([
  '.jpg',
  '.jpeg',
  '.png',
  '.heic',
  '.heif',
  '.webp',
  '.gif',
  '.bmp',
  '.tif',
  '.tiff',
]);

async function loadIndex() {
  try {
    const raw = await fs.readFile(INDEX_PATH, 'utf-8');
    return JSON.parse(raw);
  } catch (err) {
    if (err.code === 'ENOENT') return {};
    throw err;
  }
}

async function saveIndex(index) {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(INDEX_PATH, JSON.stringify(index, null, 2) + '\n');
}

async function hashFile(filePath) {
  const hash = crypto.createHash('sha256');
  const data = await fs.readFile(filePath);
  hash.update(data);
  return { id: hash.digest('hex'), buffer: data };
}

// Resolve the actual "Google Photos" root within whatever path the user handed us —
// Takeout exports either the outer `Takeout/` wrapper or the inner album folder directly.
async function resolveExportRoot(inputPath) {
  const candidate = path.join(inputPath, 'Google Photos');
  try {
    const stat = await fs.stat(candidate);
    if (stat.isDirectory()) return candidate;
  } catch {
    // fall through
  }
  const nested = path.join(inputPath, 'Takeout', 'Google Photos');
  try {
    const stat = await fs.stat(nested);
    if (stat.isDirectory()) return nested;
  } catch {
    // fall through
  }
  return inputPath;
}

async function walkFiles(root) {
  const entries = await fs.readdir(root, { recursive: true, withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const ext = path.extname(entry.name).toLowerCase();
    if (!IMAGE_EXTENSIONS.has(ext)) continue;
    const dir = entry.parentPath ?? entry.path; // Node <20 compat: entry.path
    files.push(path.join(dir, entry.name));
  }
  return files;
}

async function readJsonIfExists(filePath) {
  try {
    const raw = await fs.readFile(filePath, 'utf-8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

// Google Takeout sidecar naming is inconsistent (classic `<file>.json`, newer
// `<file>.supplemental-metadata.json`, and various truncated forms when the
// combined path gets too long). Try the common patterns, then fall back to
// scanning the directory for a sidecar whose `title` field matches.
async function findSidecar(mediaPath) {
  const dir = path.dirname(mediaPath);
  const base = path.basename(mediaPath);
  const nameNoExt = base.slice(0, base.length - path.extname(base).length);

  const candidates = [`${base}.json`, `${base}.supplemental-metadata.json`, `${nameNoExt}.json`];

  for (const candidate of candidates) {
    const json = await readJsonIfExists(path.join(dir, candidate));
    if (json) return json;
  }

  // Fallback: scan sibling .json files for one whose "title" matches this file.
  try {
    const siblings = await fs.readdir(dir);
    for (const sibling of siblings) {
      if (!sibling.endsWith('.json')) continue;
      const json = await readJsonIfExists(path.join(dir, sibling));
      if (json && json.title === base) return json;
    }
  } catch {
    // ignore
  }

  return null;
}

async function resolveCreateDate(mediaPath, buffer, sidecar) {
  const timestamp = sidecar?.photoTakenTime?.timestamp;
  if (timestamp) {
    return { date: new Date(Number(timestamp) * 1000), source: 'sidecar' };
  }

  try {
    const exif = await exifr.parse(buffer, ['DateTimeOriginal', 'CreateDate']);
    const exifDate = exif?.DateTimeOriginal ?? exif?.CreateDate;
    if (exifDate instanceof Date && !Number.isNaN(exifDate.getTime())) {
      return { date: exifDate, source: 'exif' };
    }
  } catch {
    // unreadable/corrupt exif — fall through
  }

  const stat = await fs.stat(mediaPath);
  return { date: stat.mtime, source: 'mtime' };
}

async function main() {
  const inputArg = process.argv[2];
  if (!inputArg) {
    console.error('Usage: node scripts/import-takeout.mjs <path-to-unzipped-takeout-export>');
    process.exit(1);
  }

  const inputPath = path.resolve(inputArg);
  const stat = await fs.stat(inputPath).catch(() => null);
  if (!stat || !stat.isDirectory()) {
    console.error(`Not a directory: ${inputPath}`);
    process.exit(1);
  }

  const exportRoot = await resolveExportRoot(inputPath);
  await fs.mkdir(ORIGINALS_DIR, { recursive: true });

  const index = await loadIndex();
  const files = await walkFiles(exportRoot);

  let imported = 0;
  let skipped = 0;
  let missingSidecar = 0;
  let usedExifFallback = 0;
  let usedMtimeFallback = 0;

  for (const filePath of files) {
    const { id, buffer } = await hashFile(filePath);

    if (index[id]) {
      skipped++;
      continue;
    }

    const sidecar = await findSidecar(filePath);
    if (!sidecar) missingSidecar++;

    const { date: createDate, source } = await resolveCreateDate(filePath, buffer, sidecar);
    if (source === 'exif') usedExifFallback++;
    if (source === 'mtime') usedMtimeFallback++;

    const album = path.basename(path.dirname(filePath));
    const ext = path.extname(filePath);
    const destPath = path.join(ORIGINALS_DIR, `${id}${ext}`);
    await fs.writeFile(destPath, buffer);

    index[id] = {
      importedAt: new Date().toISOString(),
      sourcePath: path.relative(PROJECT_ROOT, destPath),
      originalSourcePath: path.relative(exportRoot, filePath),
      album,
      createDate: createDate.toISOString(),
      processed: false,
    };

    imported++;
  }

  await saveIndex(index);

  console.log(`Imported ${imported} new photo(s), skipped ${skipped} duplicate(s).`);
  if (missingSidecar > 0) {
    console.log(`  ${missingSidecar} file(s) had no JSON sidecar (used EXIF/mtime fallback).`);
  }
  if (usedExifFallback > 0) {
    console.log(`  ${usedExifFallback} file(s) used EXIF date as fallback.`);
  }
  if (usedMtimeFallback > 0) {
    console.log(`  ${usedMtimeFallback} file(s) had no sidecar or EXIF date — used file mtime.`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
