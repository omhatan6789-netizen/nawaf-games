import type { CarromPlayerState, FourPlayerMode, PlayerCount, QueenStatus } from '../game/carromPhysics';

interface PlayerBarProps {
  players: CarromPlayerState[];
  turn: number;
  playerCount: PlayerCount;
  fourMode: FourPlayerMode;
  queenStatus: QueenStatus;
  queenHolderSlot: number | null;
  remainingWhite: number;
  remainingBlack: number;
}

export function PlayerBar({
  players,
  turn,
  playerCount,
  fourMode,
  queenStatus,
  queenHolderSlot,
  remainingWhite,
  remainingBlack,
}: PlayerBarProps) {
  const isTeams = playerCount === 4 && fourMode === 'teams';
  const isSolo4 = playerCount === 4 && fourMode === 'solo';

  if (isTeams) {
    const team0 = players.filter((p) => p.teamIndex === 0);
    const team1 = players.filter((p) => p.teamIndex === 1);
    const activeTeam = players[turn]?.teamIndex ?? 0;
    const t0Queen = queenHolderSlot !== null && players[queenHolderSlot]?.teamIndex === 0;
    const t1Queen = queenHolderSlot !== null && players[queenHolderSlot]?.teamIndex === 1;

    return (
      <div className="w-full flex items-center justify-between gap-2">
        <TeamCard
          title="الفريق الأبيض"
          names={team0.map((p) => p.name).join(' و ')}
          side="white"
          remaining={remainingWhite}
          active={activeTeam === 0}
          queenCovered={t0Queen && queenStatus === 'covered'}
          queenPending={t0Queen && queenStatus === 'pending_cover'}
        />
        <span className="text-[11px] font-black text-white/60 shrink-0">VS</span>
        <TeamCard
          title="الفريق الأسود"
          names={team1.map((p) => p.name).join(' و ')}
          side="black"
          remaining={remainingBlack}
          active={activeTeam === 1}
          queenCovered={t1Queen && queenStatus === 'covered'}
          queenPending={t1Queen && queenStatus === 'pending_cover'}
        />
      </div>
    );
  }

  if (isSolo4) {
    return (
      <div className="w-full grid grid-cols-4 gap-1.5">
        {players.map((p, idx) => {
          const active = idx === turn;
          const isQ = queenHolderSlot === idx;
          return (
            <div
              key={p.id}
              className={`rounded-xl border px-2 py-1.5 min-w-0 transition-all ${
                active
                  ? 'border-[#ff7b88] bg-[#2a0c12] shadow-[0_0_16px_rgba(237,64,84,0.42)]'
                  : 'border-white/15 bg-[#12070a]/85'
              }`}
            >
              <div className="flex items-center justify-between gap-1">
                <span className="text-xs font-black text-white truncate">{p.name}</span>
                {isQ && queenStatus === 'covered' && (
                  <span className="text-[11px] shrink-0" title="الملكة">
                    👑
                  </span>
                )}
              </div>
              <div className="text-[11px] font-bold text-amber-200/90 tabular-nums mt-0.5">
                {p.score} نقطة
              </div>
            </div>
          );
        })}
      </div>
    );
  }

  // Standard 2-Player HUD (White vs Black)
  const p0 = players[0];
  const p1 = players[1];
  if (!p0 || !p1) return null;

  return (
    <div className="w-full flex items-center justify-between gap-2">
      <TeamCard
        title={p0.name}
        names="الأقراص البيضاء"
        side="white"
        remaining={remainingWhite}
        active={turn === 0}
        queenCovered={queenHolderSlot === 0 && queenStatus === 'covered'}
        queenPending={queenHolderSlot === 0 && queenStatus === 'pending_cover'}
      />
      <div className="flex flex-col items-center shrink-0 px-1">
        <span className="text-xs font-black text-white/65">VS</span>
        <span
          className={`w-3.5 h-3.5 rounded-full mt-0.5 border border-rose-200/70 ${
            queenStatus === 'on_board'
              ? 'bg-gradient-to-br from-[#ff4d5e] to-[#8f0014]'
              : 'bg-white/15 opacity-40'
          }`}
          title={queenStatus === 'on_board' ? 'الملكة على الطاولة' : 'تم أخذ الملكة'}
        />
      </div>
      <TeamCard
        title={p1.name}
        names="الأقراص السوداء"
        side="black"
        remaining={remainingBlack}
        active={turn === 1}
        queenCovered={queenHolderSlot === 1 && queenStatus === 'covered'}
        queenPending={queenHolderSlot === 1 && queenStatus === 'pending_cover'}
      />
    </div>
  );
}

function TeamCard({
  title,
  names,
  side,
  remaining,
  active,
  queenCovered,
  queenPending,
}: {
  title: string;
  names: string;
  side: 'white' | 'black';
  remaining: number;
  active: boolean;
  queenCovered: boolean;
  queenPending: boolean;
}) {
  const pocketed = 9 - remaining;
  return (
    <div
      className={`flex-1 min-w-0 flex items-center justify-between gap-2 rounded-2xl border px-3 py-2 transition-all ${
        active
          ? side === 'white'
            ? 'border-amber-200/90 bg-gradient-to-br from-[#2d1216] to-[#17090c] shadow-[0_0_20px_rgba(251,191,36,0.28)]'
            : 'border-[#ff7b88] bg-gradient-to-br from-[#2d1216] to-[#17090c] shadow-[0_0_20px_rgba(237,64,84,0.34)]'
          : 'border-white/15 bg-[#100609]/85 opacity-80'
      }`}
    >
      <div className="flex items-center gap-2.5 min-w-0">
        {/* Piece color disc */}
        <span
          className={`w-6 h-6 rounded-full shrink-0 border shadow-md ${
            side === 'white'
              ? 'bg-gradient-to-br from-white via-[#efe6d8] to-[#b5a792] border-[#8b7a62]'
              : 'bg-gradient-to-br from-[#52525b] via-[#1c1c20] to-black border-white/25'
          }`}
        />
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <strong className="text-xs sm:text-sm font-black text-white truncate">
              {title}
            </strong>
            {queenCovered && (
              <span className="text-xs shrink-0" title="تم تغطية الملكة">
                👑
              </span>
            )}
            {queenPending && (
              <span className="text-[10px] font-black text-rose-300 whitespace-nowrap">
                غطِّ الملكة
              </span>
            )}
          </div>
          <div className="text-[11px] font-bold text-white/60 truncate">{names}</div>
        </div>
      </div>

      <div className="text-left shrink-0 tabular-nums">
        <div className="text-sm font-black text-amber-200 leading-none">
          {pocketed}/9
        </div>
        <div className="text-[10px] font-bold text-white/50 mt-0.5">
          متبقي {remaining}
        </div>
      </div>
    </div>
  );
}
