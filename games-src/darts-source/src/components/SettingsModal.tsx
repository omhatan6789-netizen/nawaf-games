import React, { useState } from 'react';
import { Download, X } from 'lucide-react';
import type {
  AimSpeed,
  DartsSettings,
  Difficulty,
  StartingScore,
} from '../game/dartsTypes';

interface SettingsModalProps {
  open: boolean;
  settings: DartsSettings;
  onChange: (next: DartsSettings) => void;
  onClose: () => void;
  hideGameplayOptions?: boolean;
}

const SCORE_OPTIONS: StartingScore[] = [200, 300, 350, 501];

const DIFFICULTIES: { value: Difficulty; label: string; hint: string }[] = [
  { value: 'easy', label: 'سهل', hint: 'دقة تصويب خفيفة وممتعة' },
  { value: 'medium', label: 'متوسط', hint: 'تحدي متوازن في التربل والدبل' },
  { value: 'hard', label: 'صعب', hint: 'يصيب التربل ويقفل الصفر بدقة' },
];

const AIM_SPEEDS: { value: AimSpeed; label: string }[] = [
  { value: 'normal', label: 'عادي' },
  { value: 'fast', label: 'سريع' },
];

export const SettingsModal: React.FC<SettingsModalProps> = ({
  open,
  settings,
  onChange,
  onClose,
  hideGameplayOptions = false,
}) => {
  const [downloading, setDownloading] = useState(false);

  if (!open) return null;

  const handleDownloadZip = async () => {
    if (downloading) return;
    setDownloading(true);
    try {
      const res = await fetch('/api/download-zip');
      if (!res.ok) throw new Error('Download failed');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'nawaf-darts-project.zip';
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/75 p-4 backdrop-blur-xs"
      onClick={onClose}
    >
      <div
        className="nawaf-panel w-full max-w-md p-5 text-right"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between border-b border-white/15 pb-3">
          <h2 className="m-0 text-xl font-black text-white">إعدادات السهام</h2>
          <button
            type="button"
            onClick={onClose}
            className="flex h-9 w-9 cursor-pointer items-center justify-center rounded-full border border-white/20 bg-white/10 text-white hover:bg-white/20"
            aria-label="إغلاق"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-4">
          {!hideGameplayOptions && (
            <>
              {/* Starting Score */}
              <div>
                <div className="mb-2 text-sm font-extrabold text-white/85">
                  نقاط البداية (الوصول إلى 0 للفوز)
                </div>
                <div className="grid grid-cols-4 gap-2">
                  {SCORE_OPTIONS.map((score) => (
                    <button
                      key={score}
                      type="button"
                      onClick={() => onChange({ ...settings, startingScore: score })}
                      className={`nawaf-choice py-2.5 text-center text-sm tabular-nums ${
                        settings.startingScore === score ? 'active' : ''
                      }`}
                    >
                      {score}
                    </button>
                  ))}
                </div>
              </div>

              {/* Bot Difficulty */}
              <div>
                <div className="mb-2 text-sm font-extrabold text-white/85">
                  مستوى البوت
                </div>
                <div className="grid grid-cols-3 gap-2">
                  {DIFFICULTIES.map((item) => (
                    <button
                      key={item.value}
                      type="button"
                      onClick={() => onChange({ ...settings, difficulty: item.value })}
                      className={`nawaf-choice px-2 py-2.5 text-center text-sm ${
                        settings.difficulty === item.value ? 'active' : ''
                      }`}
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
                <p className="mt-1.5 text-xs text-white/60">
                  {DIFFICULTIES.find((d) => d.value === settings.difficulty)?.hint}
                </p>
              </div>
            </>
          )}

          {/* Aim Bar Speed */}
          <div>
            <div className="mb-2 text-sm font-extrabold text-white/85">
              سرعة مؤشر التصويب
            </div>
            <div className="grid grid-cols-2 gap-2">
              {AIM_SPEEDS.map((sp) => (
                <button
                  key={sp.value}
                  type="button"
                  onClick={() => onChange({ ...settings, aimSpeed: sp.value })}
                  className={`nawaf-choice py-2.5 text-center text-sm ${
                    settings.aimSpeed === sp.value ? 'active' : ''
                  }`}
                >
                  {sp.label}
                </button>
              ))}
            </div>
          </div>

          {/* Haptics */}
          <div className="flex items-center justify-between rounded-2xl border border-white/15 bg-black/25 px-3.5 py-3">
            <span className="text-sm font-extrabold text-white">
              اهتزاز التيليجرام (Haptics)
            </span>
            <button
              type="button"
              onClick={() => onChange({ ...settings, haptics: !settings.haptics })}
              className={`nawaf-choice px-4 py-1.5 text-xs ${
                settings.haptics ? 'active' : ''
              }`}
            >
              {settings.haptics ? 'مفعّل' : 'مغلق'}
            </button>
          </div>
          {/* Download Full Project Zip inside Settings */}
          {!hideGameplayOptions && (
            <button
              type="button"
              onClick={handleDownloadZip}
              disabled={downloading}
              className="nawaf-secondary flex items-center justify-center gap-2 disabled:opacity-60"
            >
              <Download className="h-4 w-4 text-amber-300" />
              <span>
                {downloading ? 'جاري تجهيز الملف...' : 'تحميل ملفات المشروع (Zip)'}
              </span>
            </button>
          )}
        </div>

        <button type="button" onClick={onClose} className="nawaf-primary mt-4">
          حفظ وإغلاق
        </button>
      </div>
    </div>
  );
};
