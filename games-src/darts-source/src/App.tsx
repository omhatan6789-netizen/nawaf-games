import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Bot,
  Copy,
  Download,
  Globe,
  HelpCircle,
  Settings,
  Share2,
  Target,
  Users,
  ArrowRight,
} from 'lucide-react';
import { EndMatchOverlay } from './components/EndMatchOverlay';
import { SettingsModal } from './components/SettingsModal';
import { DartsEngine, type OnlineServerPayload } from './game/dartsEngine';
import { dartsSound } from './game/dartsSound';
import type {
  DartsSettings,
  Difficulty,
  GameMode,
  HudSnapshot,
  PlayerSide,
  StartingScore,
} from './game/dartsTypes';

type Screen = 'home' | 'setup' | 'online_lobby' | 'playing';

const SCORE_CHOICES: StartingScore[] = [200, 300, 350, 501];

const DIFFICULTY_OPTIONS: { value: Difficulty; label: string }[] = [
  { value: 'easy', label: 'سهل' },
  { value: 'medium', label: 'متوسط' },
  { value: 'hard', label: 'صعب' },
];

const DEFAULT_SETTINGS: DartsSettings = {
  startingScore: 300,
  difficulty: 'medium',
  aimSpeed: 'normal',
  haptics: true,
};

function loadSavedSettings(): DartsSettings {
  try {
    const raw = localStorage.getItem('nawaf_darts_settings_v1');
    if (!raw) return DEFAULT_SETTINGS;
    const parsed = JSON.parse(raw) as Partial<DartsSettings>;
    const score = SCORE_CHOICES.includes(parsed.startingScore as StartingScore)
      ? (parsed.startingScore as StartingScore)
      : 300;
    return {
      startingScore: score,
      difficulty:
        parsed.difficulty === 'easy' ||
        parsed.difficulty === 'medium' ||
        parsed.difficulty === 'hard'
          ? parsed.difficulty
          : 'medium',
      aimSpeed: parsed.aimSpeed === 'fast' ? 'fast' : 'normal',
      haptics: parsed.haptics !== false,
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

function getTelegramPlayerName(): string {
  try {
    const tgUser = (
      window as unknown as {
        Telegram?: {
          WebApp?: {
            initDataUnsafe?: {
              user?: { first_name?: string; username?: string };
            };
          };
        };
      }
    ).Telegram?.WebApp?.initDataUnsafe?.user;
    if (tgUser?.first_name) return tgUser.first_name;
    if (tgUser?.username) return tgUser.username;
  } catch {
    // Ignore outside Telegram
  }
  return 'نواف';
}

export default function App() {
  const [screen, setScreen] = useState<Screen>('home');
  const [mode, setMode] = useState<GameMode>('bot');
  const [settings, setSettings] = useState<DartsSettings>(loadSavedSettings);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const [player1Name, setPlayer1Name] = useState<string>(getTelegramPlayerName);
  const [player2Name, setPlayer2Name] = useState<string>('اللاعب ٢');
  const [toast, setToast] = useState<string | null>(null);

  // Online Lobby & Match state
  const wsRef = useRef<WebSocket | null>(null);
  const [roomCode, setRoomCode] = useState<string>('');
  const [joinInput, setJoinInput] = useState<string>('');
  const [onlineSide, setOnlineSide] = useState<PlayerSide>('red');
  const [lobbyPlayers, setLobbyPlayers] = useState<{ name: string; side: PlayerSide }[]>([]);
  const [lobbyScore, setLobbyScore] = useState<StartingScore>(300);
  const [rematchPending, setRematchPending] = useState(false);
  const [matchKey, setMatchKey] = useState(0);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const engineRef = useRef<DartsEngine | null>(null);
  const [hud, setHud] = useState<HudSnapshot | null>(null);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => {
      setToast((prev) => (prev === msg ? null : prev));
    }, 2400);
  }, []);

  // Telegram WebApp initialization & deep-link room code parsing
  useEffect(() => {
    try {
      const tg = (
        window as unknown as {
          Telegram?: {
            WebApp?: {
              ready?: () => void;
              expand?: () => void;
              setHeaderColor?: (c: string) => void;
              setBackgroundColor?: (c: string) => void;
              initDataUnsafe?: { start_param?: string };
            };
          };
        }
      ).Telegram?.WebApp;
      tg?.ready?.();
      tg?.expand?.();
      tg?.setHeaderColor?.('#35090d');
      tg?.setBackgroundColor?.('#100709');

      const params = new URLSearchParams(window.location.search);
      const roomFromUrl =
        params.get('room') || tg?.initDataUnsafe?.start_param || '';
      if (roomFromUrl && /^[A-Za-z0-9]{4,8}$/.test(roomFromUrl.trim())) {
        setJoinInput(roomFromUrl.trim().toUpperCase());
        setMode('online');
        setScreen('online_lobby');
      }
    } catch {
      // Ignore outside Telegram
    }
  }, []);

  // Persist settings
  const updateSettings = useCallback((next: DartsSettings) => {
    setSettings(next);
    engineRef.current?.updateSettings(next);
    try {
      localStorage.setItem('nawaf_darts_settings_v1', JSON.stringify(next));
    } catch {
      // Ignore storage error
    }
  }, []);

  // Close WebSocket cleanly
  const closeWs = useCallback(() => {
    if (wsRef.current) {
      wsRef.current.onclose = null;
      wsRef.current.close();
      wsRef.current = null;
    }
    setRoomCode('');
    setLobbyPlayers([]);
    setRematchPending(false);
  }, []);

  const connectWs = useCallback(
    (onOpenSend: (ws: WebSocket) => void) => {
      closeWs();
      const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const ws = new WebSocket(`${proto}//${window.location.host}/ws/darts`);
      wsRef.current = ws;

      ws.onopen = () => {
        onOpenSend(ws);
      };

      ws.onmessage = (ev) => {
        let data: OnlineServerPayload;
        try {
          data = JSON.parse(String(ev.data)) as OnlineServerPayload;
        } catch {
          return;
        }

        if (data.type === 'error') {
          showToast(String(data.message || 'حدث خطأ في الاتصال'));
          return;
        }

        if (data.type === 'joined') {
          setRoomCode(String(data.code || ''));
          setOnlineSide((data.side as PlayerSide) || 'red');
          if (typeof data.startingScore === 'number') {
            setLobbyScore(data.startingScore as StartingScore);
          }
          return;
        }

        if (data.type === 'room_update') {
          setRoomCode(String(data.code || ''));
          if (typeof data.startingScore === 'number') {
            setLobbyScore(data.startingScore as StartingScore);
          }
          if (Array.isArray(data.players)) {
            setLobbyPlayers(
              data.players as { name: string; side: PlayerSide }[]
            );
          }
          return;
        }

        if (data.type === 'match_started') {
          const score = Number(data.startingScore || 300) as StartingScore;
          setSettings((prev) => ({ ...prev, startingScore: score }));
          setRematchPending(false);
          setMode('online');
          setScreen('playing');
          setMatchKey((k) => k + 1);
          return;
        }

        if (data.type === 'rematch_waiting') {
          setRematchPending(true);
          return;
        }

        engineRef.current?.applyOnlineState(data);
      };

      ws.onclose = () => {
        if (screen === 'online_lobby') {
          setRoomCode('');
          setLobbyPlayers([]);
        }
      };
    },
    [closeWs, screen, showToast]
  );

  // Mount / Destroy Canvas DartsEngine on Playing screen
  useEffect(() => {
    if (screen !== 'playing') {
      engineRef.current?.destroy();
      engineRef.current = null;
      return;
    }

    const canvas = canvasRef.current;
    if (!canvas) return;

    const mySide: PlayerSide = mode === 'online' ? onlineSide : 'red';
    const redPlayer = lobbyPlayers.find((p) => p.side === 'red');
    const bluePlayer = lobbyPlayers.find((p) => p.side === 'blue');

    const redName =
      mode === 'online'
        ? redPlayer?.name || 'اللاعب الأحمر'
        : player1Name.trim() || 'نواف';
    const blueName =
      mode === 'bot'
        ? 'البوت'
        : mode === 'local'
          ? player2Name.trim() || 'اللاعب ٢'
          : bluePlayer?.name || 'الخصم';

    const engine = new DartsEngine({
      canvas,
      mode,
      mySide,
      redName,
      blueName,
      settings,
      onHudUpdate: setHud,
      onSendOnlineAction: (action) => {
        if (wsRef.current?.readyState === WebSocket.OPEN) {
          wsRef.current.send(JSON.stringify(action));
        }
      },
    });
    engineRef.current = engine;

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Space' || e.code === 'Enter') {
        e.preventDefault();
        engine.handleAimTap();
      }
    };
    window.addEventListener('keydown', onKeyDown);

    return () => {
      window.removeEventListener('keydown', onKeyDown);
      engine.destroy();
      engineRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [screen, matchKey]);

  const startOfflineMatch = (selectedMode: 'bot' | 'local') => {
    dartsSound.unlock();
    setMode(selectedMode);
    setRematchPending(false);
    setScreen('playing');
    setMatchKey((k) => k + 1);
  };

  const handleCreateRoom = () => {
    dartsSound.unlock();
    const myName = player1Name.trim() || 'نواف';
    connectWs((ws) => {
      ws.send(
        JSON.stringify({
          type: 'create_room',
          name: myName,
          startingScore: settings.startingScore,
        })
      );
    });
  };

  const handleJoinRoom = () => {
    dartsSound.unlock();
    const code = joinInput.trim().toUpperCase();
    if (code.length < 4) {
      showToast('أدخل كود الغرفة الصحيح');
      return;
    }
    const myName = player1Name.trim() || 'لاعب ٢';
    connectWs((ws) => {
      ws.send(JSON.stringify({ type: 'join_room', code, name: myName }));
    });
  };

  const handleExitMatch = () => {
    if (mode === 'online' && wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'withdraw' }));
      closeWs();
    }
    setHud(null);
    setScreen('home');
  };

  const handleRematch = () => {
    dartsSound.unlock();
    if (mode === 'online') {
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        setRematchPending(true);
        wsRef.current.send(JSON.stringify({ type: 'rematch' }));
      }
    } else {
      setMatchKey((k) => k + 1);
    }
  };

  const copyInviteLink = async () => {
    const url = `${window.location.origin}?room=${roomCode}`;
    try {
      await navigator.clipboard.writeText(url);
      showToast(`تم نسخ رابط الدعوة (${roomCode})`);
    } catch {
      showToast(`كود الغرفة: ${roomCode}`);
    }
  };

  const shareTelegramInvite = () => {
    const url = `${window.location.origin}?room=${roomCode}`;
    const text = `🎯 تحداني في لعبة السهام! (نقاط البداية: ${lobbyScore})\nكود الغرفة: ${roomCode}`;
    const shareUrl = `https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(text)}`;
    try {
      const tg = (
        window as unknown as {
          Telegram?: { WebApp?: { openTelegramLink?: (u: string) => void } };
        }
      ).Telegram?.WebApp;
      if (tg?.openTelegramLink) {
        tg.openTelegramLink(shareUrl);
        return;
      }
    } catch {
      // Fallback to clipboard
    }
    void copyInviteLink();
  };

  return (
    <div className="min-h-dvh w-full select-none text-white" dir="rtl">
      {toast && <div className="nawaf-toast">{toast}</div>}

      {/* HOME SCREEN */}
      {screen === 'home' && (
        <div className="mx-auto flex min-h-dvh w-full max-w-md flex-col px-4 pb-6 pt-4">
          {/* Top Bar */}
          <div className="mb-3 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-rose-500 to-red-800 shadow">
                <Target className="h-5 w-5 text-white" />
              </div>
              <div>
                <h1 className="m-0 text-xl font-black leading-tight text-white">
                  السهام
                </h1>
                <p className="m-0 text-[11px] font-bold text-white/60">
                  ألعاب بوت نواف
                </p>
              </div>
            </div>

            <button
              type="button"
              onClick={() => setSettingsOpen(true)}
              className="nawaf-pill flex items-center gap-1.5"
            >
              <Settings className="h-4 w-4" />
              <span>الإعدادات</span>
            </button>
          </div>

          {/* Crisp Cover Artwork */}
          <div className="nawaf-panel mb-4 overflow-hidden p-2">
            <img
              src="/src/assets/images/darts_cover_1795304337579.jpg"
              alt="لعبة السهام"
              className="aspect-video w-full rounded-xl object-cover"
            />
            <div className="mt-2.5 flex items-center justify-between px-1.5 pb-1">
              <span className="text-sm font-black text-white">
                صوّب على التربل والدبل لتصل إلى 0!
              </span>
              <span className="rounded-lg bg-rose-500/20 px-2 py-0.5 text-xs font-black text-rose-200 tabular-nums">
                {settings.startingScore} نقطة
              </span>
            </div>
          </div>

          {/* Quick Starting Score Selector right before play */}
          <div className="nawaf-panel mb-4 p-3.5">
            <div className="mb-2 flex items-center justify-between text-xs font-extrabold text-white/80">
              <span>اختر عدد النقاط الأساسي:</span>
              <span className="text-amber-300">الافتراضي 300</span>
            </div>
            <div className="grid grid-cols-4 gap-2">
              {SCORE_CHOICES.map((sc) => (
                <button
                  key={sc}
                  type="button"
                  onClick={() => updateSettings({ ...settings, startingScore: sc })}
                  className={`nawaf-choice py-2.5 text-center text-sm tabular-nums ${
                    settings.startingScore === sc ? 'active' : ''
                  }`}
                >
                  {sc}
                </button>
              ))}
            </div>
          </div>

          {/* Mode Selection Buttons */}
          <div className="space-y-2.5">
            <button
              type="button"
              onClick={() => {
                setMode('bot');
                setScreen('setup');
              }}
              className="nawaf-primary flex items-center justify-center gap-2.5"
            >
              <Bot className="h-5 w-5" />
              <span>لعب ضد البوت</span>
            </button>

            <button
              type="button"
              onClick={() => {
                setMode('online');
                setScreen('online_lobby');
              }}
              className="nawaf-secondary flex items-center justify-center gap-2.5"
            >
              <Globe className="h-5 w-5 text-sky-300" />
              <span>لعب أونلاين مع صديق</span>
            </button>

            <button
              type="button"
              onClick={() => {
                setMode('local');
                setScreen('setup');
              }}
              className="nawaf-secondary flex items-center justify-center gap-2.5"
            >
              <Users className="h-5 w-5 text-emerald-300" />
              <span>لاعبين (على نفس الجهاز)</span>
            </button>

            <button
              type="button"
              onClick={async () => {
                try {
                  showToast('جاري تجهيز ملف المشروع...');
                  const res = await fetch('/api/download-zip');
                  if (!res.ok) throw new Error('Download error');
                  const blob = await res.blob();
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement('a');
                  a.href = url;
                  a.download = 'nawaf-darts-project.zip';
                  document.body.appendChild(a);
                  a.click();
                  a.remove();
                  setTimeout(() => URL.revokeObjectURL(url), 4000);
                } catch {
                  showToast('تعذر تحميل الملف حالياً');
                }
              }}
              className="nawaf-pill mt-1 flex w-full items-center justify-center gap-2 py-2.5 text-white/85"
            >
              <Download className="h-4 w-4 text-amber-300" />
              <span>تحميل ملفات المشروع (Zip)</span>
            </button>
          </div>
        </div>
      )}

      {/* OFFLINE SETUP SCREEN (BOT OR LOCAL) */}
      {screen === 'setup' && (
        <div className="mx-auto flex min-h-dvh w-full max-w-md flex-col px-4 pb-6 pt-4">
          <div className="mb-4 flex items-center justify-between">
            <button
              type="button"
              onClick={() => setScreen('home')}
              className="nawaf-pill flex items-center gap-1.5"
            >
              <ArrowRight className="h-4 w-4" />
              <span>رجوع</span>
            </button>
            <h2 className="m-0 text-lg font-black">
              {mode === 'bot' ? 'تحدي البوت' : 'لعب على نفس الجهاز'}
            </h2>
            <button
              type="button"
              onClick={() => setSettingsOpen(true)}
              className="nawaf-pill"
              aria-label="الإعدادات"
            >
              <Settings className="h-4 w-4" />
            </button>
          </div>

          <div className="nawaf-panel space-y-4 p-4">
            <div>
              <label className="mb-1.5 block text-xs font-extrabold text-white/80">
                {mode === 'bot' ? 'اسمك في المباراة' : 'اسم اللاعب الأول (أحمر)'}
              </label>
              <input
                type="text"
                maxLength={22}
                value={player1Name}
                onChange={(e) => setPlayer1Name(e.target.value)}
                placeholder="اكتب اسمك..."
                className="w-full rounded-xl border border-white/25 bg-black/35 px-3.5 py-2.5 text-sm font-bold text-white outline-none focus:border-rose-400"
              />
            </div>

            {mode === 'local' && (
              <div>
                <label className="mb-1.5 block text-xs font-extrabold text-white/80">
                  اسم اللاعب الثاني (أزرق)
                </label>
                <input
                  type="text"
                  maxLength={22}
                  value={player2Name}
                  onChange={(e) => setPlayer2Name(e.target.value)}
                  placeholder="اللاعب ٢"
                  className="w-full rounded-xl border border-white/25 bg-black/35 px-3.5 py-2.5 text-sm font-bold text-white outline-none focus:border-sky-400"
                />
              </div>
            )}

            <div>
              <div className="mb-2 text-xs font-extrabold text-white/80">
                نقاط البداية (من يصل إلى 0 أولاً يفوز)
              </div>
              <div className="grid grid-cols-4 gap-2">
                {SCORE_CHOICES.map((sc) => (
                  <button
                    key={sc}
                    type="button"
                    onClick={() =>
                      updateSettings({ ...settings, startingScore: sc })
                    }
                    className={`nawaf-choice py-2.5 text-center text-sm tabular-nums ${
                      settings.startingScore === sc ? 'active' : ''
                    }`}
                  >
                    {sc}
                  </button>
                ))}
              </div>
            </div>

            {mode === 'bot' && (
              <div>
                <div className="mb-2 text-xs font-extrabold text-white/80">
                  مستوى صعوبة البوت
                </div>
                <div className="grid grid-cols-3 gap-2">
                  {DIFFICULTY_OPTIONS.map((d) => (
                    <button
                      key={d.value}
                      type="button"
                      onClick={() =>
                        updateSettings({ ...settings, difficulty: d.value })
                      }
                      className={`nawaf-choice py-2.5 text-center text-sm ${
                        settings.difficulty === d.value ? 'active' : ''
                      }`}
                    >
                      {d.label}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          <button
            type="button"
            onClick={() => startOfflineMatch(mode === 'local' ? 'local' : 'bot')}
            className="nawaf-primary mt-5"
          >
            ابدأ اللعب الآن
          </button>
        </div>
      )}

      {/* ONLINE LOBBY SCREEN */}
      {screen === 'online_lobby' && (
        <div className="mx-auto flex min-h-dvh w-full max-w-md flex-col px-4 pb-6 pt-4">
          <div className="mb-4 flex items-center justify-between">
            <button
              type="button"
              onClick={() => {
                closeWs();
                setScreen('home');
              }}
              className="nawaf-pill flex items-center gap-1.5"
            >
              <ArrowRight className="h-4 w-4" />
              <span>رجوع</span>
            </button>
            <h2 className="m-0 text-lg font-black">غرفة السهام أونلاين</h2>
            <div className="w-16" />
          </div>

          {!roomCode ? (
            <div className="space-y-4">
              <div className="nawaf-panel space-y-3 p-4">
                <label className="block text-xs font-extrabold text-white/80">
                  اسمك الظاهر للخصم
                </label>
                <input
                  type="text"
                  maxLength={22}
                  value={player1Name}
                  onChange={(e) => setPlayer1Name(e.target.value)}
                  className="w-full rounded-xl border border-white/25 bg-black/35 px-3.5 py-2.5 text-sm font-bold text-white outline-none focus:border-rose-400"
                />

                <div className="pt-1">
                  <div className="mb-2 text-xs font-extrabold text-white/80">
                    نقاط البداية للغرفة الجديدة
                  </div>
                  <div className="grid grid-cols-4 gap-2">
                    {SCORE_CHOICES.map((sc) => (
                      <button
                        key={sc}
                        type="button"
                        onClick={() =>
                          updateSettings({ ...settings, startingScore: sc })
                        }
                        className={`nawaf-choice py-2 text-center text-sm tabular-nums ${
                          settings.startingScore === sc ? 'active' : ''
                        }`}
                      >
                        {sc}
                      </button>
                    ))}
                  </div>
                </div>

                <button
                  type="button"
                  onClick={handleCreateRoom}
                  className="nawaf-primary mt-2"
                >
                  إنشاء غرفة جديدة
                </button>
              </div>

              <div className="nawaf-panel space-y-3 p-4">
                <div className="text-sm font-black text-white">
                  أو انضم بكود الغرفة
                </div>
                <div className="flex gap-2">
                  <input
                    type="text"
                    maxLength={8}
                    value={joinInput}
                    onChange={(e) => setJoinInput(e.target.value.toUpperCase())}
                    placeholder="مثال: ABC123"
                    className="flex-1 rounded-xl border border-white/25 bg-black/35 px-3.5 py-2.5 text-center text-base font-black tracking-widest text-white uppercase outline-none focus:border-sky-400"
                  />
                  <button
                    type="button"
                    onClick={handleJoinRoom}
                    className="nawaf-choice px-5 py-2.5 text-sm active"
                  >
                    دخول
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <div className="nawaf-panel space-y-4 p-4">
              <div className="rounded-2xl border border-white/15 bg-black/35 p-3.5 text-center">
                <div className="text-xs font-bold text-white/60">كود الغرفة</div>
                <div className="mt-1 text-3xl font-black tracking-widest text-amber-300 tabular-nums">
                  {roomCode}
                </div>
                <div className="mt-3 grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={shareTelegramInvite}
                    className="nawaf-choice flex items-center justify-center gap-1.5 py-2 text-xs"
                  >
                    <Share2 className="h-3.5 w-3.5 text-sky-300" />
                    <span>مشاركة بتيليجرام</span>
                  </button>
                  <button
                    type="button"
                    onClick={copyInviteLink}
                    className="nawaf-choice flex items-center justify-center gap-1.5 py-2 text-xs"
                  >
                    <Copy className="h-3.5 w-3.5 text-amber-300" />
                    <span>نسخ الرابط</span>
                  </button>
                </div>
              </div>

              {/* Host Starting Score Picker in Lobby */}
              <div>
                <div className="mb-2 flex items-center justify-between text-xs font-extrabold text-white/80">
                  <span>نقاط البداية للمباراة:</span>
                  <span className="text-amber-300 tabular-nums">{lobbyScore}</span>
                </div>
                {onlineSide === 'red' ? (
                  <div className="grid grid-cols-4 gap-2">
                    {SCORE_CHOICES.map((sc) => (
                      <button
                        key={sc}
                        type="button"
                        onClick={() => {
                          setLobbyScore(sc);
                          wsRef.current?.send(
                            JSON.stringify({
                              type: 'update_settings',
                              startingScore: sc,
                            })
                          );
                        }}
                        className={`nawaf-choice py-2 text-center text-sm tabular-nums ${
                          lobbyScore === sc ? 'active' : ''
                        }`}
                      >
                        {sc}
                      </button>
                    ))}
                  </div>
                ) : (
                  <div className="rounded-xl bg-white/5 px-3 py-2 text-center text-xs font-bold text-white/75">
                    يختار المضيف نقاط البداية: {lobbyScore} نقطة
                  </div>
                )}
              </div>

              {/* Players List */}
              <div className="space-y-2">
                <div className="text-xs font-extrabold text-white/75">
                  اللاعبون ({lobbyPlayers.length} / 2)
                </div>
                {lobbyPlayers.map((p) => (
                  <div
                    key={p.side}
                    className="flex items-center justify-between rounded-xl border border-white/15 bg-black/30 px-3.5 py-2.5"
                  >
                    <span className="font-black text-white">{p.name}</span>
                    <span
                      className={`rounded-lg px-2.5 py-0.5 text-xs font-black ${
                        p.side === 'red'
                          ? 'bg-rose-500/25 text-rose-300'
                          : 'bg-sky-500/25 text-sky-300'
                      }`}
                    >
                      {p.side === 'red' ? 'السهم الأحمر' : 'السهم الأزرق'}
                    </span>
                  </div>
                ))}
              </div>

              {onlineSide === 'red' ? (
                <button
                  type="button"
                  disabled={lobbyPlayers.length < 2}
                  onClick={() =>
                    wsRef.current?.send(JSON.stringify({ type: 'start_match' }))
                  }
                  className="nawaf-primary disabled:opacity-50"
                >
                  {lobbyPlayers.length < 2
                    ? 'بانتظار دخول الخصم...'
                    : 'ابدأ المباراة الآن'}
                </button>
              ) : (
                <div className="rounded-xl border border-sky-400/25 bg-sky-500/10 py-3 text-center text-sm font-extrabold text-sky-200">
                  بانتظار المضيف لبدء المباراة...
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* GAMEPLAY SCREEN */}
      {screen === 'playing' && (
        <div
          className="relative h-dvh w-full overflow-hidden touch-manipulation"
          onPointerDown={(e) => {
            // Avoid firing dart when clicking HUD buttons
            if ((e.target as HTMLElement).closest('button')) return;
            engineRef.current?.handleAimTap();
          }}
        >
          <canvas
            ref={canvasRef}
            className="block h-full w-full"
          />

          {/* Top-Right White Semi-Circle Exit / Withdraw Tab (exact match to video EXIT tab) */}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              handleExitMatch();
            }}
            className="fixed right-0 top-7 z-30 flex h-24 w-12 cursor-pointer items-center justify-center rounded-l-full bg-white text-[#23262f] shadow-xl transition-transform active:scale-95"
            aria-label={mode === 'online' ? 'انسحاب' : 'خروج'}
          >
            <span className="-rotate-90 whitespace-nowrap text-sm font-black tracking-wide">
              {mode === 'online' ? 'انسحاب' : 'خروج'}
            </span>
          </button>

          {/* Bottom-Left White Semi-Circle Score Tab (exact match to video Red • Blue tab) */}
          {hud && (
            <div className="pointer-events-none fixed bottom-5 left-0 z-30 flex h-28 w-12 flex-col items-center justify-center rounded-r-full bg-white shadow-xl">
              <div className="flex -rotate-90 items-center gap-1.5 whitespace-nowrap text-base font-black tabular-nums">
                <span className="text-[#ef4444]">{hud.redScore}</span>
                <span className="text-slate-800">•</span>
                <span className="text-[#0ea5e9]">{hud.blueScore}</span>
              </div>
            </div>
          )}

          {/* Mid-Left (?) Help Button ONLY during player's turn */}
          {hud?.canToggleHelp && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                engineRef.current?.toggleHelp();
              }}
              className={`fixed left-5 top-[68%] z-30 flex h-12 w-12 cursor-pointer items-center justify-center rounded-full border-2 shadow-lg transition-all active:scale-90 ${
                hud.showHelp
                  ? 'border-white bg-slate-900 text-amber-300'
                  : 'border-white/35 bg-black/45 text-white hover:bg-black/65'
              }`}
              aria-label="شرح النقاط"
            >
              <HelpCircle className="h-6 w-6 stroke-[2.6]" />
            </button>
          )}

          {/* Nawaf Games End Match Win Card */}
          <EndMatchOverlay
            open={hud?.phase === 'finished'}
            mode={mode}
            mySide={hud?.mySide ?? 'red'}
            winnerSide={hud?.winnerSide ?? null}
            winnerName={hud?.winnerName ?? null}
            redName={hud?.redName ?? 'اللاعب الأحمر'}
            blueName={hud?.blueName ?? 'البوت'}
            redScore={hud?.redScore ?? settings.startingScore}
            blueScore={hud?.blueScore ?? settings.startingScore}
            startingScore={hud?.startingScore ?? settings.startingScore}
            reason={hud?.endReason ?? null}
            rematchPending={rematchPending}
            onRematch={handleRematch}
            onExitHome={handleExitMatch}
          />
        </div>
      )}

      <SettingsModal
        open={settingsOpen}
        settings={settings}
        onChange={updateSettings}
        onClose={() => setSettingsOpen(false)}
        hideGameplayOptions={screen === 'playing'}
      />
    </div>
  );
}
