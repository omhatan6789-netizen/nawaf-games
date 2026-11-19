export function CarromPreviewSvg() {
  return (
    <svg
      viewBox="0 0 220 110"
      className="w-48 h-24 mx-auto drop-shadow-[0_10px_18px_rgba(0,0,0,0.45)]"
      role="img"
      aria-label="أقراص الكيرم والملكة الحمراء وقرص التسديد"
    >
      <defs>
        <radialGradient id="qRed" cx="35%" cy="30%" r="70%">
          <stop offset="0%" stopColor="#ff5768" />
          <stop offset="35%" stopColor="#e10b21" />
          <stop offset="100%" stopColor="#7a000d" />
        </radialGradient>
        <radialGradient id="cWhite" cx="35%" cy="30%" r="70%">
          <stop offset="0%" stopColor="#ffffff" />
          <stop offset="65%" stopColor="#eae0d0" />
          <stop offset="100%" stopColor="#b5a792" />
        </radialGradient>
        <radialGradient id="cBlack" cx="35%" cy="30%" r="70%">
          <stop offset="0%" stopColor="#52525b" />
          <stop offset="50%" stopColor="#1b1b1f" />
          <stop offset="100%" stopColor="#050507" />
        </radialGradient>
        <radialGradient id="sJewel" cx="35%" cy="30%" r="70%">
          <stop offset="0%" stopColor="#a7f3d0" />
          <stop offset="45%" stopColor="#10b981" />
          <stop offset="100%" stopColor="#064e3b" />
        </radialGradient>
      </defs>

      {/* Mini warm wood board plate */}
      <rect
        x="10"
        y="8"
        width="200"
        height="94"
        rx="18"
        fill="#d7ae7d"
        stroke="#4a2416"
        strokeWidth="6"
      />
      <rect
        x="22"
        y="18"
        width="176"
        height="74"
        rx="10"
        fill="none"
        stroke="#7e5033"
        strokeWidth="1.5"
        opacity="0.65"
      />

      {/* Surrounding white & black discs */}
      <circle cx="80" cy="40" r="13" fill="url(#cWhite)" stroke="#9e8e78" strokeWidth="1.2" />
      <circle cx="80" cy="40" r="8" fill="none" stroke="#9e8e78" strokeWidth="0.9" />

      <circle cx="140" cy="40" r="13" fill="url(#cBlack)" stroke="#ffffff30" strokeWidth="1.2" />
      <circle cx="140" cy="40" r="8" fill="none" stroke="#ffffff24" strokeWidth="0.9" />

      <circle cx="80" cy="70" r="13" fill="url(#cBlack)" stroke="#ffffff30" strokeWidth="1.2" />
      <circle cx="80" cy="70" r="8" fill="none" stroke="#ffffff24" strokeWidth="0.9" />

      <circle cx="140" cy="70" r="13" fill="url(#cWhite)" stroke="#9e8e78" strokeWidth="1.2" />
      <circle cx="140" cy="70" r="8" fill="none" stroke="#9e8e78" strokeWidth="0.9" />

      {/* Vivid Red Queen in the center */}
      <circle cx="110" cy="52" r="15" fill="url(#qRed)" stroke="#ff8a95" strokeWidth="1.4" />
      <circle cx="110" cy="52" r="9.5" fill="none" stroke="#ffd1d6" strokeWidth="0.9" opacity="0.7" />
      <text
        x="110"
        y="53.5"
        textAnchor="middle"
        dominantBaseline="middle"
        fill="#fff1f2"
        fontSize="12"
        fontWeight="bold"
      >
        ♛
      </text>

      {/* Jewel Emerald-Gold Striker at bottom */}
      <circle cx="110" cy="84" r="15" fill="url(#sJewel)" stroke="#fde68a" strokeWidth="2" />
      <circle cx="110" cy="84" r="9" fill="none" stroke="#f59e0b" strokeWidth="1.3" />
      <circle cx="110" cy="84" r="3.5" fill="#fef3c7" />
    </svg>
  );
}
