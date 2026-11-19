import React, { useCallback, useRef } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

interface StrikerSliderProps {
  value: number; // -1 .. +1
  disabled: boolean;
  overlapping: boolean;
  onChange: (nextNorm: number) => void;
  onDragStart?: () => void;
  onDragEnd?: () => void;
}

export function StrikerSlider({
  value,
  disabled,
  overlapping,
  onChange,
  onDragStart,
  onDragEnd,
}: StrikerSliderProps) {
  const trackRef = useRef<HTMLDivElement | null>(null);
  const draggingRef = useRef(false);

  const updateFromClientX = useCallback(
    (clientX: number) => {
      const el = trackRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const pad = 22;
      const usable = Math.max(1, rect.width - pad * 2);
      const raw = (clientX - (rect.left + pad)) / usable;
      const norm = Math.max(-1, Math.min(1, raw * 2 - 1));
      onChange(norm);
    },
    [onChange]
  );

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (disabled) return;
    e.preventDefault();
    draggingRef.current = true;
    e.currentTarget.setPointerCapture(e.pointerId);
    onDragStart?.();
    updateFromClientX(e.clientX);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!draggingRef.current || disabled) return;
    updateFromClientX(e.clientX);
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!draggingRef.current) return;
    draggingRef.current = false;
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      // ignore if already released
    }
    onDragEnd?.();
  };

  const pct = ((Math.max(-1, Math.min(1, value)) + 1) / 2) * 100;

  return (
    <div
      dir="ltr"
      className={`w-full select-none rounded-2xl border px-3 py-2.5 transition-opacity ${
        disabled
          ? 'opacity-50 border-white/15 bg-[#16080b]/80 cursor-not-allowed'
          : overlapping
            ? 'border-rose-500/70 bg-[#240a0e] shadow-[0_0_20px_rgba(239,68,68,0.28)]'
            : 'border-[#d59a66]/55 bg-gradient-to-b from-[#33170e] to-[#1a0a07] shadow-[0_8px_22px_rgba(0,0,0,0.5)]'
      }`}
    >
      <div className="flex items-center gap-2">
        <button
          type="button"
          disabled={disabled}
          onClick={() => onChange(Math.max(-1, value - 0.14))}
          aria-label="تحريك لليسار"
          className="w-8 h-8 rounded-full border border-white/15 bg-black/35 text-amber-200 flex items-center justify-center shrink-0 hover:bg-black/55 disabled:opacity-40 cursor-pointer"
        >
          <ChevronLeft className="w-4 h-4" />
        </button>

        <div
          ref={trackRef}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
          role="slider"
          aria-label="سحّاب مكان قرص التسديد"
          aria-valuemin={-100}
          aria-valuemax={100}
          aria-valuenow={Math.round(value * 100)}
          tabIndex={disabled ? -1 : 0}
          onKeyDown={(e) => {
            if (disabled) return;
            if (e.key === 'ArrowLeft') onChange(Math.max(-1, value - 0.08));
            if (e.key === 'ArrowRight') onChange(Math.min(1, value + 0.08));
          }}
          className={`relative flex-1 h-11 flex items-center touch-none ${
            disabled ? 'cursor-not-allowed' : 'cursor-grab active:cursor-grabbing'
          }`}
        >
          {/* Wooden recessed slider groove */}
          <div className="w-full h-3.5 rounded-full bg-gradient-to-b from-[#0d0504] to-[#23100a] border border-[#b98253]/40 shadow-inner relative overflow-hidden">
            {/* Baseline end dots matching Carrom board */}
            <span className="absolute left-1.5 top-1/2 -translate-y-1/2 w-2 h-2 rounded-full bg-[#d36f56]" />
            <span className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-0.5 h-2.5 bg-amber-200/30" />
            <span className="absolute right-1.5 top-1/2 -translate-y-1/2 w-2 h-2 rounded-full bg-[#d36f56]" />
          </div>

          {/* Draggable Jewel Striker Knob */}
          <div
            style={{ left: `calc(22px + (100% - 44px) * ${pct / 100})` }}
            className={`absolute top-1/2 -translate-x-1/2 -translate-y-1/2 w-10 h-10 rounded-full flex items-center justify-center shadow-[0_4px_12px_rgba(0,0,0,0.65)] transition-transform duration-75 ${
              overlapping
                ? 'bg-gradient-to-br from-rose-300 via-red-600 to-red-900 border-2 border-rose-200'
                : 'bg-gradient-to-br from-emerald-200 via-emerald-500 to-emerald-900 border-2 border-amber-200'
            }`}
          >
            <div
              className={`w-6 h-6 rounded-full border flex items-center justify-center ${
                overlapping ? 'border-rose-100/70' : 'border-amber-400/90'
              }`}
            >
              <div
                className={`w-2.5 h-2.5 rounded-full ${
                  overlapping ? 'bg-rose-100' : 'bg-amber-100'
                }`}
              />
            </div>
          </div>
        </div>

        <button
          type="button"
          disabled={disabled}
          onClick={() => onChange(Math.min(1, value + 0.14))}
          aria-label="تحريك لليمين"
          className="w-8 h-8 rounded-full border border-white/15 bg-black/35 text-amber-200 flex items-center justify-center shrink-0 hover:bg-black/55 disabled:opacity-40 cursor-pointer"
        >
          <ChevronRight className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
