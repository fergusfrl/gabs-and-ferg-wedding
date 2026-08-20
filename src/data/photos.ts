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

// scripts/build-manifest.mjs sorts by createDate before writing the manifest —
// this is the only place that invariant should be enforced, so callers can
// trust the order rather than re-sorting at render time.
export const photos: Photo[] = raw as Photo[];
