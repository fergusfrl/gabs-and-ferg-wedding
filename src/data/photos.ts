import raw from './photos.json';

export interface PhotoSrc {
  thumb: string;
  medium: string;
  large: string;
  full: string;
}

export interface Photo {
  id: string;
  album: string;
  createDate: string;
  width: number;
  height: number;
  aspectRatio: number;
  blurDataURL: string;
  src: PhotoSrc;
}

const REQUIRED_STRING_FIELDS = ['id', 'album', 'createDate', 'blurDataURL'] as const;
const REQUIRED_NUMBER_FIELDS = ['width', 'height', 'aspectRatio'] as const;
const REQUIRED_SRC_FIELDS = ['thumb', 'medium', 'large', 'full'] as const;

// scripts/build-manifest.mjs writes this manifest without any type checking of
// its own, so a bad manual edit or a partial script run can silently produce
// entries the rest of the app doesn't expect. Validate the shape once, here,
// so a broken manifest fails loudly at build/dev time instead of surfacing as
// a confusing runtime error somewhere in the gallery UI.
function validate(entries: unknown[]): Photo[] {
  const errors: string[] = [];

  entries.forEach((entry, index) => {
    const label = `entry ${index}${isRecord(entry) && typeof entry.id === 'string' ? ` (${entry.id})` : ''}`;

    if (!isRecord(entry)) {
      errors.push(`${label}: not an object`);
      return;
    }
    for (const field of REQUIRED_STRING_FIELDS) {
      if (typeof entry[field] !== 'string') errors.push(`${label}: "${field}" must be a string`);
    }
    for (const field of REQUIRED_NUMBER_FIELDS) {
      if (typeof entry[field] !== 'number') errors.push(`${label}: "${field}" must be a number`);
    }
    if (!isRecord(entry.src)) {
      errors.push(`${label}: "src" must be an object`);
    } else {
      for (const field of REQUIRED_SRC_FIELDS) {
        if (typeof entry.src[field] !== 'string') errors.push(`${label}: "src.${field}" must be a string`);
      }
    }
  });

  if (errors.length > 0) {
    throw new Error(`Invalid src/data/photos.json — ${errors.length} problem(s):\n${errors.join('\n')}`);
  }

  return entries as Photo[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

// scripts/build-manifest.mjs sorts by createDate before writing the manifest —
// this is the only place that invariant should be enforced, so callers can
// trust the order rather than re-sorting at render time.
export const photos: Photo[] = validate(raw as unknown[]);
