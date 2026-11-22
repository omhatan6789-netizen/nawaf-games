import React from 'react';
import { Crown, RotateCcw, Home } from 'lucide-react';
import type { GameMode, PlayerSide, StartingScore } from '../game/dartsTypes';

interface EndMatchOverlayProps {
  open: boolean;
  mode: GameMode;
  mySide: PlayerSide;
  winnerSide: PlayerSide | null;
  winnerName: string | null;
  redName: string;
  blueName: string;
  redScore: number;
  blueScore: number;
  startingScore: StartingScore;
  reason: 'checkout' | 'withdraw' | null;
  rematchPending: boolean;
  onRematch: () => void;
  onExitHome: () => void;
}

export const EndMatchOverlay: React.FC<EndMatchOverlayProps> = ({
  open,
  mode,
  mySide,
  winnerSide,
  winnerName,
  redName,
  blueName,
  redScore,
  blueScore,
  startingScore,
  reason,
  rematchPending,
  onRematch,
  onExitHome,
}) => {
  if (!open || !winnerSide) return null;

  const isLocal = mode === 'local';
  const iWon = isLocal ? true : winnerSide === mySide;
  const displayWinner = winnerName || (winnerSide === 'red' ? redName : blueName);

  const headline = isLocal
    ? '🏆 انتهت المباراة!'
    : iWon
      ? '🏆 مبروك الفوز!'
      : 'انتهت المواجهة!';

  const reasonText =
    reason === 'withdraw'
      ? `انتهت المباراة بانسحاب ${winnerSide === 'red' ? blueName : redName}.`
      : `وصل ${displayWinner} إلى الصفر (0) من أصل ${startingScore} نقطة وحسم الفوز!`;

  return (
    <div className="online-end-overlay">
      <div className="online-end-card">
        <div className="mx-auto mb-2 flex h-14 w-14 items-center justify-center rounded-2xl border border-amber-300/35 bg-amber-400/15 text-amber-300">
          <Crown className="h-8 w-8" />
        </div>

        <h2>{headline}</h2>

        <div
          className={`online-end-winner ${
            winnerSide === 'blue' ? 'is-blue' : ''
          }`}
        >
          الفائز: {displayWinner}
        </div>

        <p>{reasonText}</p>

        {/* Final Remaining Score Cards */}
        <div className="mb-4 grid grid-cols-2 gap-2.5 text-center">
          <div className="rounded-2xl border border-rose-400/35 bg-black/35 px-3 py-2.5">
            <div className="truncate text-xs font-extrabold text-rose-200">
              {redName}
            </div>
            <div className="mt-1 text-2xl font-black text-rose-400 tabular-nums">
              {redScore}
            </div>
            <div className="text-[11px] font-bold text-white/55">
              {redScore === 0 ? 'وصل للصفر ✓' : 'النقاط المتبقية'}
            </div>
          </div>

          <div className="rounded-2xl border border-sky-400/35 bg-black/35 px-3 py-2.5">
            <div className="truncate text-xs font-extrabold text-sky-200">
              {blueName}
            </div>
            <div className="mt-1 text-2xl font-black text-sky-400 tabular-nums">
              {blueScore}
            </div>
            <div className="text-[11px] font-bold text-white/55">
              {blueScore === 0 ? 'وصل للصفر ✓' : 'النقاط المتبقية'}
            </div>
          </div>
        </div>

        <div className="online-end-actions">
          <button
            type="button"
            onClick={onRematch}
            disabled={rematchPending}
            className="flex items-center justify-center gap-2"
          >
            <RotateCcw className="h-4 w-4" />
            <span>{rematchPending ? 'بانتظار موافقة الخصم...' : 'لعب مرة أخرى'}</span>
          </button>

          <button
            type="button"
            onClick={onExitHome}
            className="secondary-end flex items-center justify-center gap-2"
          >
            <Home className="h-4 w-4" />
            <span>العودة للرئيسية</span>
          </button>
        </div>
      </div>
    </div>
  );
};
