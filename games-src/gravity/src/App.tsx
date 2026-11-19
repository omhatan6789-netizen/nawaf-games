import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Code2,
  Copy,
  FolderArchive,
  LogOut,
  RotateCcw,
  Share2,
  Users,
  Volume2,
  VolumeX,
} from 'lucide-react';
import { CharacterPreviewSvg } from './components/CharacterPreviewSvg';
import {
  downloadZipFromEndpoint,
  GitHubExportModal,
} from './components/GitHubExportModal';
import {
  BIOMES,
  LOGICAL_H,
  PLAYER_PALETTE,
  WORLD_W,
} from './game/gravityBiomes';
import type { PlayerColorId } from './game/gravityBiomes';
import {
  DifficultyLevel,
  GravityDuelEngine,
  GravityHudState,
  GravityMatchConfig,
  GravityMatchResult,
  GravityMode,
  OnlineGameSnapshot,
} from './game/gravityEngine';
import { gravitySound } from './game/gravitySound';

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
  colorId: PlayerColorId;
  colorLabel: string;
  mainColor: string;
  emoji: string;
  score: number;
  connected: boolean;
  withdrawn: boolean;
}

interface OnlineRoomState {
  id: string;
  hostId: string;
  status: 'lobby' | 'playing' | 'finished';
  targetScore: number;
  minPlayers: number;
  maxPlayers: number;
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
  if (startParam.startsWith('gravity_')) {
    return startParam.slice(8).trim().toUpperCase();
  }
  if (startParam.startsWith('online_lobby_')) {
    return startParam.slice(13).trim().toUpperCase();
  }
  return '';
}

function getStableClientId(): string {
  const tgId = window.Telegram?.WebApp?.initDataUnsafe?.user?.id;
  if (tgId) return `tg_${tgId}`;
  const key = 'gravity_client_id';
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

  const [screen, setScreen] = useState<'setup' | 'playing'>('setup');
  const [mode, setMode] = useState<GravityMode>(() =>
    initialRoomCode ? 'online' : 'bot'
  );
  const [difficulty, setDifficulty] = useState<DifficultyLevel>('سهل');
  const [targetScore, setTargetScore] = useState<number>(3);
  const [playerName, setPlayerName] = useState<string>(
    () => getTelegramPlayerName() || 'اللاعب الأول'
  );
  const [localBlueName, setLocalBlueName] = useState<string>('اللاعب الثاني');
  const [muted, setMuted] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);

  // Online multiplayer state
  const [wsConnected, setWsConnected] = useState(false);
  const [onlineRoom, setOnlineRoom] = useState<OnlineRoomState | null>(null);
  const [myOnlineId, setMyOnlineId] = useState<string>(clientId);
  const [amISpectator, setAmISpectator] = useState(false);
  const [joinCodeInput, setJoinCodeInput] = useState<string>(initialRoomCode);
  const [onlineError, setOnlineError] = useState<string | null>(null);
  const [copyFeedback, setCopyFeedback] = useState<string | null>(null);

  const [hud, setHud] = useState<GravityHudState>({
    redScore: 0,
    blueScore: 0,
    targetScore: 3,
    roundNumber: 1,
    biomeName: BIOMES[0].name,
    elapsedSeconds: 0,
    countdownBadge: 'الجولة 1',
    players: [],
    spectating: false,
  });
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const [matchResult, setMatchResult] = useState<GravityMatchResult | null>(null);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const engineRef = useRef<GravityDuelEngine | null>(null);
  const toastTimerRef = useRef<number | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const latestSnapshotRef = useRef<OnlineGameSnapshot | null>(null);
  const autoJoinedInitialRef = useRef(false);

  useEffect(() => {
    window.Telegram?.WebApp?.ready?.();
    window.Telegram?.WebApp?.expand?.();
  }, []);

  const showToast = useCallback((msg: string) => {
    setToastMsg(msg);
    if (toastTimerRef.current) {
      window.clearTimeout(toastTimerRef.current);
    }
    toastTimerRef.current = window.setTimeout(() => {
      setToastMsg(null);
    }, 1700);
  }, []);

  const sendWs = useCallback((payload: Record<string, unknown>) => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return false;
    ws.send(JSON.stringify(payload));
    return true;
  }, []);

  // Connect WebSocket when in online mode (or when returning to online room)
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
    const wsUrl = `${proto}//${window.location.host}/ws/gravity`;
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
      } else if (type === 'game_snapshot') {
        const snap = data as unknown as OnlineGameSnapshot;
        latestSnapshotRef.current = snap;
        engineRef.current?.applyOnlineSnapshot(snap);
      } else if (type === 'sfx') {
        if (data.kind === 'flip') {
          gravitySound.playFlip(Boolean(data.left));
        }
      } else if (type === 'countdown') {
        gravitySound.playCountdownTick(Boolean(data.go));
      } else if (type === 'burst') {
        engineRef.current?.triggerBurst(
          Number(data.x) || WORLD_W / 2,
          Number(data.y) || LOGICAL_H / 2,
          String(data.color || '#ef233c')
        );
      } else if (type === 'round_banner') {
        showToast(String(data.text || ''));
      } else if (type === 'match_end') {
        gravitySound.playVictory();
        const standings = Array.isArray(data.standings)
          ? (data.standings as Array<{
              id: string;
              name: string;
              colorId: PlayerColorId;
              mainColor: string;
              score: number;
            }>).map((s) => ({
              id: s.id,
              name: s.name,
              colorId: s.colorId,
              mainColor: s.mainColor,
              score: s.score,
              dead: false,
              withdrawn: false,
            }))
          : [];
        setMatchResult({
          winnerId: String(data.winnerId || ''),
          winnerColorId: (data.winnerColorId as PlayerColorId) || 'red',
          winnerName: String(data.winnerName || 'الفائز'),
          winnerIsBot: false,
          redScore: standings[0]?.score ?? 0,
          blueScore: standings[1]?.score ?? 0,
          roundsPlayed: Number(data.roundsPlayed) || 1,
          standings,
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

  // Mount / tear down gameplay canvas engine
  useEffect(() => {
    if (screen !== 'playing' || !canvasRef.current) return;

    const cleanRed = playerName.trim() || 'اللاعب الأول';
    const cleanBlue =
      mode === 'bot' ? 'البوت' : localBlueName.trim() || 'اللاعب الثاني';

    const config: GravityMatchConfig = {
      mode,
      difficulty,
      targetScore: mode === 'online' ? onlineRoom?.targetScore ?? targetScore : targetScore,
      redName: cleanRed,
      blueName: cleanBlue,
      localPlayerId: mode === 'online' ? myOnlineId : undefined,
      onOnlineFlip:
        mode === 'online'
          ? () => {
              sendWs({ type: 'flip' });
            }
          : undefined,
    };

    const engine = new GravityDuelEngine(canvasRef.current, config, {
      onHud: (next) => setHud(next),
      onRoundEndBanner: (msg) => showToast(msg),
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
    targetScore,
    playerName,
    localBlueName,
    myOnlineId,
    onlineRoom?.targetScore,
    sendWs,
    showToast,
  ]);

  const handleStartLocalOrBot = () => {
    gravitySound.unlock();
    setMatchResult(null);
    setToastMsg(null);
    setScreen('playing');
  };

  const handleRestart = () => {
    gravitySound.unlock();
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
    gravitySound.muted = next;
    setMuted(next);
  };

  const handleCreateOnlineRoom = () => {
    gravitySound.unlock();
    setOnlineError(null);
    sendWs({
      type: 'create_room',
      clientId,
      name: playerName.trim() || 'اللاعب الأول',
      targetScore,
    });
  };

  const handleJoinOnlineRoom = () => {
    gravitySound.unlock();
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
    const roomUrl = `${baseUrl}?room=${encodeURIComponent(room.id)}`;
    const hostName = room.players[0]?.name || playerName || 'لاعب';
    const inviteText =
      `🎮 غرفة أونلاين — تحدي الجاذبية ⚡\n\n` +
      `أنشأ ${hostName} غرفة تحدي الجاذبية (${room.minPlayers} - ${room.maxPlayers} لاعبين).\n` +
      `اللاعبون الحاليون: ${room.players.length}/${room.maxPlayers}\n` +
      `افتحوا الغرفة من الزر بالأسفل للانضمام وبدء التحدي!\n` +
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
      navigator.share({ title: 'تحدي الجاذبية — غرفة أونلاين', text: inviteText, url: roomUrl }).catch(() => {
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
  const isSpectatingNow =
    mode === 'online' && (amISpectator || hud.spectating);

  // Full-height Portrait Gameplay Screen
  if (screen === 'playing') {
    const showCompactMultiHud = mode === 'online' && hud.players.length > 2;

    return (
      <div className="h-[100dvh] w-full flex items-center justify-center bg-[#0d0508] overflow-hidden select-none">
        <div className="relative h-full w-full max-w-[460px] flex flex-col overflow-hidden sm:rounded-[26px] sm:h-[calc(100dvh-20px)] sm:border-2 sm:border-white/20 shadow-2xl">
          <canvas
            ref={canvasRef}
            width={WORLD_W}
            height={LOGICAL_H}
            onPointerDown={(e) => {
              e.preventDefault();
              if (mode === 'online') {
                if (!isSpectatingNow) {
                  engineRef.current?.flipMyOnlinePlayer();
                }
              } else if (mode === 'bot') {
                engineRef.current?.flipPlayer('red');
              } else {
                const rect = e.currentTarget.getBoundingClientRect();
                const relX = e.clientX - rect.left;
                engineRef.current?.flipPlayer(relX < rect.width / 2 ? 'red' : 'blue');
              }
            }}
            className={`block w-full h-full object-fill touch-none ${
              isSpectatingNow ? 'cursor-default' : 'cursor-pointer'
            }`}
          />

          {/* Top Score Pill / Multi-player Score Strip */}
          {!showCompactMultiHud ? (
            <div className="absolute top-3 left-3 pointer-events-none rounded-full bg-white px-4 py-1.5 shadow-lg flex items-center gap-2 font-black text-lg tabular-nums">
              <span className="text-[#ef233c]">{hud.redScore}</span>
              <span className="text-slate-400">•</span>
              <span className="text-[#0ea5e9]">{hud.blueScore}</span>
            </div>
          ) : (
            <div className="absolute top-12 inset-x-3 pointer-events-none flex flex-wrap items-center justify-center gap-1.5">
              {hud.players.map((pl) => (
                <div
                  key={pl.id}
                  className={`rounded-full px-2.5 py-0.5 text-[11px] font-black shadow flex items-center gap-1.5 border border-white/30 transition-opacity ${
                    pl.dead ? 'opacity-45 bg-black/70 text-white/75' : 'bg-black/75 text-white'
                  }`}
                >
                  <span
                    className="w-2.5 h-2.5 rounded-full shrink-0"
                    style={{ backgroundColor: pl.mainColor }}
                  />
                  <span className="max-w-[70px] truncate">{pl.name}</span>
                  <span className="tabular-nums text-[#facc15]">{pl.score}</span>
                </div>
              ))}
            </div>
          )}

          {/* Top-center Round, Timer & Biome Pill */}
          <div className="absolute top-3 left-1/2 -translate-x-1/2 pointer-events-none rounded-full bg-black/55 border border-white/20 px-3.5 py-1 text-xs font-extrabold text-white whitespace-nowrap tabular-nums">
            جولة {hud.roundNumber} · {hud.elapsedSeconds}ث · {hud.biomeName}
          </div>

          {/* Top-right Controls: Sound + EXIT Pill */}
          <div className="absolute top-3 right-3 flex items-center gap-1.5">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                toggleMute();
              }}
              className="rounded-full bg-white/90 text-slate-900 w-8 h-8 flex items-center justify-center shadow-lg cursor-pointer"
              aria-label={muted ? 'تشغيل الصوت' : 'كتم الصوت'}
            >
              {muted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
            </button>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                handleExitGameplay();
              }}
              className="rounded-full bg-white text-slate-900 px-3.5 py-1.5 text-xs font-black shadow-lg cursor-pointer hover:bg-slate-100"
            >
              خروج
            </button>
          </div>

          {/* Bottom Control Hint or Spectator Mode Bar */}
          {mode === 'online' ? (
            isSpectatingNow ? (
              <div className="absolute bottom-3 inset-x-3 flex items-center justify-between gap-2 rounded-2xl bg-black/80 border border-white/25 px-3.5 py-2 shadow-xl">
                <span className="text-xs font-extrabold text-white/90">
                  👀 وضع المشاهدة — تشاهد بقية اللاعبين بدون تحكم
                </span>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleExitGameplay();
                  }}
                  className="rounded-full bg-[#ef233c] text-white px-3 py-1 text-xs font-black shrink-0 cursor-pointer"
                >
                  خروج
                </button>
              </div>
            ) : (
              <div className="absolute bottom-3 left-1/2 -translate-x-1/2 pointer-events-none rounded-full bg-black/55 border border-white/15 px-4 py-1.5 text-xs font-bold text-white/90 whitespace-nowrap">
                اضغط في أي مكان لتحريك شخصيتك
              </div>
            )
          ) : mode === 'bot' ? (
            <div className="absolute bottom-3 left-1/2 -translate-x-1/2 pointer-events-none rounded-full bg-black/55 border border-white/15 px-4 py-1.5 text-xs font-bold text-white/90 whitespace-nowrap">
              اضغط في أي مكان لقلب الجاذبية يمين ↔ يسار
            </div>
          ) : (
            <div
              className="absolute bottom-3 inset-x-3 flex items-center justify-between gap-2 pointer-events-none"
              dir="ltr"
            >
              <div className="rounded-full bg-[#ef233c]/90 border border-white/30 px-3.5 py-1.5 text-xs font-black text-white shadow">
                🔴 {playerName.trim() || 'اللاعب الأول'}
              </div>
              <div className="rounded-full bg-[#0ea5e9]/90 border border-white/30 px-3.5 py-1.5 text-xs font-black text-white shadow">
                🔵 {localBlueName.trim() || 'اللاعب الثاني'}
              </div>
            </div>
          )}

          {toastMsg && <div className="nawaf-toast">{toastMsg}</div>}
        </div>

        {/* Exact nawaf-bot-v2 Win / Loss Overlay */}
        {matchResult && (
          <div className="online-end-overlay" role="dialog" aria-modal="true">
            <div className="online-end-card">
              <h2>{matchResult.winnerIsBot ? '💀 انتهى التحدي!' : '🎉 مبروك الفوز!'}</h2>
              <div
                className={`online-end-winner ${
                  matchResult.winnerColorId === 'blue' ? 'is-blue' : ''
                }`}
              >
                {matchResult.winnerIsBot ? 'فاز البوت' : matchResult.winnerName}
              </div>
              <p className="tabular-nums">
                {matchResult.winnerIsBot
                  ? `فاز البوت بنتيجة ${matchResult.blueScore} - ${matchResult.redScore} بعد ${matchResult.roundsPlayed} جولات! حاول مرة ثانية 💪`
                  : matchResult.standings && matchResult.standings.length > 0
                    ? `أبدعت يا ${matchResult.winnerName}! أنهيت التحدي في ${matchResult.roundsPlayed} جولات 🏆`
                    : `أبدعت يا ${matchResult.winnerName}! النتيجة النهائية ${matchResult.redScore} - ${matchResult.blueScore} في ${matchResult.roundsPlayed} جولات 🏆`}
              </p>

              {matchResult.standings && matchResult.standings.length > 0 && (
                <div className="mb-4 flex flex-col gap-1.5 rounded-2xl border border-white/15 bg-black/35 p-3 text-right">
                  {matchResult.standings
                    .slice()
                    .sort((a, b) => b.score - a.score)
                    .map((st, idx) => (
                      <div
                        key={st.id}
                        className="flex items-center justify-between text-xs font-extrabold text-white/90"
                      >
                        <div className="flex items-center gap-2">
                          <span className="text-white/50">#{idx + 1}</span>
                          <span
                            className="w-2.5 h-2.5 rounded-full"
                            style={{ backgroundColor: st.mainColor }}
                          />
                          <span>{st.name}</span>
                        </div>
                        <span className="tabular-nums text-[#facc15]">{st.score} نقاط</span>
                      </div>
                    ))}
                </div>
              )}

              <div className="online-end-actions">
                {mode !== 'online' || isHost ? (
                  <button type="button" onClick={handleRestart}>
                    ↻ العب مرة ثانية
                  </button>
                ) : (
                  <button type="button" disabled>
                    بانتظار صاحب الغرفة لإعادة اللعب...
                  </button>
                )}
                <button type="button" className="secondary-end" onClick={handleExitGameplay}>
                  خروج للقائمة الرئيسية
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  // Setup & Online Lobby Screen
  const lobbyPlayers = onlineRoom?.players ?? [];
  const previewPalette =
    mode === 'online' && lobbyPlayers.length >= 2
      ? lobbyPlayers.map((lp, idx) => ({
          label: lp.name,
          spec: PLAYER_PALETTE[idx] ?? PLAYER_PALETTE[0],
        }))
      : [
          { label: playerName.trim() || 'اللاعب 1', spec: PLAYER_PALETTE[0] },
          {
            label: mode === 'bot' ? 'البوت' : localBlueName.trim() || 'اللاعب 2',
            spec: PLAYER_PALETTE[1],
          },
        ];

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
              تحدي الجاذبية
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
            {mode !== 'online' && (
              <button
                type="button"
                onClick={handleStartLocalOrBot}
                className="nawaf-pill flex items-center gap-1.5 whitespace-nowrap shrink-0"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>ابدأ</span>
              </button>
            )}
          </div>
        </header>

        <section className="nawaf-panel p-4 sm:p-6 flex flex-col gap-5">
          {/* Dynamic Character Showcase (only shows active player count colors) */}
          <div className="text-center">
            <div className="mx-auto mb-3 px-4 py-3 w-fit max-w-full rounded-2xl border border-white/20 bg-[#5cb5f9]/15 flex flex-wrap items-center justify-center gap-3 shadow-lg">
              {previewPalette.map((entry, idx) => (
                <div key={entry.spec.id} className="flex flex-col items-center gap-1">
                  <CharacterPreviewSvg
                    mainColor={entry.spec.main}
                    darkColor={entry.spec.dark}
                    facing={idx % 2 === 0 ? 'right' : 'left'}
                    className="w-10 h-11"
                    label={entry.label}
                  />
                  <span className="text-[10px] font-extrabold text-white/80 max-w-[68px] truncate">
                    {entry.label}
                  </span>
                </div>
              ))}
            </div>

            <h1 className="text-[24px] sm:text-[26px] font-black text-white m-0">
              تحدي الجاذبية — يمين ويسار
            </h1>
            <p className="text-sm text-white/75 m-0 mt-1.5">
              العب ضد البوت أو أونلاين مع 2 إلى 5 لاعبين من أجهزتهم بنفس الشاشة!
            </p>
          </div>

          {/* Player Telegram Name */}
          <div className="grid grid-cols-1 gap-3">
            <div>
              <label
                htmlFor="player-tg-name"
                className="block text-xs font-bold text-white/75 mb-1.5"
              >
                اسمك في اللعبة (اسم تيليجرام)
              </label>
              <input
                id="player-tg-name"
                type="text"
                maxLength={24}
                value={playerName}
                onChange={(e) => setPlayerName(e.target.value)}
                placeholder="اكتب اسمك..."
                className="w-full rounded-xl border border-white/25 bg-[#12070a] px-3.5 py-2.5 text-sm font-bold text-white outline-none focus:border-[#ff9ba3]"
              />
            </div>

            {mode === 'local' && (
              <div>
                <label
                  htmlFor="local-p2-name"
                  className="block text-xs font-bold text-white/75 mb-1.5"
                >
                  اسم اللاعب الثاني (نفس الجهاز)
                </label>
                <input
                  id="local-p2-name"
                  type="text"
                  maxLength={24}
                  value={localBlueName}
                  onChange={(e) => setLocalBlueName(e.target.value)}
                  placeholder="اكتب اسم اللاعب الثاني..."
                  className="w-full rounded-xl border border-white/25 bg-[#12070a] px-3.5 py-2.5 text-sm font-bold text-white outline-none focus:border-[#60a5fa]"
                />
              </div>
            )}
          </div>

          {/* Mode Selection */}
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
                🤖 ضد البوت
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
                🌐 أونلاين (2-5)
              </button>
            </div>
          </div>

          {/* Bot Difficulty (ONLY سهل / متوسط / صعب — NO seconds sub-labels!) */}
          {mode === 'bot' && (
            <div>
              <div className="text-xs font-bold text-white/75 mb-2">مستوى الصعوبة</div>
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

          {/* Target Score */}
          {(!onlineRoom || isHost) && (
            <div>
              <div className="text-xs font-bold text-white/75 mb-2">نقاط الفوز</div>
              <div className="grid grid-cols-2 gap-2.5">
                {[3, 5].map((pts) => (
                  <button
                    key={pts}
                    type="button"
                    onClick={() => {
                      setTargetScore(pts);
                      if (onlineRoom && isHost) {
                        sendWs({ type: 'update_settings', targetScore: pts });
                      }
                    }}
                    className={`nawaf-choice py-2.5 px-3 text-sm tabular-nums ${
                      (onlineRoom ? onlineRoom.targetScore : targetScore) === pts
                        ? 'active'
                        : ''
                    }`}
                  >
                    الأول يوصل {pts} نقاط
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Online Lobby / Create or Join Panel */}
          {mode === 'online' && (
            <div className="rounded-2xl border border-white/20 bg-[#14070b]/90 p-4 flex flex-col gap-3.5">
              {!onlineRoom ? (
                <>
                  <div className="flex items-center justify-between text-xs font-bold text-white/75">
                    <span className="flex items-center gap-1.5">
                      <Users className="w-4 h-4 text-[#ff9ba3]" />
                      غرفة أونلاين (من 2 إلى 5 لاعبين)
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

                  <div className="flex items-center gap-2 pt-1">
                    <input
                      type="text"
                      maxLength={8}
                      value={joinCodeInput}
                      onChange={(e) => setJoinCodeInput(e.target.value.toUpperCase())}
                      placeholder="رمز الغرفة (مثال: A7K9P2)"
                      className="min-w-0 flex-1 rounded-xl border border-white/25 bg-[#0e0508] px-3 py-2.5 text-sm font-black tracking-wider text-white text-center uppercase outline-none focus:border-[#ff9ba3]"
                    />
                    <button
                      type="button"
                      disabled={!wsConnected}
                      onClick={handleJoinOnlineRoom}
                      className="nawaf-choice px-4 py-2.5 text-sm font-black shrink-0 disabled:opacity-50"
                    >
                      دخول الغرفة
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <div className="text-sm font-black text-white">
                        غرفة تحدي الجاذبية ⚡
                      </div>
                      <div className="text-[11px] font-bold text-white/60">
                        رمز الغرفة:{' '}
                        <span className="text-[#facc15] tracking-widest font-black">
                          {onlineRoom.id}
                        </span>
                      </div>
                    </div>
                    <div className="rounded-full bg-white/10 border border-white/20 px-3 py-1 text-xs font-black tabular-nums">
                      اللاعبون ({onlineRoom.players.length}/5)
                    </div>
                  </div>

                  {/* Joined Players List (strictly shows joined players + assigned colors) */}
                  <div className="flex flex-col gap-2">
                    {onlineRoom.players.map((p, idx) => (
                      <div
                        key={p.id}
                        className="flex items-center justify-between rounded-xl border border-white/15 bg-black/35 px-3 py-2"
                      >
                        <div className="flex items-center gap-2.5">
                          <span
                            className="w-3.5 h-3.5 rounded-full border border-white/50 shrink-0"
                            style={{ backgroundColor: p.mainColor }}
                          />
                          <span className="text-sm font-black text-white">
                            {p.name}
                          </span>
                          {p.id === myOnlineId && (
                            <span className="rounded-md bg-white/15 px-1.5 py-0.5 text-[10px] font-bold text-[#facc15]">
                              أنت
                            </span>
                          )}
                          {idx === 0 && (
                            <span className="rounded-md bg-[#ed4054]/25 px-1.5 py-0.5 text-[10px] font-bold text-[#ff9ba3]">
                              صاحب الغرفة
                            </span>
                          )}
                        </div>
                        <span className="text-xs font-bold text-white/65">
                          {p.colorLabel}
                        </span>
                      </div>
                    ))}
                  </div>

                  {/* Telegram Invite Preview matching nawaf-bot-v2 message + button */}
                  <div className="rounded-xl border border-[#ffffff24] bg-[#0c0508] p-3 text-right text-xs leading-relaxed text-white/85">
                    <div className="font-black text-white mb-1">
                      🎮 رسالة الدعوة للغرفة (تيليجرام):
                    </div>
                    <div className="text-white/75">
                      أنشأ <b>{onlineRoom.players[0]?.name}</b> غرفة تحدي الجاذبية (2 - 5
                      لاعبين). افتحوا الغرفة من الزر بالأسفل للانضمام!
                    </div>
                    <div className="mt-2 rounded-lg border border-white/25 bg-[#1b0c11] py-1.5 text-center font-black text-[#ff9ba3]">
                      فتح غرفة اللعبة ↗
                    </div>
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
                      disabled={onlineRoom.players.length < 2}
                      onClick={() => sendWs({ type: 'start_match' })}
                      className="nawaf-primary disabled:opacity-45"
                    >
                      {onlineRoom.players.length < 2
                        ? 'بانتظار انضمام لاعب آخر (الحد الأدنى 2)...'
                        : `ابدأ التحدي الآن (${onlineRoom.players.length} لاعبين) 🚀`}
                    </button>
                  ) : (
                    <div className="rounded-xl border border-white/15 bg-black/30 py-3 text-center text-xs font-extrabold text-white/80">
                      {onlineRoom.players.length < 2
                        ? 'بانتظار انضمام لاعبين...'
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

          {/* Biomes strip */}
          <div className="rounded-2xl border border-white/15 bg-[#12060a]/80 p-3">
            <div className="text-xs font-bold text-white/75 mb-2">
              المراحل المتغيرة في كل جولة:
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-center">
              {BIOMES.map((b, i) => (
                <div
                  key={b.id}
                  className="rounded-xl border border-white/15 px-2 py-2 flex flex-col items-center gap-1"
                  style={{ backgroundColor: `${b.skyTop}22` }}
                >
                  <span
                    className="w-4 h-4 rounded-full border border-white/50"
                    style={{ backgroundColor: b.skyTop }}
                  />
                  <span className="text-[11px] font-black text-white">
                    {i + 1}. {b.name}
                  </span>
                </div>
              ))}
            </div>
          </div>

          <div className="flex flex-col gap-2.5">
            {mode !== 'online' && (
              <button
                type="button"
                onClick={handleStartLocalOrBot}
                className="nawaf-primary"
              >
                ابدأ اللعب
              </button>
            )}
            <button
              type="button"
              onClick={() => setExportOpen(true)}
              className="nawaf-secondary flex items-center justify-center gap-2"
            >
              <Code2 className="w-4 h-4 text-[#ff9ba3]" />
              <span>كود الإضافة لمشروعك في GitHub (nawaf-bot-v2)</span>
            </button>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => {
                  downloadZipFromEndpoint(
                    '/${game}/api/export/project.zip',
                    'gravity-game-project.zip'
                  ).catch(() => showToast('تعذر تحميل ملف ZIP'));
                }}
                className="nawaf-secondary flex items-center justify-center gap-2 text-xs sm:text-sm"
              >
                <FolderArchive className="w-4 h-4 text-[#facc15]" />
                <span>تحميل المشروع كامل (ZIP)</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  downloadZipFromEndpoint(
                    '/${game}/api/export/nawaf-addon.zip',
                    'nawaf-bot-v2-gravity-addon.zip'
                  ).catch(() => showToast('تعذر تحميل ملف ZIP'));
                }}
                className="nawaf-secondary flex items-center justify-center gap-2 text-xs sm:text-sm"
              >
                <FolderArchive className="w-4 h-4 text-[#60a5fa]" />
                <span>تحميل إضافة البوت (ZIP)</span>
              </button>
            </div>
          </div>
        </section>
      </main>

      <GitHubExportModal open={exportOpen} onClose={() => setExportOpen(false)} />
    </div>
  );
}
