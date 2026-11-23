import React from 'react';
import {
  Heart,
  Volume2,
  VolumeX,
  Bot,
  User,
} from 'lucide-react';
import {
  DIFFICULTY_META,
  MAX_HEARTS,
  type Difficulty,
  type GameMode,
} from '../types/game';

interface TopHudProps {
  mode: GameMode;
  playerName: string;
  opponentName: string;
  playerHearts: number;
  opponentHearts: number;
  difficulty: Difficulty;
  isMuted: boolean;
  onToggleMute: () => void;
}

const HeartsRow: React.FC<{ count: number }> = ({ count }) => (
  <div
    className="flex items-center gap-0.5 sm:gap-1"
    aria-label={`القلوب المتبقية ${count} من ${MAX_HEARTS}`}
  >
    {Array.from({ length: MAX_HEARTS }).map((_, idx) => {
      const alive = idx < count;
      return (
        <Heart
          key={idx}
          className={`w-4 h-4 sm:w-5 sm:h-5 transition-all duration-300 ${
            alive
              ? 'fill-rose-500 text-rose-600 drop-shadow-[0_1px_2px_rgba(225,29,72,0.4)] scale-100'
              : 'fill-slate-300 text-slate-400 scale-90 opacity-65'
          }`}
        />
      );
    })}
  </div>
);

export const TopHud: React.FC<TopHudProps> = ({
  mode,
  playerName,
  opponentName,
  playerHearts,
  opponentHearts,
  difficulty,
  isMuted,
  onToggleMute,
}) => {
  const displayName = playerName.trim() || 'أنت';
  const displayOpponent =
    mode === 'bot' ? 'البوت' : opponentName.trim() || 'الخصم';

  return (
    <header className="w-full max-w-2xl mx-auto px-3 pt-2.5 pb-1 flex items-center justify-between gap-2 shrink-0 z-20">
      {/* Right side in RTL: Player card */}
      <div className="flex items-center gap-2 bg-white/95 backdrop-blur-sm border-2 border-blue-400 rounded-2xl px-2.5 py-1.5 shadow-md min-w-[112px] sm:min-w-[140px]">
        <div className="w-8 h-8 sm:w-9 sm:h-9 rounded-xl bg-blue-500 text-white flex items-center justify-center shrink-0 shadow-inner">
          <User className="w-5 h-5" />
        </div>
        <div className="flex flex-col leading-tight min-w-0">
          <span className="text-xs sm:text-sm font-extrabold text-slate-900 truncate max-w-[68px] sm:max-w-[90px]">
            {displayName}
          </span>
          <HeartsRow count={playerHearts} />
        </div>
      </div>

      {/* Center: Title + Mute toggle */}
      <div className="flex flex-col items-center gap-1 shrink-0">
        <span className="text-sm sm:text-base font-black text-amber-300 drop-shadow-[0_2px_2px_rgba(0,0,0,0.45)] tracking-wide whitespace-nowrap">
          البطاطس
        </span>
        <button
          type="button"
          onClick={onToggleMute}
          aria-label={isMuted ? 'تشغيل الصوت' : 'كتم الصوت'}
          title={isMuted ? 'تشغيل الصوت' : 'كتم الصوت'}
          className="w-9 h-9 rounded-full bg-white/95 hover:bg-white active:scale-95 text-slate-800 border-2 border-white/80 shadow-md flex items-center justify-center transition-transform cursor-pointer focus-visible:outline-2 focus-visible:outline-amber-300"
        >
          {isMuted ? (
            <VolumeX className="w-4 h-4 text-rose-600" />
          ) : (
            <Volume2 className="w-4 h-4 text-slate-800" />
          )}
        </button>
      </div>

      {/* Left side in RTL: Opponent card (Bot only in bot mode, real player in online mode) */}
      <div className="flex items-center justify-end gap-2 bg-white/95 backdrop-blur-sm border-2 border-rose-400 rounded-2xl px-2.5 py-1.5 shadow-md min-w-[112px] sm:min-w-[140px]">
        <div className="flex flex-col items-end leading-tight min-w-0">
          <div className="flex items-center gap-1">
            {mode === 'bot' && (
              <span className="text-[10px] font-bold text-rose-600">
                {DIFFICULTY_META[difficulty].label}
              </span>
            )}
            <span className="text-xs sm:text-sm font-extrabold text-slate-900 truncate max-w-[72px] sm:max-w-[92px]">
              {displayOpponent}
            </span>
          </div>
          <HeartsRow count={opponentHearts} />
        </div>
        <div className="w-8 h-8 sm:w-9 sm:h-9 rounded-xl bg-rose-500 text-white flex items-center justify-center shrink-0 shadow-inner">
          {mode === 'bot' ? (
            <Bot className="w-5 h-5" />
          ) : (
            <User className="w-5 h-5" />
          )}
        </div>
      </div>
    </header>
  );
};
