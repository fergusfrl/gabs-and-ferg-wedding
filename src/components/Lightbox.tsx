import { useCallback, useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import type { Photo } from '../data/photos';
import { formatPhotoTime } from './formatTime';
import { needsFullRes, prefetchLightboxImage } from './prefetchImage';
import './Lightbox.css';

const TRANSITION_MS = 150;

interface Rect {
  top: number;
  left: number;
  width: number;
  height: number;
}

interface LightboxProps {
  photos: Photo[];
  initialIndex: number;
  getOriginRect: (index: number) => Rect | null;
  // Takes the index being closed from, so the caller can return keyboard
  // focus to the gallery cell the user opened (rather than dropping focus
  // to <body>).
  onClose: (index: number) => void;
}

type Phase = 'opening' | 'open' | 'closing';

function rectToTransform(rect: Rect | null): string {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  if (!rect) {
    return `translate(0, 0) scale(0.85)`;
  }
  const scaleX = rect.width / vw;
  const scaleY = rect.height / vh;
  const translateX = rect.left + rect.width / 2 - vw / 2;
  const translateY = rect.top + rect.height / 2 - vh / 2;
  return `translate(${translateX}px, ${translateY}px) scale(${scaleX}, ${scaleY})`;
}

export default function Lightbox({ photos, initialIndex, getOriginRect, onClose }: LightboxProps) {
  const [index, setIndex] = useState(initialIndex);
  const [phase, setPhase] = useState<Phase>('opening');
  const [openTransform] = useState(() => rectToTransform(getOriginRect(initialIndex)));
  const [closeTransform, setCloseTransform] = useState<string | null>(null);
  const [hqSrc, setHqSrc] = useState<string | null>(null);
  const [navOpacity, setNavOpacity] = useState(1);
  const closeTimeoutRef = useRef<ReturnType<typeof setTimeout>>(0);
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  const photo = photos[index];

  // Kick off the opening transition on mount, and move focus into the
  // dialog so keyboard/screen-reader users land somewhere sensible rather
  // than staying on the (now hidden) gallery cell behind the overlay.
  useEffect(() => {
    closeButtonRef.current?.focus();
    const raf1 = requestAnimationFrame(() => {
      const raf2 = requestAnimationFrame(() => setPhase('open'));
      return () => cancelAnimationFrame(raf2);
    });
    return () => cancelAnimationFrame(raf1);
  }, []);

  // Lock page scroll while the lightbox is open. body/html are pinned to
  // width: 100%, so hiding the scrollbar would otherwise widen them and
  // trigger the gallery's ResizeObserver mid-transition, reflowing the grid
  // underneath. Pinning body to its current pixel width keeps it stable;
  // the sliver where the scrollbar was is hidden behind the opaque overlay.
  useEffect(() => {
    const { overflow, width } = document.body.style;
    document.body.style.width = `${document.documentElement.clientWidth}px`;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = overflow;
      document.body.style.width = width;
    };
  }, []);

  // Preload the full-quality image and swap it in once ready — but only if
  // the display actually needs more pixels than the "large" (1600w) asset
  // already showing can provide. Otherwise every lightbox view would pull
  // down the heaviest asset (2400w) even on phones, which never render it
  // at more than a fraction of that resolution. The full-res original is
  // still just a tap away via the download/open-fullscreen buttons.
  useEffect(() => {
    setHqSrc(null);
    if (!needsFullRes()) return;

    let cancelled = false;
    const img = new Image();
    img.src = photo.src.full;
    img.onload = () => {
      if (!cancelled) setHqSrc(photo.src.full);
    };
    return () => {
      cancelled = true;
    };
  }, [photo]);

  // Get the adjacent photos into cache while the current one is being
  // viewed, so paging with the arrow keys/buttons resolves instantly instead
  // of waiting on a fresh network request.
  useEffect(() => {
    if (index > 0) prefetchLightboxImage(photos[index - 1]);
    if (index < photos.length - 1) prefetchLightboxImage(photos[index + 1]);
  }, [index, photos]);

  const handleDownload = useCallback(async () => {
    const url = photo.src.full;
    const filenameFromUrl = url.split('/').pop()?.split('?')[0];
    const filename = filenameFromUrl && filenameFromUrl.includes('.') ? filenameFromUrl : `${photo.id}.jpg`;

    // The image lives on a different origin (CDN) than the app, so a plain
    // `download` anchor gets ignored by the browser and just navigates the
    // tab to the image instead. Fetching a blob forces a real save; if CORS
    // blocks that, fall back to opening the raw image in a new tab so the
    // gallery itself is never navigated away.
    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error('Download request failed');
      const blob = await response.blob();
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = blobUrl;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(blobUrl);
    } catch {
      window.open(url, '_blank', 'noopener,noreferrer');
    }
  }, [photo]);

  const handleOpenFullscreen = useCallback(() => {
    window.open(photo.src.full, '_blank', 'noopener,noreferrer');
  }, [photo]);

  const requestClose = useCallback(() => {
    const rect = getOriginRect(index);
    setCloseTransform(rectToTransform(rect));
    setPhase('closing');
    closeTimeoutRef.current = setTimeout(() => onClose(index), TRANSITION_MS);
  }, [getOriginRect, index, onClose]);

  const goTo = useCallback(
    (next: number) => {
      if (next < 0 || next >= photos.length || next === index) return;
      setNavOpacity(0);
      setTimeout(() => {
        setIndex(next);
        setNavOpacity(1);
      }, TRANSITION_MS / 2);
    },
    [photos.length, index],
  );

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') requestClose();
      else if (e.key === 'ArrowLeft') goTo(index - 1);
      else if (e.key === 'ArrowRight') goTo(index + 1);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [goTo, requestClose, index]);

  useEffect(() => {
    return () => clearTimeout(closeTimeoutRef.current);
  }, []);

  let transform = 'none';
  if (phase === 'opening') transform = openTransform;
  else if (phase === 'closing') transform = closeTransform ?? openTransform;

  const displaySrc = hqSrc ?? photo.src.large;

  return (
    <div
      className={`lightbox-overlay ${phase === 'open' ? 'lightbox-overlay-visible' : ''}`}
      style={{ '--lightbox-transition-ms': `${TRANSITION_MS}ms` } as CSSProperties}
      role="dialog"
      aria-modal="true"
      aria-label={`Photo ${index + 1} of ${photos.length}`}
      onClick={(e) => {
        if (e.target === e.currentTarget) requestClose();
      }}
    >
      <div className="lightbox-stage">
        <div
          className="lightbox-placeholder"
          style={{
            backgroundImage: `url(${photo.blurDataURL})`,
            transform,
            transition: `transform ${TRANSITION_MS}ms ease, opacity ${TRANSITION_MS}ms ease`,
            opacity: navOpacity,
          }}
        />
        <img
          key={photo.id}
          src={displaySrc}
          alt={`Wedding photo ${index + 1} of ${photos.length}`}
          className="lightbox-image"
          style={{
            transform,
            transition: `transform ${TRANSITION_MS}ms ease, opacity ${TRANSITION_MS}ms ease`,
            opacity: navOpacity,
          }}
        />
      </div>

      <div className="lightbox-time">{formatPhotoTime(photo.createDate)}</div>

      <div className="lightbox-actions">
        <button type="button" className="lightbox-action" onClick={handleDownload} aria-label="Download image">
          <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M12 4v12" strokeLinecap="round" />
            <polyline points="6 11 12 17 18 11" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M5 20h14" strokeLinecap="round" />
          </svg>
        </button>

        <button
          type="button"
          className="lightbox-action"
          onClick={handleOpenFullscreen}
          aria-label="Open full quality image in new tab"
        >
          <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="9 4 4 4 4 9" strokeLinecap="round" strokeLinejoin="round" />
            <polyline points="15 4 20 4 20 9" strokeLinecap="round" strokeLinejoin="round" />
            <polyline points="4 15 4 20 9 20" strokeLinecap="round" strokeLinejoin="round" />
            <polyline points="20 15 20 20 15 20" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>

        <button
          type="button"
          ref={closeButtonRef}
          className="lightbox-action"
          onClick={requestClose}
          aria-label="Close"
        >
          <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="4" y1="4" x2="20" y2="20" strokeLinecap="round" />
            <line x1="20" y1="4" x2="4" y2="20" strokeLinecap="round" />
          </svg>
        </button>
      </div>

      {index > 0 && (
        <button
          type="button"
          className="lightbox-nav lightbox-nav-prev"
          onClick={() => goTo(index - 1)}
          aria-label="Previous photo"
        >
          <svg viewBox="0 0 24 24" width="32" height="32" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="15 4 7 12 15 20" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      )}

      {index < photos.length - 1 && (
        <button
          type="button"
          className="lightbox-nav lightbox-nav-next"
          onClick={() => goTo(index + 1)}
          aria-label="Next photo"
        >
          <svg viewBox="0 0 24 24" width="32" height="32" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="9 4 17 12 9 20" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      )}
    </div>
  );
}
