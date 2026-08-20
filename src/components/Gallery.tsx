import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import justifiedLayout from 'justified-layout';
import Lightbox from './Lightbox';
import { formatPhotoTime } from './formatTime';
import './Gallery.css';

interface PhotoSrc {
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

  const closeLightbox = useCallback(() => {
    setLightboxIndex(null);
  }, []);

  return (
    <div ref={containerRef} className="gallery" style={{ height: layout.containerHeight }}>
      {photos.map((photo, index) => {
        const box = layout.boxes[index];
        if (!box) return null;

        const isVisible = box.top + box.height >= visibleRange.top && box.top <= visibleRange.bottom;

        if (!isVisible) {
          return (
            <div
              key={photo.id}
              className="gallery-cell"
              style={{ top: box.top, left: box.left, width: box.width, height: box.height }}
            />
          );
        }

        return (
          <Cell
            key={photo.id}
            photo={photo}
            box={box}
            index={index}
            onOpen={openAt}
            registerRef={registerCellRef}
          />
        );
      })}

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
  onOpen: (index: number) => void;
  registerRef: (index: number, el: HTMLDivElement | null) => void;
}

function Cell({ photo, box, index, onOpen, registerRef }: CellProps) {
  const [loaded, setLoaded] = useState(false);
  const cellWidth = Math.round(box.width);

  const srcSet = [
    `${photo.src.thumb} 400w`,
    `${photo.src.medium} 800w`,
    `${photo.src.large} 1600w`,
    `${photo.src.full} 2400w`,
  ].join(', ');

  return (
    <div
      ref={(el) => registerRef(index, el)}
      className="gallery-cell"
      style={{ top: box.top, left: box.left, width: box.width, height: box.height }}
      onClick={() => onOpen(index)}
    >
      <div className="gallery-cell-placeholder" style={{ backgroundImage: `url(${photo.blurDataURL})` }} />
      <img
        src={photo.src.medium}
        srcSet={srcSet}
        sizes={`${cellWidth}px`}
        alt={photo.album}
        loading="lazy"
        className={loaded ? 'loaded' : undefined}
        onLoad={() => setLoaded(true)}
      />
      <div className="gallery-cell-time">{formatPhotoTime(photo.createDate)}</div>
    </div>
  );
}
