import { useCallback, useEffect, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { formatPhotoTime } from './formatTime';
import type { Photo } from './Gallery';
import './ScrollRail.css';

interface ScrollRailProps {
  photos: Photo[];
}

const BACK_TO_TOP_THRESHOLD = 480;

function getMaxScroll() {
  return document.documentElement.scrollHeight - window.innerHeight;
}

export default function ScrollRail({ photos }: ScrollRailProps) {
  const trackRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);

  const [progress, setProgress] = useState(0);
  const [previewFraction, setPreviewFraction] = useState(0);
  const [hovering, setHovering] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [showBackToTop, setShowBackToTop] = useState(false);

  const updateFromScroll = useCallback(() => {
    const max = getMaxScroll();
    setProgress(max > 0 ? Math.min(1, Math.max(0, window.scrollY / max)) : 0);
    setShowBackToTop(window.scrollY > BACK_TO_TOP_THRESHOLD);
  }, []);

  useEffect(() => {
    updateFromScroll();
    window.addEventListener('scroll', updateFromScroll, { passive: true });
    window.addEventListener('resize', updateFromScroll);
    return () => {
      window.removeEventListener('scroll', updateFromScroll);
      window.removeEventListener('resize', updateFromScroll);
    };
  }, [updateFromScroll]);

  const fractionFromPointer = useCallback((clientY: number) => {
    const track = trackRef.current;
    if (!track) return 0;
    const rect = track.getBoundingClientRect();
    return Math.min(1, Math.max(0, (clientY - rect.top) / rect.height));
  }, []);

  const scrollToFraction = useCallback((fraction: number) => {
    window.scrollTo({ top: fraction * getMaxScroll() });
  }, []);

  const handlePointerMove = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      const fraction = fractionFromPointer(e.clientY);
      setPreviewFraction(fraction);
      if (draggingRef.current) {
        setProgress(fraction);
        scrollToFraction(fraction);
      }
    },
    [fractionFromPointer, scrollToFraction],
  );

  const handlePointerDown = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      draggingRef.current = true;
      setDragging(true);
      e.currentTarget.setPointerCapture(e.pointerId);
      const fraction = fractionFromPointer(e.clientY);
      setPreviewFraction(fraction);
      setProgress(fraction);
      scrollToFraction(fraction);
    },
    [fractionFromPointer, scrollToFraction],
  );

  const handlePointerUp = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    draggingRef.current = false;
    setDragging(false);
    e.currentTarget.releasePointerCapture(e.pointerId);
  }, []);

  const interacting = hovering || dragging;
  const badgeIndex = Math.min(photos.length - 1, Math.max(0, Math.floor(previewFraction * photos.length)));
  const badgePhoto = photos[badgeIndex];

  return (
    <>
      <div
        ref={trackRef}
        className="scroll-rail"
        onPointerEnter={() => setHovering(true)}
        onPointerLeave={() => setHovering(false)}
        onPointerMove={handlePointerMove}
        onPointerDown={handlePointerDown}
        onPointerUp={handlePointerUp}
      >
        <div className="scroll-rail-fill" style={{ height: `${progress * 100}%` }} />
        <div className="scroll-rail-thumb" style={{ top: `${progress * 100}%` }} />

        {interacting && badgePhoto && (
          <div className="scroll-rail-time" style={{ top: `${previewFraction * 100}%` }}>
            {formatPhotoTime(badgePhoto.createDate)}
          </div>
        )}
      </div>

      <button
        type="button"
        className={`back-to-top ${showBackToTop ? 'visible' : ''}`}
        onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
        aria-label="Back to top"
      >
        ↑
      </button>
    </>
  );
}
