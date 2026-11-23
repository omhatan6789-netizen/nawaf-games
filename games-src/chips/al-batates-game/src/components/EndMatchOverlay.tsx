import React from 'react';
import { Crown, Bomb, RotateCcw, Home, Heart } from 'lucide-react';
import {
  DIFFICULTY_META,
  MAX_HEARTS,
  type Difficulty,
  type GameMode,
} from '../types/game';

interface EndMatchOverlayProps {
  open: boolean;
  mode: GameMode;
  playerWon: boolean;
  withdrawnByMe?: boolean;
  withdrawnByOpponent?: boolean;
  playerName: string;
  opponentName: string;
  playerHearts: number;
  opponentHearts: number;
  difficulty: Difficulty;
  rematchPending?: boolean;
  onRematch: () => void;
  onExitHome: () => void;
}

const MiniHearts: React.FC<{ count: number }> = ({ count }) => (
  <div className="mt-1.5 flex items-center justify-center gap-1">
    {Array.from({ length: MAX_HEARTS }).map((_, idx) => (
      <Heart
        key={idx}
        className={`h-4 w-4 ${
          idx < count
            ? 'fill-rose-500 text-rose-400'
            : 'fill-white/10 text-white/25'
        }`}
      />
    ))}
  </div>
);

export const EndMatchOverlay: React.FC<EndMatchOverlayProps> = ({
  open,
  mode,
  playerWon,
  withdrawnByMe = false,
  withdrawnByOpponent = false,
  playerName,
  opponentName,
  playerHearts,
  opponentHearts,
  difficulty,
  rematchPending = false,
  onRematch,
  onExitHome,
}) => {
  if (!open) return null;

  const displayName = playerName.trim() || 'أنت';
  const displayOpponent =
    mode === 'bot' ? 'البوت' : opponentName.trim() || 'الخصم';
  const winnerLabel = playerWon ? displayName : displayOpponent;
  const headline = playerWon ? '🏆 مبروك الفوز!' : 'انتهت المواجهة!';

  let reasonText = '';
  if (withdrawnByMe) {
    reasonText = `انسحبت من المواجهة أمام ${displayOpponent}.`;
  } else if (withdrawnByOpponent) {
    reasonText = `انتهت المباراة بانسحاب ${displayOpponent}!`;
  } else if (playerWon) {
    reasonText = `${displayOpponent} أكل القنابل اللي خبيتها وحسمت المواجهة!`;
  } else {
    reasonText = `أكلت القنابل اللي خباها ${displayOpponent} وخسرت قلوبك الثلاثة.`;
  }

  return (
    <div
      className="online-end-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="end-match-title"
    >
      <div className="online-end-card">
        <div
          className={`mx-auto mb-2 flex h-14 w-14 items-center justify-center rounded-2xl border ${
            playerWon
              ? 'border-amber-300/35 bg-amber-400/15 text-amber-300'
              : 'border-rose-400/35 bg-rose-500/15 text-rose-300'
          }`}
        >
          {playerWon ? (
            <Crown className="h-8 w-8" />
          ) : (
            <Bomb className="h-8 w-8" />
          )}
        </div>

        <h2 id="end-match-title">{headline}</h2>

        <div className={`online-end-winner ${playerWon ? 'is-gold' : ''}`}>
          الفائز: {winnerLabel}
        </div>

        <p>{reasonText}</p>

        {/* Final Remaining Hearts Cards */}
        <div className="mb-4 grid grid-cols-2 gap-2.5 text-center">
          <div className="rounded-2xl border border-sky-400/35 bg-black/35 px-3 py-2.5">
            <div className="truncate text-xs font-extrabold text-sky-200">
              {displayName}
            </div>
            <div className="mt-1 text-2xl font-black text-sky-400 tabular-nums">
              {playerHearts}
            </div>
            <MiniHearts count={playerHearts} />
            <div className="mt-1 text-[11px] font-bold text-white/55">
              {withdrawnByMe
                ? 'انسحب من الجولة'
                : playerHearts > 0
                  ? 'صمد في الجولة ✓'
                  : 'فقد جميع القلوب'}
            </div>
          </div>

          <div className="rounded-2xl border border-rose-400/35 bg-black/35 px-3 py-2.5">
            <div className="truncate text-xs font-extrabold text-rose-200">
              {mode === 'bot'
                ? `البوت (${DIFFICULTY_META[difficulty].label})`
                : displayOpponent}
            </div>
            <div className="mt-1 text-2xl font-black text-rose-400 tabular-nums">
              {opponentHearts}
            </div>
            <MiniHearts count={opponentHearts} />
            <div className="mt-1 text-[11px] font-bold text-white/55">
              {withdrawnByOpponent
                ? 'انسحب من الجولة'
                : opponentHearts > 0
                  ? 'صمد في الجولة ✓'
                  : 'فجّر 3 قنابل'}
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
            <span>
              {rematchPending ? 'بانتظار موافقة الخصم...' : 'لعب مرة أخرى'}
            </span>
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
