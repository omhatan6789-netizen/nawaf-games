interface CharacterPreviewSvgProps {
  mainColor: string;
  darkColor: string;
  facing?: 'right' | 'left';
  className?: string;
  label?: string;
}

export function CharacterPreviewSvg({
  mainColor,
  darkColor,
  facing = 'right',
  className = 'w-11 h-12',
  label,
}: CharacterPreviewSvgProps) {
  const visorX = facing === 'right' ? 16 : 13;
  const eye1X = facing === 'right' ? 22 : 18;
  const eye2X = facing === 'right' ? 30 : 26;
  const pupil1X = facing === 'right' ? 23 : 17;
  const pupil2X = facing === 'right' ? 31 : 25;

  return (
    <svg viewBox="0 0 48 56" className={className} aria-label={label}>
      <polygon
        points="14,16 12,6 19,11 24,4 29,11 36,6 34,16"
        fill="#facc15"
        stroke="#141621"
        strokeWidth="2.5"
        strokeLinejoin="round"
      />
      <rect
        x="10"
        y="16"
        width="28"
        height="28"
        rx="7"
        fill={mainColor}
        stroke="#141621"
        strokeWidth="2.5"
      />
      <rect
        x="10"
        y="19"
        width="28"
        height="6"
        fill={darkColor}
        stroke="#141621"
        strokeWidth="2"
      />
      <rect x={visorX} y="26" width="19" height="11" rx="4" fill="#0f172a" />
      <ellipse cx={eye1X} cy="31.5" rx="3" ry="4" fill="#ffffff" />
      <ellipse cx={eye2X} cy="31.5" rx="3" ry="4" fill="#ffffff" />
      <circle cx={pupil1X} cy="31.5" r="1.5" fill="#090d16" />
      <circle cx={pupil2X} cy="31.5" r="1.5" fill="#090d16" />
      <rect
        x="13"
        y="43"
        width="8"
        height="7"
        rx="3"
        fill={darkColor}
        stroke="#141621"
        strokeWidth="2"
      />
      <rect
        x="27"
        y="43"
        width="8"
        height="7"
        rx="3"
        fill={darkColor}
        stroke="#141621"
        strokeWidth="2"
      />
    </svg>
  );
}
