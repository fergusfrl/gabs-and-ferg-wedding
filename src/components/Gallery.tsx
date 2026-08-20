import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent } from 'react';
import justifiedLayout from 'justified-layout';
import Lightbox from './Lightbox';
import { formatPhotoTime } from './formatTime';
import { prefetchLightboxImage } from './prefetchImage';
import type { Photo } from '../data/photos';
import './Gallery.css';

interface Box {
  top: number;
  left: number;
  width: number;
  height: number;
}

interface GalleryProps {
  photos: Photo[];
}

const TARGET_ROW_HEIGHT = 240;
const BOX_SPACING = 4;
const VIEWPORT_BUFFER_MULTIPLIER = 1.5;
const RESIZE_DEBOUNCE_MS = 150;
// A cursor passing over the grid en route elsewhere shouldn't trigger a
// fetch for every cell it crosses — only hovers that linger long enough to
// suggest real intent to open the photo.
const HOVER_PREFETCH_DELAY_MS = 150;

export default function Gallery({ photos }: GalleryProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const cellRefs = useRef(new Map<number, HTMLDivElement>());
  const [containerWidth, setContainerWidth] = useState(0);
  const [visibleRange, setVisibleRange] = useState({ top: 0, bottom: 0 });
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);

  // Measure the container width on mount and on debounced resize.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const measure = () => setContainerWidth(el.clientWidth);
    measure();

    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    const observer = new ResizeObserver(() => {
      clearTimeout(timeoutId);
      timeoutId = setTimeout(measure, RESIZE_DEBOUNCE_MS);
    });
    observer.observe(el);

    return () => {
      observer.disconnect();
      clearTimeout(timeoutId);
    };
  }, []);

  const layout = useMemo(() => {
    if (containerWidth <= 0 || photos.length === 0) {
      return { boxes: [] as Box[], containerHeight: 0 };
    }
    const geometry = justifiedLayout(
      photos.map((p) => p.aspectRatio),
      {
        containerWidth,
        containerPadding: 0,
        boxSpacing: BOX_SPACING,
        targetRowHeight: TARGET_ROW_HEIGHT,
        targetRowHeightTolerance: 0.25,
      },
    );
    return { boxes: geometry.boxes as Box[], containerHeight: geometry.containerHeight as number };
  }, [photos, containerWidth]);

  // Virtualize: only cells whose box intersects [scroll - buffer, scroll + viewport + buffer]
  // get real <img> work; everything else is an empty placeholder div of the right size.
  useEffect(() => {
    let ticking = false;

    const update = () => {
      ticking = false;
      const el = containerRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const viewportHeight = window.innerHeight;
      const buffer = viewportHeight * VIEWPORT_BUFFER_MULTIPLIER;
      setVisibleRange({
        top: -rect.top - buffer,
        bottom: -rect.top + viewportHeight + buffer,
      });
    };

    update();

    const onScroll = () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(update);
    };

    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
    };
  }, [layout.containerHeight]);

  // Boxes come out of justified-layout in row order, and every box in a row
  // shares the same top/height, so `top + height` only ever increases going
  // down the page. That monotonicity lets us binary-search the first
  // possibly-visible box instead of mapping over and rendering all 1000+
  // cells (most as empty placeholders) on every scroll-driven update.
  const visibleIndices = useMemo(() => {
    const boxes = layout.boxes;
    if (boxes.length === 0) return [] as number[];

    let lo = 0;
    let hi = boxes.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (boxes[mid].top + boxes[mid].height < visibleRange.top) lo = mid + 1;
      else hi = mid;
    }

    const indices: number[] = [];
    for (let i = lo; i < boxes.length && boxes[i].top <= visibleRange.bottom; i++) {
      indices.push(i);
    }
    return indices;
  }, [layout.boxes, visibleRange]);

  const registerCellRef = useCallback((index: number, el: HTMLDivElement | null) => {
    if (el) cellRefs.current.set(index, el);
    else cellRefs.current.delete(index);
  }, []);

  const getOriginRect = useCallback((index: number) => {
    const el = cellRefs.current.get(index);
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    return { top: rect.top, left: rect.left, width: rect.width, height: rect.height };
  }, []);

  const openAt = useCallback((index: number) => {
    setLightboxIndex(index);
  }, []);

  const closeLightbox = useCallback((index: number) => {
    cellRefs.current.get(index)?.focus();
    setLightboxIndex(null);
  }, []);

  return (
    <div ref={containerRef} className="gallery" style={{ height: layout.containerHeight }}>
      {visibleIndices.map((index) => (
        <Cell
          key={photos[index].id}
          photo={photos[index]}
          box={layout.boxes[index]}
          index={index}
          total={photos.length}
          onOpen={openAt}
          registerRef={registerCellRef}
        />
      ))}

      {lightboxIndex !== null && (
        <Lightbox
          photos={photos}
          initialIndex={lightboxIndex}
          getOriginRect={getOriginRect}
          onClose={closeLightbox}
        />
      )}
    </div>
  );
}

interface CellProps {
  photo: Photo;
  box: Box;
  index: number;
  total: number;
  onOpen: (index: number) => void;
  registerRef: (index: number, el: HTMLDivElement | null) => void;
}

function Cell({ photo, box, index, total, onOpen, registerRef }: CellProps) {
  const [loaded, setLoaded] = useState(false);
  const cellWidth = Math.round(box.width);
  const hoverTimeoutRef = useRef<ReturnType<typeof setTimeout>>();

  const srcSet = [
    `${photo.src.thumb} 400w`,
    `${photo.src.medium} 800w`,
    `${photo.src.large} 1600w`,
    `${photo.src.full} 2400w`,
  ].join(', ');

  const handleKeyDown = (e: ReactKeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onOpen(index);
    }
  };

  const handleMouseEnter = () => {
    hoverTimeoutRef.current = setTimeout(() => prefetchLightboxImage(photo), HOVER_PREFETCH_DELAY_MS);
  };

  const handleMouseLeave = () => {
    clearTimeout(hoverTimeoutRef.current);
  };

  useEffect(() => () => clearTimeout(hoverTimeoutRef.current), []);

  return (
    <div
      ref={(el) => registerRef(index, el)}
      className="gallery-cell"
      style={{ top: box.top, left: box.left, width: box.width, height: box.height }}
      role="button"
      tabIndex={0}
      onClick={() => onOpen(index)}
      onKeyDown={handleKeyDown}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      <div className="gallery-cell-placeholder" style={{ backgroundImage: `url(${photo.blurDataURL})` }} />
      <img
        src={photo.src.medium}
        srcSet={srcSet}
        sizes={`${cellWidth}px`}
        alt={`Wedding photo ${index + 1} of ${total}`}
        loading="lazy"
        className={loaded ? 'loaded' : undefined}
        onLoad={() => setLoaded(true)}
      />
      <div className="gallery-cell-time">{formatPhotoTime(photo.createDate)}</div>
    </div>
  );
}
