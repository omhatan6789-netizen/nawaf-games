import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Copy,
  LogOut,
  RotateCcw,
  Share2,
  Users,
  Volume2,
  VolumeX,
} from 'lucide-react';
import { CarromPreviewSvg } from './components/CarromPreviewSvg';
import { PlayerBar } from './components/PlayerBar';
import { StrikerSlider } from './components/StrikerSlider';
import {
  CarromGameEngine,
  CarromHudSnapshot,
  CarromMatchConfig,
  CarromMatchResult,
  OnlineCarromSnapshot,
} from './game/carromEngine';
import {
  BOARD_SIZE,
  DifficultyLevel,
  FourPlayerMode,
  GameMode,
  PlayerCount,
} from './game/carromPhysics';
import { carromSound } from './game/carromSound';

declare global {
  interface Window {
    Telegram?: {
      WebApp?: {
        ready?: () => void;
        expand?: () => void;
        close?: () => void;
        openTelegramLink?: (url: string) => void;
        initDataUnsafe?: {
          start_param?: string;
          user?: {
            id?: number;
            first_name?: string;
            last_name?: string;
            username?: string;
          };
        };
      };
    };
  }
}

interface RoomPlayerDto {
  id: string;
  name: string;
  slotIndex: number;
  side: 'white' | 'black' | 'solo';
  connected: boolean;
  withdrawn: boolean;
}

interface OnlineRoomState {
  id: string;
  hostId: string;
  status: 'lobby' | 'playing' | 'finished';
  playerCount: PlayerCount;
  fourMode: FourPlayerMode;
  players: RoomPlayerDto[];
  spectatorsCount: number;
}

function getTelegramPlayerName(): string {
  const user = window.Telegram?.WebApp?.initDataUnsafe?.user;
  if (!user) return '';
  const full = [user.first_name, user.last_name].filter(Boolean).join(' ').trim();
  return full || user.username || '';
}

function getInitialRoomCodeFromUrl(): string {
  const params = new URLSearchParams(window.location.search);
  const queryRoom = params.get('room') || params.get('lobby');
  if (queryRoom) return queryRoom.trim().toUpperCase();

  const startParam = window.Telegram?.WebApp?.initDataUnsafe?.start_param || '';
  if (startParam.startsWith('carrom_')) {
    return startParam.slice(7).trim().toUpperCase();
  }
  if (startParam.startsWith('online_lobby_')) {
    return startParam.slice(13).trim().toUpperCase();
  }
  return '';
}

function getStableClientId(): string {
  const tgId = window.Telegram?.WebApp?.initDataUnsafe?.user?.id;
  if (tgId) return `tg_${tgId}`;
  const key = 'carrom_client_id';
  let existing = sessionStorage.getItem(key);
  if (!existing) {
    existing = 'web_' + Math.random().toString(36).slice(2, 10);
    sessionStorage.setItem(key, existing);
  }
  return existing;
}

export default function App() {
  const initialRoomCode = useMemo(() => getInitialRoomCodeFromUrl(), []);
  const clientId = useMemo(() => getStableClientId(), []);

  const [screen, setScreen] = useState<'home' | 'setup' | 'playing'>(() => initialRoomCode ? 'setup' : 'home');
  const [mode, setMode] = useState<GameMode>(() =>
    initialRoomCode ? 'online' : 'bot'
  );
  const [difficulty, setDifficulty] = useState<DifficultyLevel>('متوسط');
  const [playerCount, setPlayerCount] = useState<PlayerCount>(2);
  const [fourMode, setFourMode] = useState<FourPlayerMode>('teams');
  const [playerName, setPlayerName] = useState<string>(
    () => getTelegramPlayerName() || 'أنت'
  );
  const [botUsername, setBotUsername] = useState<string>('');
  const [localP2Name, setLocalP2Name] = useState<string>('اللاعب الثاني');
  const [muted, setMuted] = useState(false);

  // Online multiplayer state
  const [wsConnected, setWsConnected] = useState(false);
  const [onlineRoom, setOnlineRoom] = useState<OnlineRoomState | null>(null);
  const [myOnlineId, setMyOnlineId] = useState<string>(clientId);
  const [amISpectator, setAmISpectator] = useState(false);
  const [joinCodeInput, setJoinCodeInput] = useState<string>(initialRoomCode);
  const [onlineError, setOnlineError] = useState<string | null>(null);
  const [copyFeedback, setCopyFeedback] = useState<string | null>(null);

  const [hud, setHud] = useState<CarromHudSnapshot>({
    players: [],
    turn: 0,
    playerCount: 2,
    fourMode: 'teams',
    queenStatus: 'on_board',
    queenHolderSlot: null,
    remainingWhite: 9,
    remainingBlack: 9,
    sliderNorm: 0,
    strikerOverlapping: false,
    canInteract: true,
    shotMoving: false,
    hintText: 'حرّك السحّاب لتحديد مكان القرص، ثم اسحب القرص للخلف وأفلته للتسديد',
    spectating: false,
  });
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const [matchResult, setMatchResult] = useState<CarromMatchResult | null>(null);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const engineRef = useRef<CarromGameEngine | null>(null);
  const toastTimerRef = useRef<number | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const latestSnapshotRef = useRef<OnlineCarromSnapshot | null>(null);
  const autoJoinedInitialRef = useRef(false);

  useEffect(() => {
    window.Telegram?.WebApp?.ready?.();
    window.Telegram?.WebApp?.expand?.();
  }, []);

  useEffect(() => {
    let active = true;
    fetch('/api/mini-app')
      .then((response) => response.ok ? response.json() : null)
      .then((data) => {
        if (active && data?.bot_username) {
          setBotUsername(String(data.bot_username).replace(/^@/, ''));
        }
      })
      .catch(() => {});
    return () => { active = false; };
  }, []);

  const showToast = useCallback((msg: string) => {
    setToastMsg(msg);
    if (toastTimerRef.current) {
      window.clearTimeout(toastTimerRef.current);
    }
    toastTimerRef.current = window.setTimeout(() => {
      setToastMsg(null);
    }, 2200);
  }, []);

  const sendWs = useCallback((payload: Record<string, unknown>) => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return false;
    ws.send(JSON.stringify(payload));
    return true;
  }, []);

  // WebSocket connection for online multiplayer
  useEffect(() => {
    if (mode !== 'online') {
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
      setWsConnected(false);
      return;
    }

    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${proto}//${window.location.host}/ws/carrom`;
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      setWsConnected(true);
      setOnlineError(null);
      if (initialRoomCode && !autoJoinedInitialRef.current) {
        autoJoinedInitialRef.current = true;
        ws.send(
          JSON.stringify({
            type: 'join_room',
            roomId: initialRoomCode,
            clientId,
            name: (getTelegramPlayerName() || playerName || 'لاعب').trim(),
          })
        );
      }
    };

    ws.onmessage = (event) => {
      let data: Record<string, unknown>;
      try {
        data = JSON.parse(String(event.data));
      } catch {
        return;
      }

      const type = String(data.type || '');
      if (type === 'error') {
        setOnlineError(String(data.message || 'تعذر الاتصال بالغرفة'));
      } else if (type === 'joined') {
        setMyOnlineId(String(data.playerId || clientId));
        setAmISpectator(Boolean(data.isSpectator));
        setOnlineError(null);
      } else if (type === 'left_room') {
        setOnlineRoom(null);
        setAmISpectator(false);
        latestSnapshotRef.current = null;
        setMatchResult(null);
        setScreen('setup');
      } else if (type === 'room_state') {
        const room = data.room as OnlineRoomState;
        setOnlineRoom(room);
        if (room.status === 'playing') {
          setMatchResult(null);
          setScreen('playing');
        }
      } else if (type === 'carrom_snapshot') {
        const snap = data as unknown as OnlineCarromSnapshot;
        latestSnapshotRef.current = snap;
        engineRef.current?.applyOnlineSnapshot(snap);
      } else if (type === 'sfx') {
        engineRef.current?.handleRemoteSfx({
          kind: String(data.kind || ''),
          intensity: data.intensity !== undefined ? Number(data.intensity) : undefined,
          isQueen: Boolean(data.isQueen),
          isStriker: Boolean(data.isStriker),
          x: data.x !== undefined ? Number(data.x) : undefined,
          y: data.y !== undefined ? Number(data.y) : undefined,
        });
      } else if (type === 'toast') {
        showToast(String(data.text || ''));
      } else if (type === 'match_end') {
        engineRef.current?.markOnlineMatchOver();
        const isDraw = Boolean(data.winnerIsDraw);
        carromSound.playVictory(!isDraw);
        const standings = Array.isArray(data.standings)
          ? (data.standings as CarromMatchResult['standings'])
          : [];
        setMatchResult({
          winnerName: String(data.winnerName || 'الفائز'),
          winnerIsBot: false,
          winnerIsDraw: isDraw,
          winnerSide: (data.winnerSide as CarromMatchResult['winnerSide']) ?? null,
          standings,
          turnsPlayed: Number(data.turnsPlayed) || 0,
        });
      }
    };

    ws.onclose = () => {
      setWsConnected(false);
    };

    return () => {
      ws.close();
      wsRef.current = null;
    };
  }, [mode, clientId, initialRoomCode, showToast]);

  const myOnlineSlot = useMemo(() => {
    if (!onlineRoom) return undefined;
    const found = onlineRoom.players.find((p) => p.id === myOnlineId);
    return found ? found.slotIndex : undefined;
  }, [onlineRoom, myOnlineId]);

  // Mount / tear down gameplay canvas engine
  useEffect(() => {
    if (screen !== 'playing' || !canvasRef.current) return;

    const p1 = playerName.trim() || 'أنت';
    const p2 = mode === 'bot' ? 'بوت نواف' : localP2Name.trim() || 'اللاعب الثاني';
    const names =
      mode === 'online' && onlineRoom
        ? onlineRoom.players.map((p) => p.name)
        : playerCount === 4 && mode !== 'bot'
          ? [p1, p2, 'اللاعب الثالث', 'اللاعب الرابع']
          : [p1, p2];

    const effectiveCount: PlayerCount =
      mode === 'bot'
        ? 2
        : mode === 'online' && onlineRoom
          ? onlineRoom.playerCount
          : playerCount;

    const effectiveFourMode: FourPlayerMode =
      mode === 'online' && onlineRoom ? onlineRoom.fourMode : fourMode;

    const config: CarromMatchConfig = {
      mode,
      difficulty,
      playerCount: effectiveCount,
      fourMode: effectiveFourMode,
      playerNames: names,
      localSlotIndex: mode === 'online' ? myOnlineSlot : undefined,
      spectating: mode === 'online' ? amISpectator : false,
      onOnlineSliderMove:
        mode === 'online'
          ? (sliderNorm) => {
              sendWs({ type: 'slider_move', sliderNorm });
            }
          : undefined,
      onOnlineAim:
        mode === 'online'
          ? (aim) => {
              sendWs({ type: 'aim_update', aim });
            }
          : undefined,
      onOnlineShoot:
        mode === 'online'
          ? (sliderNorm, vx, vy) => {
              sendWs({ type: 'shoot', sliderNorm, vx, vy });
            }
          : undefined,
    };

    const engine = new CarromGameEngine(canvasRef.current, config, {
      onHud: (next) => setHud(next),
      onToast: (msg) => showToast(msg),
      onMatchEnd: (res) => setMatchResult(res),
    });
    engineRef.current = engine;

    if (mode === 'online' && latestSnapshotRef.current) {
      engine.applyOnlineSnapshot(latestSnapshotRef.current);
    }

    return () => {
      engine.dispose();
      engineRef.current = null;
    };
  }, [
    screen,
    mode,
    difficulty,
    playerCount,
    fourMode,
    playerName,
    localP2Name,
    myOnlineSlot,
    amISpectator,
    onlineRoom?.id,
    onlineRoom?.playerCount,
    onlineRoom?.fourMode,
    sendWs,
    showToast,
  ]);

  const handleStartLocalOrBot = () => {
    carromSound.unlock();
    setMatchResult(null);
    setToastMsg(null);
    setScreen('playing');
  };

  const handleRestart = () => {
    carromSound.unlock();
    setMatchResult(null);
    setToastMsg(null);
    if (mode === 'online') {
      sendWs({ type: 'rematch' });
      return;
    }
    if (engineRef.current) {
      engineRef.current.restart();
    } else {
      setScreen('playing');
    }
  };

  const handleExitGameplay = () => {
    setMatchResult(null);
    setToastMsg(null);
    if (mode === 'online') {
      sendWs({ type: 'leave_room' });
      setOnlineRoom(null);
      latestSnapshotRef.current = null;
      setScreen('setup');
      return;
    }
    setScreen('setup');
  };

  const toggleMute = () => {
    const next = !muted;
    carromSound.muted = next;
    setMuted(next);
  };

  const handleCreateOnlineRoom = () => {
    carromSound.unlock();
    setOnlineError(null);
    sendWs({
      type: 'create_room',
      clientId,
      name: playerName.trim() || 'اللاعب الأول',
      playerCount,
      fourMode,
    });
  };

  const handleJoinOnlineRoom = () => {
    carromSound.unlock();
    const code = joinCodeInput.trim().toUpperCase();
    if (!code) {
      setOnlineError('اكتب رمز الغرفة أولًا');
      return;
    }
    setOnlineError(null);
    sendWs({
      type: 'join_room',
      roomId: code,
      clientId,
      name: playerName.trim() || 'لاعب',
    });
  };

  const buildInviteDetails = (room: OnlineRoomState) => {
    const baseUrl = `${window.location.origin}${window.location.pathname}`;
    const roomUrl = botUsername
      ? `https://t.me/${botUsername}?startapp=${encodeURIComponent(`carrom_${room.id}`)}`
      : `${baseUrl}?room=${encodeURIComponent(room.id)}`;
    const hostName = room.players[0]?.name || playerName || 'لاعب';
    const inviteText =
      `🎯 غرفة أونلاين — لعبة الكيرم\n\n` +
      `أنشأ ${hostName} غرفة كيرم (${room.playerCount} لاعبين).\n` +
      `اللاعبون الحاليون: ${room.players.length}/${room.playerCount}\n` +
      `افتحوا الغرفة للانضمام وبدء التحدي!\n` +
      `رمز الغرفة: ${room.id}`;
    return { roomUrl, inviteText };
  };

  const handleShareTelegram = () => {
    if (!onlineRoom) return;
    const { roomUrl, inviteText } = buildInviteDetails(onlineRoom);
    const shareLink = `https://t.me/share/url?url=${encodeURIComponent(
      roomUrl
    )}&text=${encodeURIComponent(inviteText)}`;
    if (window.Telegram?.WebApp?.openTelegramLink) {
      window.Telegram.WebApp.openTelegramLink(shareLink);
    } else if (navigator.share) {
      navigator
        .share({ title: 'الكيرم — غرفة أونلاين', text: inviteText, url: roomUrl })
        .catch(() => {
          window.open(shareLink, '_blank');
        });
    } else if (navigator.clipboard) {
      navigator.clipboard.writeText(`${inviteText}\n\nدخول غرفة اللعبة: ${roomUrl}`);
      setCopyFeedback('تم نسخ دعوة الغرفة!');
      setTimeout(() => setCopyFeedback(null), 2000);
    }
  };

  const handleCopyInvite = async () => {
    if (!onlineRoom) return;
    const { roomUrl, inviteText } = buildInviteDetails(onlineRoom);
    const full = `${inviteText}\n\n🔗 دخول غرفة اللعبة:\n${roomUrl}`;
    try {
      await navigator.clipboard.writeText(full);
      setCopyFeedback('تم نسخ رسالة الدعوة والرابط ✓');
      setTimeout(() => setCopyFeedback(null), 2000);
    } catch {
      setCopyFeedback('تعذر النسخ التلقائي');
    }
  };

  const isHost = onlineRoom ? onlineRoom.hostId === myOnlineId : false;

  // =========================================================================
  // MAIN MODE SELECTOR
  // =========================================================================
  if (screen === 'home') {
    return (
      <div className="min-h-[100dvh] w-full flex flex-col items-center justify-center px-4 py-6">
        <main className="w-full max-w-[520px] flex flex-col gap-4">
          <section className="nawaf-panel p-5 sm:p-7 flex flex-col gap-5 text-center">
            <CarromPreviewSvg />
            <div>
              <h1 className="text-3xl font-black text-white">الكيرم 🎯</h1>
              <p className="mt-2 text-sm font-bold text-white/70">اختر طريقة اللعب وابدأ التحدي</p>
            </div>
            <button type="button" onClick={() => { setMode('bot'); setScreen('setup'); }} className="nawaf-primary py-4 text-base">
              🤖 اللعب ضد بوت نواف
            </button>
            <button type="button" onClick={() => { setMode('online'); setScreen('setup'); }} className="nawaf-secondary py-4 text-base">
              🌐 اللعب ضد شخص في تيليجرام
            </button>
            <button type="button" onClick={() => { setMode('local'); setScreen('setup'); }} className="nawaf-choice py-3 text-sm">
              👥 اللعب على نفس الجهاز
            </button>
            <button type="button" onClick={() => window.Telegram?.WebApp?.close?.()} className="text-xs font-bold text-white/55 py-2">
              إغلاق
            </button>
          </section>
        </main>
      </div>
    );
  }

  // =========================================================================
  // GAMEPLAY SCREEN (Fits cleanly inside 100dvh without scrolling)
  // =========================================================================
  if (screen === 'playing') {
    const modeLabel =
      mode === 'bot'
        ? `ضد بوت نواف · ${difficulty}`
        : mode === 'online'
          ? `أونلاين · ${onlineRoom?.id ?? ''}`
          : 'نفس الجهاز';

    return (
      <div className="h-[100dvh] w-full flex flex-col items-center justify-between overflow-hidden px-2.5 py-2 sm:py-3 select-none">
        <div className="w-full max-w-[540px] h-full flex flex-col justify-between gap-2">
          {/* Top Bar */}
          <header className="flex items-center justify-between gap-2 shrink-0">
            <button
              type="button"
              onClick={handleExitGameplay}
              className="nawaf-pill whitespace-nowrap shrink-0"
            >
              خروج
            </button>

            <div className="text-center min-w-0">
              <div className="text-sm sm:text-base font-black text-white leading-tight truncate">
                الكيرم 🎯
              </div>
              <div className="text-[11px] font-bold text-white/60 truncate">
                {modeLabel}
              </div>
            </div>

            <div className="flex items-center gap-1.5 shrink-0">
              <button
                type="button"
                onClick={toggleMute}
                className="nawaf-pill flex items-center justify-center w-9 h-9 p-0"
                aria-label={muted ? 'تشغيل الصوت' : 'كتم الصوت'}
              >
                {muted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
              </button>
              {mode !== 'online' && (
                <button
                  type="button"
                  onClick={handleRestart}
                  className="nawaf-pill flex items-center gap-1 whitespace-nowrap shrink-0"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  <span>جديدة</span>
                </button>
              )}
            </div>
          </header>

          {/* Players Display Above the Carrom Board */}
          <div className="shrink-0">
            <PlayerBar
              players={hud.players}
              turn={hud.turn}
              playerCount={hud.playerCount}
              fourMode={hud.fourMode}
              queenStatus={hud.queenStatus}
              queenHolderSlot={hud.queenHolderSlot}
              remainingWhite={hud.remainingWhite}
              remainingBlack={hud.remainingBlack}
            />
          </div>

          {/* Center Carrom Board Canvas */}
          <div className="flex-1 min-h-0 flex items-center justify-center py-0.5">
            <div className="relative aspect-square w-[min(100%,calc(100dvh-238px),500px)] max-h-full rounded-[22px] shadow-[0_18px_46px_rgba(0,0,0,0.68)] overflow-hidden">
              <canvas
                ref={canvasRef}
                width={BOARD_SIZE}
                height={BOARD_SIZE}
                className="block w-full h-full touch-none cursor-crosshair"
              />
            </div>
          </div>

          {/* Tactile Striker Slider Directly Below the Board + Hint */}
          <div className="shrink-0 flex flex-col gap-1.5 pb-0.5">
            <StrikerSlider
              value={hud.sliderNorm}
              disabled={!hud.canInteract}
              overlapping={hud.strikerOverlapping}
              onChange={(nextNorm) => engineRef.current?.setSliderNorm(nextNorm)}
              onDragEnd={() => engineRef.current?.commitSliderEnd()}
            />
            <div className="text-center text-xs font-extrabold text-amber-100/85 truncate px-2">
              {hud.hintText}
            </div>
          </div>
        </div>

        {toastMsg && <div className="nawaf-toast">{toastMsg}</div>}

        {/* Exact nawaf-bot-v2 Win / Loss End-of-Match Overlay */}
        {matchResult && (
          <div className="online-end-overlay" role="dialog" aria-modal="true">
            <div className="online-end-card">
              <h2>
                {matchResult.winnerIsDraw
                  ? '🤝 تعادل جميل!'
                  : matchResult.winnerIsBot
                    ? '💀 انتهى التحدي!'
                    : '🎉 مبروك الفوز!'}
              </h2>
              <div
                className={`online-end-winner ${
                  matchResult.winnerSide === 'black' ? 'is-blue' : ''
                }`}
              >
                {matchResult.winnerIsDraw
                  ? 'تعادل بين اللاعبين'
                  : matchResult.winnerIsBot
                    ? 'فاز بوت نواف'
                    : matchResult.winnerName}
              </div>
              <p className="tabular-nums">
                {matchResult.winnerIsDraw
                  ? `كانت مباراة حماسية في ${matchResult.turnsPlayed} تسديدة! يعطيكم العافية 👏`
                  : matchResult.winnerIsBot
                    ? `فاز بوت نواف بعد ${matchResult.turnsPlayed} تسديدة! حاول مرة ثانية 💪`
                    : `أبدعت يا ${matchResult.winnerName}! تستاهل الفوز 🏆`}
              </p>

              {matchResult.standings.length > 0 && (
                <div className="mb-4 flex flex-col gap-1.5 rounded-2xl border border-white/15 bg-black/35 p-3 text-right">
                  {matchResult.standings.map((st, idx) => (
                    <div
                      key={st.id}
                      className="flex items-center justify-between text-xs font-extrabold text-white/90"
                    >
                      <div className="flex items-center gap-2">
                        <span className="text-white/50">#{idx + 1}</span>
                        <span
                          className={`w-3 h-3 rounded-full border ${
                            st.side === 'white'
                              ? 'bg-[#f4efe6] border-[#9e8e78]'
                              : st.side === 'black'
                                ? 'bg-[#1a1a1d] border-white/40'
                                : 'bg-amber-400 border-amber-200'
                          }`}
                        />
                        <span>{st.name}</span>
                        {st.hasQueen && <span title="غطى الملكة">👑</span>}
                      </div>
                      <span className="tabular-nums text-[#facc15]">
                        {st.pocketedCount} قرص · {st.score} نقطة
                      </span>
                    </div>
                  ))}
                </div>
              )}

              <div className="online-end-actions">
                <button type="button" onClick={handleRestart} disabled={mode === 'online' && !isHost}>
                  ↻ إعادة اللعبة
                </button>
                <button
                  type="button"
                  className="secondary-end"
                  onClick={() => {
                    const telegram = (window as unknown as { Telegram?: { WebApp?: { close?: () => void } } }).Telegram?.WebApp;
                    if (telegram?.close) telegram.close();
                    else { try { window.close(); } catch {} }
                  }}
                >
                  قفل الصفحة
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  // =========================================================================
  // SETUP & ONLINE LOBBY SCREEN (Matching nawaf-bot-v2 design language)
  // =========================================================================
  return (
    <div className="min-h-[100dvh] w-full flex flex-col items-center px-3 py-2.5 sm:py-4">
      <main className="w-full max-w-[560px] flex flex-col gap-3">
        <header className="flex items-center justify-between gap-3 py-1">
          <button
            type="button"
            onClick={() => window.Telegram?.WebApp?.close?.()}
            className="nawaf-pill whitespace-nowrap shrink-0"
          >
            القائمة
          </button>

          <div className="text-center leading-tight">
            <div className="text-[21px] font-black tracking-tight text-white">
              الكيرم 🎯
            </div>
            <small className="block text-[10px] font-bold tracking-[1.8px] text-white/50">
              NAWAF GAME
            </small>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={toggleMute}
              className="nawaf-pill flex items-center justify-center w-9 h-9 p-0"
              aria-label={muted ? 'تشغيل الصوت' : 'كتم الصوت'}
            >
              {muted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
            </button>
          </div>
        </header>

        <section className="nawaf-panel p-4 sm:p-6 flex flex-col gap-5">
          <div className="text-center">
            <CarromPreviewSvg />
            <h1 className="text-[24px] sm:text-[26px] font-black text-white m-0 mt-2">
              لعبة الكيرم الأصلية
            </h1>
            <p className="text-sm text-white/75 m-0 mt-1.5">
              حرّك قرص التسديد بالسحّاب، اسحب للخلف للتصويب، وتحدَّ بوت نواف أو أصدقاءك أونلاين!
            </p>
          </div>

          {/* Player Name Inputs */}
          <div className="grid grid-cols-1 gap-3">
            <div>
              <label
                htmlFor="carrom-player-name"
                className="block text-xs font-bold text-white/75 mb-1.5"
              >
                اسمك في اللعبة (تيليجرام)
              </label>
              <input
                id="carrom-player-name"
                type="text"
                maxLength={24}
                value={playerName}
                onChange={(e) => setPlayerName(e.target.value)}
                placeholder="اكتب اسمك..."
                className="w-full rounded-xl border border-white/25 bg-[#12070a] px-3.5 py-2.5 text-sm font-bold text-white outline-none focus:border-[#ff9ba3]"
              />
            </div>

            {mode === 'local' && playerCount === 2 && (
              <div>
                <label
                  htmlFor="carrom-p2-name"
                  className="block text-xs font-bold text-white/75 mb-1.5"
                >
                  اسم اللاعب الثاني (نفس الجهاز)
                </label>
                <input
                  id="carrom-p2-name"
                  type="text"
                  maxLength={24}
                  value={localP2Name}
                  onChange={(e) => setLocalP2Name(e.target.value)}
                  placeholder="اكتب اسم اللاعب الثاني..."
                  className="w-full rounded-xl border border-white/25 bg-[#12070a] px-3.5 py-2.5 text-sm font-bold text-white outline-none focus:border-[#ff9ba3]"
                />
              </div>
            )}
          </div>

          {/* Game Mode Selection */}
          <div>
            <div className="text-xs font-bold text-white/75 mb-2">طريقة اللعب</div>
            <div className="grid grid-cols-3 gap-2">
              <button
                type="button"
                onClick={() => {
                  setMode('bot');
                  setOnlineRoom(null);
                }}
                className={`nawaf-choice py-3 px-2 text-xs sm:text-sm ${
                  mode === 'bot' ? 'active' : ''
                }`}
              >
                🤖 ضد بوت نواف
              </button>
              <button
                type="button"
                onClick={() => {
                  setMode('local');
                  setOnlineRoom(null);
                }}
                className={`nawaf-choice py-3 px-2 text-xs sm:text-sm ${
                  mode === 'local' ? 'active' : ''
                }`}
              >
                👥 نفس الجهاز
              </button>
              <button
                type="button"
                onClick={() => setMode('online')}
                className={`nawaf-choice py-3 px-2 text-xs sm:text-sm ${
                  mode === 'online' ? 'active' : ''
                }`}
              >
🌐 ضد شخص في تيليجرام
              </button>
            </div>
          </div>

          {/* Bot Difficulty */}
          {mode === 'bot' && (
            <div>
              <div className="text-xs font-bold text-white/75 mb-2">مستوى بوت نواف</div>
              <div className="grid grid-cols-3 gap-2">
                {(['سهل', 'متوسط', 'صعب'] as DifficultyLevel[]).map((lvl) => (
                  <button
                    key={lvl}
                    type="button"
                    onClick={() => setDifficulty(lvl)}
                    className={`nawaf-choice py-3 px-2 text-sm font-black ${
                      difficulty === lvl ? 'active' : ''
                    }`}
                  >
                    {lvl}
                  </button>
                ))}
              </div>
            </div>
          )}

          {mode !== 'online' && (
            <button
              type="button"
              onClick={handleStartLocalOrBot}
              className="nawaf-primary w-full py-4 text-base font-black shadow-lg"
            >
              🎯 ابدأ اللعبة
            </button>
          )}

          {/* Player Count & 4-Player Mode */}
          {mode !== 'bot' && (!onlineRoom || isHost) && (
            <>
              <div>
                <div className="text-xs font-bold text-white/75 mb-2">عدد اللاعبين</div>
                <div className="grid grid-cols-2 gap-2.5">
                  {([2, 4] as PlayerCount[]).map((cnt) => (
                    <button
                      key={cnt}
                      type="button"
                      onClick={() => {
                        setPlayerCount(cnt);
                        if (onlineRoom && isHost) {
                          sendWs({
                            type: 'update_settings',
                            playerCount: cnt,
                            fourMode,
                          });
                        }
                      }}
                      className={`nawaf-choice py-2.5 px-3 text-sm ${
                        (onlineRoom ? onlineRoom.playerCount : playerCount) === cnt
                          ? 'active'
                          : ''
                      }`}
                    >
                      {cnt === 2 ? 'لاعبان (1 ضد 1)' : '4 لاعبين'}
                    </button>
                  ))}
                </div>
              </div>

              {(onlineRoom ? onlineRoom.playerCount : playerCount) === 4 && (
                <div>
                  <div className="text-xs font-bold text-white/75 mb-2">
                    نظام الأربعة لاعبين
                  </div>
                  <div className="grid grid-cols-2 gap-2.5">
                    <button
                      type="button"
                      onClick={() => {
                        setFourMode('teams');
                        if (onlineRoom && isHost) {
                          sendWs({
                            type: 'update_settings',
                            playerCount: 4,
                            fourMode: 'teams',
                          });
                        }
                      }}
                      className={`nawaf-choice py-2.5 px-3 text-xs sm:text-sm ${
                        (onlineRoom ? onlineRoom.fourMode : fourMode) === 'teams'
                          ? 'active'
                          : ''
                      }`}
                    >
                      🤝 فريقان (2 ضد 2)
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setFourMode('solo');
                        if (onlineRoom && isHost) {
                          sendWs({
                            type: 'update_settings',
                            playerCount: 4,
                            fourMode: 'solo',
                          });
                        }
                      }}
                      className={`nawaf-choice py-2.5 px-3 text-xs sm:text-sm ${
                        (onlineRoom ? onlineRoom.fourMode : fourMode) === 'solo'
                          ? 'active'
                          : ''
                      }`}
                    >
                      🏆 كل لاعب لحاله
                    </button>
                  </div>
                </div>
              )}
            </>
          )}

          {/* Online Lobby / Create or Join Panel */}
          {mode === 'online' && (
            <div className="rounded-2xl border border-white/20 bg-[#14070b]/90 p-4 flex flex-col gap-3.5">
              {!onlineRoom ? (
                <>
                  <div className="flex items-center justify-between text-xs font-bold text-white/75">
                    <span className="flex items-center gap-1.5">
                      <Users className="w-4 h-4 text-[#ff9ba3]" />
                      غرفة كيرم أونلاين ({playerCount} لاعبين)
                    </span>
                    <span className="text-[11px] text-white/55">
                      {wsConnected ? 'متصل' : 'جاري الاتصال...'}
                    </span>
                  </div>

                  <button
                    type="button"
                    disabled={!wsConnected}
                    onClick={handleCreateOnlineRoom}
                    className="nawaf-primary disabled:opacity-50"
                  >
                    👥 أنشئ غرفة أونلاين جديدة
                  </button>

                  <div className="text-center text-[11px] font-bold text-white/55">
                    أنشئ غرفة ثم أرسل رابط الدعوة، وسينضم اللاعب مباشرة عند فتحه في تيليجرام
                  </div>
                </>
              ) : (
                <>
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <div className="text-sm font-black text-white">
                        غرفة الكيرم 🎯
                      </div>
                      <div className="text-[11px] font-bold text-white/60">
                        أرسل رابط الدعوة للاعبين للانضمام مباشرة
                      </div>
                    </div>
                    <div className="text-xs font-black tabular-nums text-white/80">
                      اللاعبون ({onlineRoom.players.length}/{onlineRoom.playerCount})
                    </div>
                  </div>

                  <div className="flex flex-col gap-2">
                    {onlineRoom.players.map((p, idx) => (
                      <div
                        key={p.id}
                        className="flex items-center justify-between rounded-xl border border-white/15 bg-black/35 px-3 py-2"
                      >
                        <div className="flex items-center gap-2.5">
                          <span
                            className={`w-3.5 h-3.5 rounded-full border shrink-0 ${
                              p.side === 'white'
                                ? 'bg-[#f4efe6] border-[#9e8e78]'
                                : p.side === 'black'
                                  ? 'bg-[#1a1a1d] border-white/40'
                                  : 'bg-amber-400 border-amber-200'
                            }`}
                          />
                          <span className="text-sm font-black text-white">
                            {p.name}
                          </span>
                          {p.id === myOnlineId && (
                            <span className="text-[11px] font-bold text-[#facc15]">
                              · أنت
                            </span>
                          )}
                          {idx === 0 && (
                            <span className="text-[11px] font-bold text-[#ff9ba3]">
                              · صاحب الغرفة
                            </span>
                          )}
                        </div>
                        <span className="text-xs font-bold text-white/65">
                          {p.side === 'white'
                            ? 'الأبيض'
                            : p.side === 'black'
                              ? 'الأسود'
                              : `المقعد ${idx + 1}`}
                        </span>
                      </div>
                    ))}
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={handleShareTelegram}
                      className="nawaf-secondary flex items-center justify-center gap-1.5 text-xs sm:text-sm"
                    >
                      <Share2 className="w-4 h-4 text-[#ff9ba3]" />
                      <span>إرسال دعوة الغرفة</span>
                    </button>
                    <button
                      type="button"
                      onClick={handleCopyInvite}
                      className="nawaf-secondary flex items-center justify-center gap-1.5 text-xs sm:text-sm"
                    >
                      <Copy className="w-4 h-4 text-[#60a5fa]" />
                      <span>نسخ رسالة + رابط</span>
                    </button>
                  </div>

                  {copyFeedback && (
                    <div className="text-center text-xs font-extrabold text-emerald-400">
                      {copyFeedback}
                    </div>
                  )}

                  {isHost ? (
                    <button
                      type="button"
                      disabled={onlineRoom.players.length < onlineRoom.playerCount}
                      onClick={() => sendWs({ type: 'start_match' })}
                      className="nawaf-primary disabled:opacity-45"
                    >
                      {onlineRoom.players.length < onlineRoom.playerCount
                        ? `بانتظار انضمام اللاعبين (${onlineRoom.players.length}/${onlineRoom.playerCount})...`
                        : `ابدأ مباراة الكيرم 🚀`}
                    </button>
                  ) : (
                    <div className="rounded-xl border border-white/15 bg-black/30 py-3 text-center text-xs font-extrabold text-white/80">
                      {onlineRoom.players.length < onlineRoom.playerCount
                        ? 'بانتظار اكتمال اللاعبين...'
                        : 'الغرفة جاهزة — بانتظار بدء صاحب الغرفة...'}
                    </div>
                  )}

                  <button
                    type="button"
                    onClick={() => sendWs({ type: 'leave_room' })}
                    className="nawaf-secondary flex items-center justify-center gap-1.5 text-xs text-white/80"
                  >
                    <LogOut className="w-3.5 h-3.5" />
                    <span>مغادرة الغرفة</span>
                  </button>
                </>
              )}

              {onlineError && (
                <div className="rounded-xl border border-rose-500/40 bg-rose-950/60 px-3 py-2 text-center text-xs font-extrabold text-rose-200">
                  {onlineError}
                </div>
              )}
            </div>
          )}

          {/* Authentic Carrom Rules Summary */}
          <div className="rounded-2xl border border-white/15 bg-[#12060a]/80 p-3.5 text-xs text-white/80 leading-relaxed space-y-1">
            <div className="font-black text-amber-200 mb-1">قواعد الكيرم الأصلية:</div>
            <div>• لكل لاعب 9 أقراص (الأبيض لك، والأسود لبوت نواف أو الخصم).</div>
            <div>• عند إدخال الملكة الحمراء (+3 نقاط)، يجب تغطيتها بإدخال قرص من لونك في نفس الضربة أو الضربة التالية مباشرة.</div>
            <div>• سقوط قرص التسديد في الجيب يُحتسب فاول ويُعيد أحد أقراصك للمركز.</div>
          </div>

        </section>
      </main>

    </div>
  );
}
