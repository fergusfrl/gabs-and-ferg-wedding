import type { Photo } from '../data/photos';

// A hovered gallery cell or a lightbox neighbour only needs to be fast once
// the user actually acts on it, so we prefetch via a plain Image() (no <link>
// tag, no fetch()) — the browser slots it in around whatever it's already
// doing instead of competing for priority with on-screen work. Track what
// we've already requested so hovering the same cell twice, or paging back
// and forth in the lightbox, doesn't refetch.
const prefetched = new Set<string>();

function prefetchUrl(url: string): void {
  if (prefetched.has(url)) return;
  prefetched.add(url);
  const img = new Image();
  img.src = url;
}

// Mirrors the gate in Lightbox's own hi-res upgrade: only worth pulling the
// heaviest (2400w) asset when the display can actually resolve more detail
// than the 1600w "large" asset already provides.
export function needsFullRes(): boolean {
  return window.innerWidth * (window.devicePixelRatio || 1) > 1600;
}

// Prefetches whatever quality the lightbox would end up displaying for this
// photo, so opening it (from a gallery hover) or paging to it (from lightbox
// prev/next) resolves from cache instead of a fresh network request.
export function prefetchLightboxImage(photo: Photo): void {
  prefetchUrl(photo.src.large);
  if (needsFullRes()) prefetchUrl(photo.src.full);
}
