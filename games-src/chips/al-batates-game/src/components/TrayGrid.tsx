import React from 'react';
import { TrayCell } from '../types/game';
import {
  PotatoChipSvg,
  SafeCrumbsSvg,
  CharredRemainsSvg,
  BombSvg,
  HiddenBombBadge,
  SmokeCloudSvg,
} from './PotatoChipSvg';

interface TrayGridProps {
  cells: TrayCell[];
  variant: 'blue' | 'red';
  size?: 'prep' | 'compact' | 'play';
  showHiddenBombMarkers?: boolean;
  interactive?: boolean;
  shaking?: boolean;
  label?: string;
  onCellClick?: (index: number) => void;
}

export const TrayGrid: React.FC<TrayGridProps> = ({
  cells,
  variant,
  size = 'play',
  showHiddenBombMarkers = false,
  interactive = false,
  shaking = false,
  label,
  onCellClick,
}) => {
  const sizeClass =
    size === 'prep'
      ? 'w-[242px] sm:w-[270px] p-2.5 sm:p-3 gap-2 sm:gap-2.5 rounded-[22px]'
      : size === 'compact'
        ? 'w-[182px] sm:w-[208px] p-2 gap-1.5 sm:gap-2 rounded-[18px]'
        : 'w-[212px] sm:w-[238px] p-2.5 gap-2 rounded-[20px]';

  const frameClass =
    variant === 'blue'
      ? 'tray-blue-frame ring-2 ring-white/50'
      : 'tray-red-frame ring-2 ring-white/55';

  const wellClass = variant === 'blue' ? 'tray-blue-well' : 'tray-red-well';

  return (
    <div className="flex flex-col items-center gap-1">
      {label && (
        <span className="text-[11px] sm:text-xs font-extrabold text-white/95 drop-shadow-[0_1px_2px_rgba(0,0,0,0.5)] tracking-wide">
          {label}
        </span>
      )}
      <div
        className={`grid grid-cols-3 aspect-square select-none transition-transform ${sizeClass} ${frameClass} ${
          shaking ? 'animate-tray-shake' : ''
        }`}
      >
        {cells.map((cell) => {
          const isChipClickable = interactive && cell.status === 'CHIP';

          return (
            <button
              key={cell.index}
              type="button"
              disabled={!isChipClickable}
              onClick={() => isChipClickable && onCellClick?.(cell.index)}
              aria-label={`خانة ${cell.index + 1}`}
              className={`relative aspect-square rounded-[13px] sm:rounded-[15px] p-1.5 flex items-center justify-center transition-transform duration-150 focus-visible:outline-2 focus-visible:outline-amber-300 ${wellClass} ${
                isChipClickable
                  ? 'cursor-pointer hover:scale-[1.04] active:scale-95'
                  : 'cursor-default'
              }`}
            >
              {cell.status === 'CHIP' && (
                <div className="w-[88%] h-[88%] transition-transform duration-150">
                  <PotatoChipSvg variant={cell.index} />
                </div>
              )}

              {cell.status === 'SAFE_EATEN' && (
                <div className="w-[82%] h-[82%] animate-bomb-pop">
                  <SafeCrumbsSvg />
                </div>
              )}

              {cell.status === 'EXPLODING_BOMB' && (
                <div className="w-[86%] h-[86%] animate-bomb-pop z-10">
                  <BombSvg lit />
                </div>
              )}

              {cell.status === 'EXPLODING_SMOKE' && (
                <div className="relative w-full h-full flex items-center justify-center">
                  <div className="w-[82%] h-[82%] opacity-70">
                    <CharredRemainsSvg />
                  </div>
                  <div className="absolute -inset-2.5 animate-smoke-puff pointer-events-none z-20">
                    <SmokeCloudSvg />
                  </div>
                </div>
              )}

              {cell.status === 'BOMB_CHARRED' && (
                <div className="w-[86%] h-[86%]">
                  <CharredRemainsSvg />
                </div>
              )}

              {cell.status === 'BOMB_REVEALED' && (
                <div className="w-[84%] h-[84%] animate-bomb-pop z-10">
                  <BombSvg lit={false} />
                </div>
              )}

              {showHiddenBombMarkers &&
                cell.hasBomb &&
                cell.status === 'CHIP' && (
                  <div className="absolute -top-1 -right-1 z-20 animate-bomb-pop">
                    <HiddenBombBadge />
                  </div>
                )}
            </button>
          );
        })}
      </div>
    </div>
  );
};
