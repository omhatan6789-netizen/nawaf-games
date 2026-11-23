import React from 'react';

interface ChipProps {
  variant: number;
  className?: string;
}

const CHIP_TRANSFORMS = [
  { rotate: -14, scaleX: 1, scaleY: 0.96 },
  { rotate: 18, scaleX: 0.96, scaleY: 1 },
  { rotate: -6, scaleX: 1.02, scaleY: 0.95 },
  { rotate: 24, scaleX: 0.95, scaleY: 1.02 },
  { rotate: -22, scaleX: 1, scaleY: 0.97 },
  { rotate: 9, scaleX: 0.98, scaleY: 1.01 },
  { rotate: -11, scaleX: 1.01, scaleY: 0.96 },
  { rotate: 15, scaleX: 0.97, scaleY: 0.99 },
  { rotate: -19, scaleX: 1, scaleY: 1 },
];

export const PotatoChipSvg: React.FC<ChipProps> = ({ variant, className = '' }) => {
  const t = CHIP_TRANSFORMS[variant % CHIP_TRANSFORMS.length];
  const gradId = `chipGrad-${variant}`;
  const ridgeId = `chipRidge-${variant}`;

  return (
    <svg
      viewBox="0 0 100 100"
      className={`w-full h-full drop-shadow-[0_4px_5px_rgba(40,12,0,0.42)] ${className}`}
      style={{
        transform: `rotate(${t.rotate}deg) scale(${t.scaleX}, ${t.scaleY})`,
      }}
      aria-hidden="true"
    >
      <defs>
        <radialGradient id={gradId} cx="42%" cy="38%" r="60%">
          <stop offset="0%" stopColor="#FFE97D" />
          <stop offset="55%" stopColor="#F5BD2F" />
          <stop offset="88%" stopColor="#D68E12" />
          <stop offset="100%" stopColor="#B86E08" />
        </radialGradient>
        <linearGradient id={ridgeId} x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="#FFF5B2" stopOpacity="0.72" />
          <stop offset="50%" stopColor="#C97C0A" stopOpacity="0.38" />
          <stop offset="100%" stopColor="#FFE97D" stopOpacity="0.65" />
        </linearGradient>
      </defs>

      <path
        d="M24,25 C37,14 63,13 78,24 C89,33 90,54 83,68 C75,83 51,88 31,82 C15,77 11,58 14,43 C16,34 19,29 24,25 Z"
        fill={`url(#${gradId})`}
        stroke="#A45D06"
        strokeWidth="2.2"
      />

      <path
        d="M21,34 Q50,27 80,35 M17,45 Q50,38 84,46 M16,56 Q50,49 84,57 M20,67 Q50,60 79,68 M28,76 Q50,71 70,76"
        fill="none"
        stroke={`url(#${ridgeId})`}
        strokeWidth="4.2"
        strokeLinecap="round"
      />

      <path
        d="M29,26 C43,19 59,19 71,26"
        fill="none"
        stroke="#FFF7CC"
        strokeWidth="2.4"
        strokeLinecap="round"
        opacity="0.7"
      />

      <circle cx="34" cy="40" r="1.4" fill="#8C4B04" opacity="0.45" />
      <circle cx="64" cy="59" r="1.7" fill="#8C4B04" opacity="0.4" />
      <circle cx="47" cy="72" r="1.2" fill="#8C4B04" opacity="0.38" />
    </svg>
  );
};

export const SafeCrumbsSvg: React.FC = () => (
  <svg viewBox="0 0 100 100" className="w-full h-full" aria-hidden="true">
    <path
      d="M36,54 L43,49 L47,56 L39,60 Z"
      fill="#F5C33B"
      stroke="#BA780B"
      strokeWidth="1"
    />
    <path
      d="M57,46 L65,48 L62,55 L54,52 Z"
      fill="#FAD45B"
      stroke="#BA780B"
      strokeWidth="1"
    />
    <path
      d="M46,65 L54,63 L56,69 L48,70 Z"
      fill="#EBB227"
      stroke="#BA780B"
      strokeWidth="1"
    />
    <circle cx="33" cy="46" r="2.1" fill="#F8CE4E" />
    <circle cx="67" cy="61" r="2.4" fill="#F3BA2C" />
    <circle cx="43" cy="42" r="1.5" fill="#FDE073" />
    <circle cx="59" cy="67" r="1.6" fill="#E6A91D" />
    <circle cx="37" cy="67" r="1.4" fill="#F8CE4E" />
  </svg>
);

export const CharredRemainsSvg: React.FC = () => (
  <svg viewBox="0 0 100 100" className="w-full h-full" aria-hidden="true">
    <path
      d="M27,36 C33,31 44,30 51,34 C53,36 52,40 46,43 C40,45 31,44 27,40 Z"
      fill="#262120"
      stroke="#141110"
      strokeWidth="1"
    />
    <path
      d="M31,37 Q40,35 48,37 M32,41 Q40,39 46,41"
      fill="none"
      stroke="#3D3533"
      strokeWidth="1.5"
      strokeLinecap="round"
    />

    <path
      d="M59,43 L68,42 L67,49 L60,48 Z"
      fill="#2A2423"
      stroke="#141110"
      strokeWidth="0.9"
    />

    <path
      d="M42,50 C50,49 58,52 63,58 C65,64 61,71 53,73 C46,74 43,70 43,62 C43,57 41,53 42,50 Z"
      fill="#241F1E"
      stroke="#120F0E"
      strokeWidth="1"
    />
    <path
      d="M45,56 Q53,55 59,58 M45,62 Q53,61 60,64 M46,68 Q52,67 57,69"
      fill="none"
      stroke="#3B3331"
      strokeWidth="1.6"
      strokeLinecap="round"
    />

    <circle cx="24" cy="31" r="1.3" fill="#1E1918" />
    <circle cx="35" cy="27" r="1.6" fill="#1E1918" />
    <circle cx="53" cy="28" r="1.3" fill="#1E1918" />
    <circle cx="66" cy="34" r="1.2" fill="#1E1918" />
    <circle cx="72" cy="48" r="1.6" fill="#1E1918" />
    <circle cx="67" cy="56" r="1.2" fill="#1E1918" />
    <circle cx="36" cy="54" r="1.8" fill="#1E1918" />
    <circle cx="29" cy="49" r="1.2" fill="#1E1918" />
    <circle cx="35" cy="66" r="1.3" fill="#1E1918" />
    <circle cx="69" cy="65" r="1.4" fill="#1E1918" />
    <circle cx="55" cy="42" r="1.2" fill="#1E1918" />
  </svg>
);

export const BombSvg: React.FC<{ lit?: boolean; className?: string }> = ({
  lit = true,
  className = '',
}) => (
  <svg viewBox="0 0 100 100" className={`w-full h-full ${className}`} aria-hidden="true">
    <defs>
      <radialGradient id="bombBodyGrad" cx="35%" cy="35%" r="60%">
        <stop offset="0%" stopColor="#525866" />
        <stop offset="45%" stopColor="#1E222A" />
        <stop offset="100%" stopColor="#090B0E" />
      </radialGradient>
    </defs>

    <path
      d="M58,28 C63,18 72,17 77,22"
      fill="none"
      stroke="#B48A5A"
      strokeWidth="4.2"
      strokeLinecap="round"
    />

    <rect
      x="46"
      y="24"
      width="16"
      height="9"
      rx="3"
      transform="rotate(14 54 28)"
      fill="#3E4451"
      stroke="#14171F"
      strokeWidth="1.5"
    />

    <circle
      cx="47"
      cy="58"
      r="29"
      fill="url(#bombBodyGrad)"
      stroke="#090B0E"
      strokeWidth="2"
    />

    <ellipse
      cx="36"
      cy="46"
      rx="8"
      ry="5"
      transform="rotate(-32 36 46)"
      fill="#FFFFFF"
      opacity="0.32"
    />

    {lit && (
      <g>
        <circle cx="79" cy="21" r="7" fill="#FF6B1A" opacity="0.45" />
        <path
          d="M79,11 L81,18 L88,16 L82,21 L88,26 L80,24 L78,31 L76,24 L69,25 L75,20 L71,14 L77,18 Z"
          fill="#FFD43B"
          stroke="#FF5500"
          strokeWidth="1"
        />
      </g>
    )}
  </svg>
);

export const HiddenBombBadge: React.FC = () => (
  <div
    className="w-6 h-6 sm:w-7 sm:h-7 rounded-full bg-neutral-950 border-2 border-white shadow-md flex items-center justify-center pointer-events-none"
    aria-label="قنبلة مخفية"
  >
    <svg viewBox="0 0 24 24" className="w-3.5 h-3.5 text-white" fill="currentColor" aria-hidden="true">
      <circle cx="11" cy="14" r="6.5" />
      <rect x="11.5" y="5.8" width="3.2" height="2.4" rx="0.8" transform="rotate(20 13 7)" />
      <path
        d="M14,6 C15.5,4 17.5,4 18.5,5.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
      />
      <circle cx="19" cy="5.5" r="1.4" fill="#FACC15" />
    </svg>
  </div>
);

export const SmokeCloudSvg: React.FC = () => (
  <svg viewBox="0 0 120 120" className="w-full h-full drop-shadow-lg" aria-hidden="true">
    <circle cx="42" cy="62" r="24" fill="#9CA3AF" opacity="0.92" />
    <circle cx="76" cy="58" r="23" fill="#B0B7C3" opacity="0.9" />
    <circle cx="58" cy="40" r="25" fill="#D1D5DB" opacity="0.95" />
    <circle cx="58" cy="74" r="24" fill="#6B7280" opacity="0.92" />
    <circle cx="60" cy="58" r="22" fill="#E5E7EB" opacity="0.9" />
    <circle cx="38" cy="44" r="12" fill="#F3F4F6" opacity="0.7" />
  </svg>
);
