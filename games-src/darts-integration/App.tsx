import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowRight, HelpCircle } from 'lucide-react';
import { EndMatchOverlay } from './components/EndMatchOverlay';
import { DartsEngine } from './game/dartsEngine';
import { dartsSound } from './game/dartsSound';
import type { DartsSettings, Difficulty, GameMode, HudSnapshot, PlayerSide, StartingScore } from './game/dartsTypes';
import cover from './assets/images/darts_cover_1795304337579.jpg';

declare global {
  interface Window {
    Telegram?: {
      WebApp?: {
        initData?: string;
        initDataUnsafe?: { user?: { first_name?: string; last_name?: string; username?: string }; start_param?: string };
        ready?: () => void;
        expand?: () => void;
        close?: () => void;
      };
    };
  }
}

type Screen = 'setup' | 'playing';
const SCORE_CHOICES: StartingScore[] = [200, 300, 350, 501];
const DIFFICULTIES: { value: Difficulty; label: string; hint: string }[] = [
  { value: 'easy', label: 'سهل', hint: 'دقة تصويب خفيفة وممتعة' },
  { value: 'medium', label: 'متوسط', hint: 'تحدي متوازن' },
  { value: 'hard', label: 'صعب', hint: 'تحدي أقوى في التصويب' },
];
const DEFAULT_SETTINGS: DartsSettings = { startingScore: 300, difficulty: 'medium', aimSpeed: 'normal', haptics: true };

function telegramName(): string {
  const user = window.Telegram?.WebApp?.initDataUnsafe?.user;
  return [user?.first_name, user?.last_name].filter(Boolean).join(' ').trim() || user?.username || 'أنت';
}
function getGameId(): string {
  const queryId = new URLSearchParams(window.location.search).get('game_id') || '';
  const start = window.Telegram?.WebApp?.initDataUnsafe?.start_param || '';
  return queryId || (start.startsWith('online_darts_') ? start.slice(13) : '');
}
async function apiRequest(path: string, payload: Record<string, unknown>) {
  const initData = window.Telegram?.WebApp?.initData || '';
  if (!initData) throw new Error('افتح اللعبة من داخل تيليجرام أولاً');
  const response = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...payload, initData }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.ok) throw new Error(data.error || 'تعذر الاتصال بالسيرفر');
  return data;
}

export default function App() {
  const gameIdRef = useRef(getGameId());
  const [screen, setScreen] = useState<Screen>(gameIdRef.current ? 'playing' : 'setup');
  const [mode, setMode] = useState<GameMode>(gameIdRef.current ? 'online' : 'bot');
  const [settings, setSettings] = useState<DartsSettings>(() => {
    try {
      const raw = localStorage.getItem('nawaf_darts_settings_v1');
      if (!raw) return DEFAULT_SETTINGS;
      const saved = JSON.parse(raw) as Partial<DartsSettings>;
      return {
        startingScore: SCORE_CHOICES.includes(saved.startingScore as StartingScore) ? saved.startingScore as StartingScore : 300,
        difficulty: saved.difficulty === 'easy' || saved.difficulty === 'hard' ? saved.difficulty : 'medium',
        aimSpeed: saved.aimSpeed === 'fast' ? 'fast' : 'normal',
        haptics: saved.haptics !== false,
      };
    } catch { return DEFAULT_SETTINGS; }
  });
  const [playerName, setPlayerName] = useState(telegramName);
  const [onlineSide, setOnlineSide] = useState<PlayerSide>('red');
  const [redName, setRedName] = useState('اللاعب الأحمر');
  const [blueName, setBlueName] = useState('اللاعب الأزرق');
  const [hud, setHud] = useState<HudSnapshot | null>(null);
  const [matchKey, setMatchKey] = useState(0);
  const [toast, setToast] = useState('');
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const engineRef = useRef<DartsEngine | null>(null);
  const cursorRef = useRef('0');
  const initialOnlineStateRef = useRef<Record<string, unknown> | null>(null);

  const showToast = useCallback((message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(current => current === message ? '' : current), 2400);
  }, []);

  const updateSettings = useCallback((next: DartsSettings) => {
    setSettings(next);
    try { localStorage.setItem('nawaf_darts_settings_v1', JSON.stringify(next)); } catch {}
  }, []);

  useEffect(() => {
    const tg = window.Telegram?.WebApp;
    tg?.ready?.();
    tg?.expand?.();
    if (!gameIdRef.current) return;
    let cancelled = false;
    apiRequest('/api/darts/state', { game_id: gameIdRef.current, after: '0' })
      .then(data => {
        if (cancelled) return;
        const game = data.game || {};
        cursorRef.current = String(data.latestEventId || '0');
        initialOnlineStateRef.current = {
          type: 'state_sync', phase: game.phase, activeSide: game.active_side,
          redScore: game.red_score, blueScore: game.blue_score, round: game.round,
          redName: game.red_player_name, blueName: game.blue_player_name, lockedX: game.locked_x,
        };
        const score = Number(game.starting_score || 300);
        setMode('online');
        setOnlineSide(game.side === 'blue' ? 'blue' : 'red');
        setRedName(String(game.red_player_name || 'اللاعب الأحمر'));
        setBlueName(String(game.blue_player_name || 'اللاعب الأزرق'));
        if (SCORE_CHOICES.includes(score as StartingScore)) setSettings(current => ({ ...current, startingScore: score as StartingScore }));
        setScreen('playing');
        setMatchKey(value => value + 1);
      })
      .catch(error => {
        if (!cancelled) showToast(error.message || 'تعذر تحميل المباراة');
      });
    return () => { cancelled = true; };
  }, [showToast]);

  useEffect(() => {
    if (screen !== 'playing') {
      engineRef.current?.destroy();
      engineRef.current = null;
      return;
    }
    const canvas = canvasRef.current;
    if (!canvas) return;
    const engine = new DartsEngine({
      canvas,
      mode,
      mySide: onlineSide,
      redName: mode === 'online' ? redName : (playerName.trim() || 'أنت'),
      blueName: mode === 'online' ? blueName : 'البوت',
      settings,
      onHudUpdate: setHud,
      onSendOnlineAction: action => {
        if (!gameIdRef.current) return;
        apiRequest('/api/darts/action', { game_id: gameIdRef.current, action: action.type, value: action.value })
          .catch(error => showToast(error.message || 'تعذر إرسال الحركة'));
      },
    });
    engineRef.current = engine;
    if (mode === 'online' && initialOnlineStateRef.current) {
      engine.applyOnlineState(initialOnlineStateRef.current as { type: string; [key: string]: unknown });
      initialOnlineStateRef.current = null;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.code === 'Space' || event.code === 'Enter') {
        event.preventDefault();
        engine.handleAimTap();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      engine.destroy();
      if (engineRef.current === engine) engineRef.current = null;
    };
  }, [screen, matchKey, mode, onlineSide, redName, blueName, playerName, settings, showToast]);

  useEffect(() => {
    if (screen !== 'playing' || mode !== 'online' || !gameIdRef.current) return;
    let active = true;
    let timer = 0;
    const poll = async () => {
      try {
        const data = await apiRequest('/api/darts/state', { game_id: gameIdRef.current, after: cursorRef.current });
        if (!active) return;
        for (const event of data.events || []) {
          engineRef.current?.applyOnlineState(event.payload || event);
          cursorRef.current = String(event.id);
        }
      } catch (error) {
        if (active) showToast((error as Error).message || 'انقطع الاتصال');
      }
      if (active) timer = window.setTimeout(poll, 650);
    };
    void poll();
    return () => { active = false; window.clearTimeout(timer); };
  }, [screen, mode, matchKey, showToast]);

  const startBotMatch = () => {
    dartsSound.unlock();
    setMode('bot');
    setHud(null);
    setScreen('playing');
    setMatchKey(value => value + 1);
  };

  const leaveGame = async () => {
    if (mode === 'online' && gameIdRef.current) {
      try { await apiRequest('/api/darts/action', { game_id: gameIdRef.current, action: 'withdraw' }); } catch {}
    }
    window.location.href = '/miniapp/';
  };

  const rematch = () => {
    dartsSound.unlock();
    setHud(null);
    setMatchKey(value => value + 1);
  };

  return (
    <div className="min-h-dvh w-full select-none text-white" dir="rtl">
      {toast && <div className="nawaf-toast">{toast}</div>}
      {screen === 'setup' && (
        <div className="mx-auto flex min-h-dvh w-full max-w-md flex-col px-4 pb-6 pt-4">
          <div className="mb-3 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-rose-500 to-red-800 shadow">🎯</div>
              <div>
                <h1 className="m-0 text-xl font-black leading-tight text-white">السهام</h1>
                <p className="m-0 h-1" aria-hidden="true"></p>
              </div>
            </div>
            <button type="button" onClick={() => { window.location.href = '/miniapp/'; }} className="nawaf-pill flex items-center gap-1.5">
              <ArrowRight className="h-4 w-4" /><span>رجوع</span>
            </button>
          </div>

          <div className="nawaf-panel mb-4 overflow-hidden p-2">
            <img src={cover} alt="لعبة السهام" className="aspect-video w-full rounded-xl object-cover" />
            <div className="mt-2.5 flex items-center justify-between px-1.5 pb-1">
              <span className="text-sm font-black text-white">صوّب على التربل والدبل لتصل إلى 0!</span>
              <span className="rounded-lg bg-rose-500/20 px-2 py-0.5 text-xs font-black text-rose-200 tabular-nums">{settings.startingScore} نقطة</span>
            </div>
          </div>

          <div className="nawaf-panel space-y-4 p-4">
            <div>
              <label className="mb-1.5 block text-xs font-extrabold text-white/80">اسمك في المباراة</label>
              <input value={playerName} maxLength={22} onChange={event => setPlayerName(event.target.value)} className="w-full rounded-xl border border-white/25 bg-black/35 px-3.5 py-2.5 text-sm font-bold text-white outline-none focus:border-rose-400" placeholder="اكتب اسمك..." />
            </div>
            <div>
              <div className="mb-2 text-xs font-extrabold text-white/80">نقاط البداية (من يصل إلى 0 أولاً يفوز)</div>
              <div className="grid grid-cols-4 gap-2">
                {SCORE_CHOICES.map(score => (
                  <button key={score} type="button" onClick={() => updateSettings({ ...settings, startingScore: score })} className={'nawaf-choice py-2.5 text-center text-sm tabular-nums ' + (settings.startingScore === score ? 'active' : '')}>{score}</button>
                ))}
              </div>
            </div>
            <div>
              <div className="mb-2 text-xs font-extrabold text-white/80">مستوى صعوبة البوت</div>
              <div className="grid grid-cols-3 gap-2">
                {DIFFICULTIES.map(item => (
                  <button key={item.value} type="button" onClick={() => updateSettings({ ...settings, difficulty: item.value })} className={'nawaf-choice py-2.5 text-center text-sm ' + (settings.difficulty === item.value ? 'active' : '')}>
                    {item.label}
                  </button>
                ))}
              </div>
              <p className="mt-1.5 text-xs text-white/60">{DIFFICULTIES.find(item => item.value === settings.difficulty)?.hint}</p>
            </div>
          </div>
          <button type="button" onClick={startBotMatch} className="nawaf-primary mt-5">ابدأ اللعب الآن</button>
        </div>
      )}

      {screen === 'playing' && (
        <div className="relative h-dvh w-full overflow-hidden touch-manipulation" onPointerDown={event => {
          if ((event.target as HTMLElement).closest('button')) return;
          engineRef.current?.handleAimTap();
        }}>
          <canvas ref={canvasRef} className="block h-full w-full" />
          <button type="button" onClick={event => { event.stopPropagation(); void leaveGame(); }} className="fixed right-0 top-7 z-30 flex h-24 w-12 items-center justify-center rounded-l-full bg-white text-[#23262f] shadow-xl" aria-label="خروج">
            <span className="-rotate-90 whitespace-nowrap text-sm font-black tracking-wide">{mode === 'online' ? 'انسحاب' : 'خروج'}</span>
          </button>
          {hud && (
            <div className="pointer-events-none fixed bottom-5 left-0 z-30 flex h-28 w-12 flex-col items-center justify-center rounded-r-full bg-white shadow-xl">
              <div className="flex -rotate-90 items-center gap-1.5 whitespace-nowrap text-base font-black tabular-nums">
                <span className="text-[#ef4444]">{hud.redScore}</span><span className="text-slate-800">•</span><span className="text-[#0ea5e9]">{hud.blueScore}</span>
              </div>
            </div>
          )}
          {hud?.canToggleHelp && (
            <button type="button" onClick={event => { event.stopPropagation(); engineRef.current?.toggleHelp(); }} className={'fixed left-5 top-[68%] z-30 flex h-12 w-12 items-center justify-center rounded-full border-2 shadow-lg ' + (hud.showHelp ? 'border-white bg-slate-900 text-amber-300' : 'border-white/35 bg-black/45 text-white')} aria-label="شرح النقاط">
              <HelpCircle className="h-6 w-6 stroke-[2.6]" />
            </button>
          )}
          <EndMatchOverlay
            open={hud?.phase === 'finished'}
            mode={mode}
            mySide={hud?.mySide ?? onlineSide}
            winnerSide={hud?.winnerSide ?? null}
            winnerName={hud?.winnerName ?? null}
            redName={hud?.redName ?? redName}
            blueName={hud?.blueName ?? 'البوت'}
            redScore={hud?.redScore ?? settings.startingScore}
            blueScore={hud?.blueScore ?? settings.startingScore}
            startingScore={hud?.startingScore ?? settings.startingScore}
            reason={hud?.endReason ?? null}
            rematchPending={false}
            onRematch={rematch}
            onExitHome={() => { window.location.href = '/miniapp/'; }}
          />
        </div>
      )}
    </div>
  );
}
