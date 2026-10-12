import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, ZoomIn, ZoomOut, RotateCcw } from 'lucide-react';

const MIN_SCALE = 1;
const MAX_SCALE = 8;
const DRAG_THRESHOLD = 4; // px of movement before a press counts as a pan, not a click

interface Props {
  src: string;
  alt?: string;
  onClose: () => void;
}

interface View {
  scale: number;
  x: number;
  y: number;
}

/**
 * Fullscreen image viewer: wheel / pinch to zoom, drag to pan, double-click to toggle.
 * Rendered through a portal so it escapes transformed or backdrop-filtered ancestors
 * (the flip card, sticky glass bars, slide-up animations), which would otherwise become
 * the containing block for `position: fixed` and break true fullscreen.
 */
export default function ImageLightbox({ src, alt = '', onClose }: Props) {
  const [view, setView] = useState<View>({ scale: 1, x: 0, y: 0 });
  const stageRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinchRef = useRef<{ distance: number; scale: number } | null>(null);
  const panRef = useRef<{ x: number; y: number; view: View } | null>(null);
  const draggedRef = useRef(false);
  const pressedOnStageRef = useRef(false);

  const clampScale = (s: number) => Math.min(MAX_SCALE, Math.max(MIN_SCALE, s));

  /** Keeps the image covering the viewport without drifting past its edges. */
  const clampTranslate = useCallback((scale: number, x: number, y: number) => {
    const stage = stageRef.current;
    const img = imgRef.current;
    if (!stage || !img) return { x, y };
    const maxX = Math.max(0, (img.offsetWidth * scale - stage.clientWidth) / 2);
    const maxY = Math.max(0, (img.offsetHeight * scale - stage.clientHeight) / 2);
    return {
      x: Math.min(maxX, Math.max(-maxX, x)),
      y: Math.min(maxY, Math.max(-maxY, y)),
    };
  }, []);

  /** Zoom around the viewport-centre-relative point (cx, cy), so it stays under the cursor. */
  const zoomAt = useCallback((nextScale: number, cx = 0, cy = 0) => {
    setView((v) => {
      const scale = clampScale(nextScale);
      if (scale === v.scale) return v;
      const ratio = scale / v.scale;
      const t = clampTranslate(scale, cx - ratio * (cx - v.x), cy - ratio * (cy - v.y));
      return { scale, x: t.x, y: t.y };
    });
  }, [clampTranslate]);

  /** Zoom around the centre (used by the toolbar buttons and keyboard). */
  const zoomBy = useCallback((factor: number) => {
    setView((v) => {
      const scale = clampScale(v.scale * factor);
      if (scale === v.scale) return v;
      const ratio = scale / v.scale;
      const t = clampTranslate(scale, v.x * ratio, v.y * ratio);
      return { scale, x: t.x, y: t.y };
    });
  }, [clampTranslate]);

  const reset = useCallback(() => setView({ scale: 1, x: 0, y: 0 }), []);

  // Lock background scroll while open.
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, []);

  // Escape closes, +/- zoom, 0 resets.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); onClose(); }
      else if (e.key === '+' || e.key === '=') { e.preventDefault(); zoomBy(1.5); }
      else if (e.key === '-' || e.key === '_') { e.preventDefault(); zoomBy(1 / 1.5); }
      else if (e.key === '0') { e.preventDefault(); reset(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, zoomBy, reset]);

  // Native (non-passive) wheel listener so zooming can preventDefault the page scroll.
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = stage.getBoundingClientRect();
      const cx = e.clientX - (rect.left + rect.width / 2);
      const cy = e.clientY - (rect.top + rect.height / 2);
      setView((v) => {
        const scale = clampScale(v.scale * Math.exp(-e.deltaY * 0.0015));
        if (scale === v.scale) return v;
        const ratio = scale / v.scale;
        const t = clampTranslate(scale, cx - ratio * (cx - v.x), cy - ratio * (cy - v.y));
        return { scale, x: t.x, y: t.y };
      });
    };
    stage.addEventListener('wheel', onWheel, { passive: false });
    return () => stage.removeEventListener('wheel', onWheel);
  }, [clampTranslate]);

  const relative = (clientX: number, clientY: number) => {
    const rect = stageRef.current!.getBoundingClientRect();
    return { x: clientX - (rect.left + rect.width / 2), y: clientY - (rect.top + rect.height / 2) };
  };

  function onPointerDown(e: React.PointerEvent) {
    pressedOnStageRef.current = e.target === stageRef.current;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    draggedRef.current = false;
    if (pointers.current.size === 1) {
      panRef.current = { x: e.clientX, y: e.clientY, view };
      pinchRef.current = null;
    } else if (pointers.current.size === 2) {
      panRef.current = null;
      const [a, b] = [...pointers.current.values()];
      pinchRef.current = { distance: Math.hypot(a.x - b.x, a.y - b.y), scale: view.scale };
    }
  }

  function onPointerMove(e: React.PointerEvent) {
    if (!pointers.current.has(e.pointerId)) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (pointers.current.size === 2 && pinchRef.current) {
      const [a, b] = [...pointers.current.values()];
      const distance = Math.hypot(a.x - b.x, a.y - b.y);
      const start = pinchRef.current;
      const { x: cx, y: cy } = relative((a.x + b.x) / 2, (a.y + b.y) / 2);
      draggedRef.current = true;
      setView((v) => {
        const scale = clampScale(start.scale * (distance / (start.distance || 1)));
        const ratio = scale / v.scale;
        const t = clampTranslate(scale, cx - ratio * (cx - v.x), cy - ratio * (cy - v.y));
        return { scale, x: t.x, y: t.y };
      });
      return;
    }

    const pan = panRef.current;
    if (pointers.current.size === 1 && pan) {
      const dx = e.clientX - pan.x;
      const dy = e.clientY - pan.y;
      if (Math.hypot(dx, dy) > DRAG_THRESHOLD) draggedRef.current = true;
      setView(() => {
        const t = clampTranslate(pan.view.scale, pan.view.x + dx, pan.view.y + dy);
        return { scale: pan.view.scale, x: t.x, y: t.y };
      });
    }
  }

  function onPointerEnd(e: React.PointerEvent) {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) pinchRef.current = null;
    if (pointers.current.size === 0) {
      panRef.current = null;
    } else if (pointers.current.size === 1) {
      const [p] = [...pointers.current.values()];
      panRef.current = { x: p.x, y: p.y, view };
    }
  }

  function onPointerUp(e: React.PointerEvent) {
    const wasOnlyPointer = pointers.current.size === 1;
    onPointerEnd(e);
    // A plain tap on the backdrop (not the image, no pan) closes the viewer.
    if (wasOnlyPointer && pointers.current.size === 0 && pressedOnStageRef.current && !draggedRef.current) {
      onClose();
    }
  }

  function onDoubleClick(e: React.MouseEvent) {
    const { x, y } = relative(e.clientX, e.clientY);
    if (view.scale > MIN_SCALE) reset();
    else zoomAt(2.5, x, y);
  }

  return createPortal(
    <div
      className="fixed inset-0 z-[100] select-none bg-slate-950/95 backdrop-blur-sm animate-fade-in"
      role="dialog"
      aria-modal="true"
      aria-label={alt ? `Image: ${alt}` : 'Image viewer'}
    >
      <div
        ref={stageRef}
        className="absolute inset-0 flex items-center justify-center overflow-hidden [touch-action:none] cursor-grab active:cursor-grabbing"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerEnd}
        onDoubleClick={onDoubleClick}
      >
        <img
          ref={imgRef}
          src={src}
          alt={alt}
          draggable={false}
          className="max-h-full max-w-full object-contain will-change-transform"
          style={{ transform: `translate3d(${view.x}px, ${view.y}px, 0) scale(${view.scale})` }}
        />
      </div>

      {/* Toolbar */}
      <div className="pointer-events-none absolute inset-x-0 top-0 flex items-center justify-between gap-2 p-3 sm:p-4">
        <span className="pointer-events-auto rounded-lg bg-slate-900/70 px-2 py-1 text-xs font-mono tabular-nums text-slate-400">
          {Math.round(view.scale * 100)}%
        </span>
        <div className="pointer-events-auto flex items-center gap-1.5">
          <button onClick={() => zoomBy(1 / 1.5)} disabled={view.scale <= MIN_SCALE} className="btn-ghost p-2 disabled:opacity-30" title="Zoom out (−)">
            <ZoomOut className="w-5 h-5" />
          </button>
          <button onClick={() => zoomBy(1.5)} disabled={view.scale >= MAX_SCALE} className="btn-ghost p-2 disabled:opacity-30" title="Zoom in (+)">
            <ZoomIn className="w-5 h-5" />
          </button>
          <button onClick={reset} disabled={view.scale === MIN_SCALE && view.x === 0 && view.y === 0} className="btn-ghost p-2 disabled:opacity-30" title="Reset (0)">
            <RotateCcw className="w-5 h-5" />
          </button>
          <button onClick={onClose} className="btn-ghost p-2" title="Close (Esc)">
            <X className="w-5 h-5" />
          </button>
        </div>
      </div>

      <p className="pointer-events-none absolute inset-x-0 bottom-4 text-center text-xs text-slate-500">
        Scroll or pinch to zoom · drag to pan · double-click to toggle
      </p>
    </div>,
    document.body,
  );
}
