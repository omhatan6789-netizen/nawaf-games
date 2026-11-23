import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowRight,
  Bomb,
  Download,
  LogOut,
  Play,
  Shuffle,
  Sparkles,
  Timer,
} from 'lucide-react';
import {
  BOMB_COUNT,
  DIFFICULTY_META,
  GRID_SIZE,
  MAX_HEARTS,
  PREP_DURATION_SEC,
  REVEAL_DURATION_SEC,
  TURN_DURATION_SEC,
  type Difficulty,
  type GameMode,
  type GamePhase,
  type LobbyPlayerInfo,
  type PotatoSettings,
  type Screen,
  type TrayCell,
  type TurnOwner,
} from './types/game';
import { soundEngine } from './utils/sound';
import { TopHud } from './components/TopHud';
import { TrayGrid } from './components/TrayGrid';
import { EndMatchOverlay } from './components/EndMatchOverlay';
import { PotatoChipSvg, HiddenBombBadge } from './components/PotatoChipSvg';

const SETTINGS_STORAGE_KEY = 'nawaf_potato_settings_v1';

const DIFFICULTIES: Difficulty[] = ['easy', 'medium', 'hard'];

const WIN_LINES = [
  [0, 1, 2],
  [3, 4, 5],
  [6, 7, 8],
  [0, 3, 6],
  [1, 4, 7],
  [2, 5, 8],
  [0, 4, 8],
  [2, 4, 6],
];

const DEFAULT_SETTINGS: PotatoSettings = {
  difficulty: 'medium',
  soundEnabled: true,
  haptics: true,
};

function loadSavedSettings(): PotatoSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_STORAGE_KEY);
    if (!raw) return DEFAULT_SETTINGS;
    const parsed = JSON.parse(raw) as Partial<PotatoSettings>;
    return {
      difficulty:
        parsed.difficulty === 'easy' ||
        parsed.difficulty === 'medium' ||
        parsed.difficulty === 'hard'
          ? parsed.difficulty
          : 'medium',
      soundEnabled: parsed.soundEnabled !== false,
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
              user?: {
                first_name?: string;
                last_name?: string;
                username?: string;
              };
            };
          };
        };
      }
    ).Telegram?.WebApp?.initDataUnsafe?.user;
    if (tgUser) {
      const fullName = [tgUser.first_name, tgUser.last_name]
        .filter(Boolean)
        .join(' ')
        .trim();
      if (fullName) return fullName;
      if (tgUser.username) return tgUser.username;
    }
  } catch {
    // Ignore outside Telegram
  }
  return 'أنت';
}

function getInitialRoomIdFromUrl(): string {
  try {
    const startParam =
      (
        window as unknown as {
          Telegram?: {
            WebApp?: { initDataUnsafe?: { start_param?: string } };
          };
        }
      ).Telegram?.WebApp?.initDataUnsafe?.start_param || '';

    if (startParam.startsWith('potato_')) {
      return startParam.slice(7).trim();
    }
  } catch {
    // Ignore URL errors
  }
  return '';
}
function getStableClientId(): string {
  try {
    const tgId = (
      window as unknown as {
        Telegram?: {
          WebApp?: { initDataUnsafe?: { user?: { id?: number } } };
        };
      }
    ).Telegram?.WebApp?.initDataUnsafe?.user?.id;
    if (tgId) return `tg_${tgId}`;
  } catch {
    // Ignore
  }
  const key = 'potato_client_id_v1';
  let existing = sessionStorage.getItem(key);
  if (!existing) {
    existing = 'web_' + Math.random().toString(36).slice(2, 10);
    sessionStorage.setItem(key, existing);
  }
  return existing;
}

function triggerHaptic(enabled: boolean, kind: 'light' | 'heavy' = 'light') {
  if (!enabled) return;
  try {
    const tgHaptic = (
      window as unknown as {
        Telegram?: {
          WebApp?: {
            HapticFeedback?: {
              impactOccurred?: (style: 'light' | 'medium' | 'heavy') => void;
            };
          };
        };
      }
    ).Telegram?.WebApp?.HapticFeedback;
    if (tgHaptic?.impactOccurred) {
      tgHaptic.impactOccurred(kind === 'heavy' ? 'heavy' : 'light');
      return;
    }
    if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
      navigator.vibrate(kind === 'heavy' ? [35, 25, 45] : 16);
    }
  } catch {
    // Ignore unsupported devices
  }
}

function createEmptyTray(): TrayCell[] {
  return Array.from({ length: GRID_SIZE }, (_, index) => ({
    index,
    hasBomb: false,
    status: 'CHIP',
  }));
}

function generateRandomBombIndices(
  count: number,
  existingIndices: number[] = []
): number[] {
  const chosen = new Set<number>(existingIndices);
  const available = Array.from({ length: GRID_SIZE }, (_, i) => i).filter(
    (i) => !chosen.has(i)
  );
  while (chosen.size < count && available.length > 0) {
    const randIdx = Math.floor(Math.random() * available.length);
    chosen.add(available[randIdx]);
    available.splice(randIdx, 1);
  }
  return Array.from(chosen);
}

function isThreeInALine(indices: number[]): boolean {
  const set = new Set(indices);
  return WIN_LINES.some((line) => line.every((idx) => set.has(idx)));
}

function generateBotBombIndices(difficulty: Difficulty): number[] {
  if (difficulty === 'easy') {
    return generateRandomBombIndices(BOMB_COUNT);
  }

  for (let attempt = 0; attempt < 25; attempt++) {
    const candidate = generateRandomBombIndices(BOMB_COUNT);
    if (isThreeInALine(candidate)) continue;
    if (difficulty === 'hard') {
      const hasCorner = candidate.some((i) => [0, 2, 6, 8].includes(i));
      const hasEdgeOrCenter = candidate.some((i) => [1, 3, 4, 5, 7].includes(i));
      if (!hasCorner || !hasEdgeOrCenter) continue;
    }
    return candidate;
  }

  return generateRandomBombIndices(BOMB_COUNT);
}

function pickBotTargetIndex(
  playerCells: TrayCell[],
  difficulty: Difficulty
): number | null {
  const available = playerCells.filter((c) => c.status === 'CHIP');
  if (available.length === 0) return null;

  const safeCells = available.filter((c) => !c.hasBomb);
  const bombCells = available.filter((c) => c.hasBomb);

  if (difficulty === 'easy') {
    if (bombCells.length > 0 && Math.random() < 0.55) {
      return bombCells[Math.floor(Math.random() * bombCells.length)].index;
    }
    return available[Math.floor(Math.random() * available.length)].index;
  }

  if (difficulty === 'hard') {
    if (safeCells.length > 0 && Math.random() < 0.72) {
      return safeCells[Math.floor(Math.random() * safeCells.length)].index;
    }
    return available[Math.floor(Math.random() * available.length)].index;
  }

  return available[Math.floor(Math.random() * available.length)].index;
}

function createTrayWithBombs(bombIndices: number[]): TrayCell[] {
  const bombSet = new Set(bombIndices);
  return Array.from({ length: GRID_SIZE }, (_, index) => ({
    index,
    hasBomb: bombSet.has(index),
    status: 'CHIP',
  }));
}

export default function App() {
  const initialRoomId = useMemo(() => getInitialRoomIdFromUrl(), []);
  const clientId = useMemo(() => getStableClientId(), []);

  const [screen, setScreen] = useState<Screen>(() =>
    initialRoomId ? 'online_lobby' : 'home'
  );
  const [mode, setMode] = useState<GameMode>(() =>
    initialRoomId ? 'online' : 'bot'
  );
  const [settings, setSettings] = useState<PotatoSettings>(loadSavedSettings);
  const [playerName, setPlayerName] = useState<string>(getTelegramPlayerName);
  const [downloadingZip, setDownloadingZip] = useState<boolean>(false);
  const [toast, setToast] = useState<string | null>(null);

  // Shared gameplay state
  const [phase, setPhase] = useState<GamePhase>('PREP');
  const [playerCells, setPlayerCells] = useState<TrayCell[]>(() =>
    createEmptyTray()
  );
  const [opponentCells, setOpponentCells] = useState<TrayCell[]>(() =>
    createEmptyTray()
  );

  const [playerHearts, setPlayerHearts] = useState<number>(MAX_HEARTS);
  const [opponentHearts, setOpponentHearts] = useState<number>(MAX_HEARTS);

  const [prepTimer, setPrepTimer] = useState<number>(PREP_DURATION_SEC);
  const [countdownValue, setCountdownValue] = useState<number>(3);
  const [turnOwner, setTurnOwner] = useState<TurnOwner>('PLAYER');
  const [turnTimer, setTurnTimer] = useState<number>(TURN_DURATION_SEC);
  const [revealTimer, setRevealTimer] = useState<number>(REVEAL_DURATION_SEC);

  const [isResolvingPick, setIsResolvingPick] = useState<boolean>(false);
  const [shakingTray, setShakingTray] = useState<'blue' | 'red' | null>(null);
  const [withdrawnByMe, setWithdrawnByMe] = useState<boolean>(false);
  const [withdrawnByOpponent, setWithdrawnByOpponent] =
    useState<boolean>(false);

  // Online multiplayer state
  const wsRef = useRef<WebSocket | null>(null);
  const [lobbyPlayers, setLobbyPlayers] = useState<LobbyPlayerInfo[]>([]);
  const [mySlot, setMySlot] = useState<0 | 1>(0);
  const [opponentName, setOpponentName] = useState<string>('الخصم');
  const [myOnlineReady, setMyOnlineReady] = useState<boolean>(false);
  const [onlineWinnerSlot, setOnlineWinnerSlot] = useState<0 | 1 | null>(null);
  const [rematchPending, setRematchPending] = useState<boolean>(false);

  const timeoutsRef = useRef<number[]>([]);
  const matchIdRef = useRef<number>(1);
  const toastTimerRef = useRef<number | null>(null);
  const prevOnlinePhaseRef = useRef<string>('');
  const prevCountdownRef = useRef<number>(0);
  const autoJoinedRef = useRef<boolean>(false);
  const mySlotRef = useRef<0 | 1>(0);
  const screenRef = useRef<Screen>(screen);
  screenRef.current = screen;

  const playerBombsCount = playerCells.filter((c) => c.hasBomb).length;

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    if (toastTimerRef.current) {
      window.clearTimeout(toastTimerRef.current);
    }
    toastTimerRef.current = window.setTimeout(() => {
      setToast(null);
    }, 2400);
  }, []);

  useEffect(() => {
    soundEngine.setMuted(!settings.soundEnabled);
  }, [settings.soundEnabled]);

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
            };
          };
        }
      ).Telegram?.WebApp;
      tg?.ready?.();
      tg?.expand?.();
      tg?.setHeaderColor?.('#35090d');
      tg?.setBackgroundColor?.('#100709');
      setPlayerName(getTelegramPlayerName());
    } catch {
      // Ignore outside Telegram
    }
  }, []);

  const updateSettings = useCallback((next: PotatoSettings) => {
    setSettings(next);
    soundEngine.setMuted(!next.soundEnabled);
    try {
      localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(next));
    } catch {
      // Ignore storage failures
    }
  }, []);

  const clearAllTimeouts = useCallback(() => {
    timeoutsRef.current.forEach((id) => window.clearTimeout(id));
    timeoutsRef.current = [];
  }, []);

  const scheduleTimeout = useCallback((fn: () => void, delayMs: number) => {
    const currentMatchId = matchIdRef.current;
    const id = window.setTimeout(() => {
      if (matchIdRef.current !== currentMatchId) return;
      fn();
    }, delayMs);
    timeoutsRef.current.push(id);
    return id;
  }, []);

  const closeWs = useCallback(() => {
    if (wsRef.current) {
      wsRef.current.onclose = null;
      wsRef.current.close();
      wsRef.current = null;
    }
    setLobbyPlayers([]);
    setMyOnlineReady(false);
    setRematchPending(false);
    setOnlineWinnerSlot(null);
    prevOnlinePhaseRef.current = '';
    prevCountdownRef.current = 0;
  }, []);

  useEffect(() => {
    return () => {
      clearAllTimeouts();
      closeWs();
      if (toastTimerRef.current) {
        window.clearTimeout(toastTimerRef.current);
      }
    };
  }, [clearAllTimeouts, closeWs]);

  const handleToggleMute = () => {
    updateSettings({ ...settings, soundEnabled: !settings.soundEnabled });
  };

  const resetLocalMatch = useCallback(() => {
    matchIdRef.current += 1;
    clearAllTimeouts();
    setPhase('PREP');
    setPlayerCells(createEmptyTray());
    setOpponentCells(createEmptyTray());
    setPlayerHearts(MAX_HEARTS);
    setOpponentHearts(MAX_HEARTS);
    setPrepTimer(PREP_DURATION_SEC);
    setCountdownValue(3);
    setTurnOwner('PLAYER');
    setTurnTimer(TURN_DURATION_SEC);
    setRevealTimer(REVEAL_DURATION_SEC);
    setIsResolvingPick(false);
    setShakingTray(null);
    setWithdrawnByMe(false);
    setWithdrawnByOpponent(false);
    setMyOnlineReady(false);
    setRematchPending(false);
    setOnlineWinnerSlot(null);
  }, [clearAllTimeouts]);

  const startBotMatch = useCallback(() => {
    closeWs();
    setMode('bot');
    setOpponentName('البوت');
    resetLocalMatch();
    setScreen('playing');
  }, [closeWs, resetLocalMatch]);

  const handleExitHome = useCallback(() => {
    if (mode === 'online' && wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'withdraw' }));
    }
    closeWs();
    resetLocalMatch();
    setScreen('home');
  }, [closeWs, mode, resetLocalMatch]);

  // Connect WebSocket for Online Multiplayer
  const connectOnlineWs = useCallback(
    (onOpenSend: (ws: WebSocket) => void) => {
      closeWs();
      const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const ws = new WebSocket(`${proto}//${window.location.host}/ws/potato`);
      wsRef.current = ws;

      ws.onopen = () => {
        onOpenSend(ws);
      };

      ws.onmessage = (ev) => {
        let data: Record<string, unknown>;
        try {
          data = JSON.parse(String(ev.data)) as Record<string, unknown>;
        } catch {
          return;
        }

        if (data.type === 'error') {
          showToast(String(data.message || 'حدث خطأ في الاتصال'));
          return;
        }

        if (data.type === 'pick_fx') {
          const fx = String(data.fx || '');
          const targetSlot = Number(data.targetSlot);
          const myCurrentSlot = mySlotRef.current;

          if (fx === 'crunch') {
            soundEngine.playCrunch();
            triggerHaptic(settings.haptics, 'light');
          } else if (fx === 'bomb_reveal') {
            soundEngine.playBombReveal();
          } else if (fx === 'explosion') {
            soundEngine.playExplosion();
            triggerHaptic(settings.haptics, 'heavy');
            setShakingTray(targetSlot === myCurrentSlot ? 'blue' : 'red');
            window.setTimeout(() => setShakingTray(null), 500);
          }
          return;
        }

        if (data.type === 'room_state') {
          const serverPhase = String(data.phase || 'LOBBY');
          const slot = (Number(data.mySlot) === 1 ? 1 : 0) as 0 | 1;
          mySlotRef.current = slot;
          setMySlot(slot);
          if (Array.isArray(data.players)) {
            setLobbyPlayers(data.players as LobbyPlayerInfo[]);
          }

          const oppName = String(data.opponentName || '').trim() || 'الخصم';
          setOpponentName(oppName);

          if (serverPhase === 'LOBBY') {
            setScreen('online_lobby');
            prevOnlinePhaseRef.current = 'LOBBY';
            return;
          }

          setMode('online');
          setScreen('playing');

          if (Array.isArray(data.myCells)) {
            setPlayerCells(data.myCells as TrayCell[]);
          }
          if (Array.isArray(data.opponentCells)) {
            setOpponentCells(data.opponentCells as TrayCell[]);
          }

          setPlayerHearts(Number(data.myHearts ?? MAX_HEARTS));
          setOpponentHearts(Number(data.opponentHearts ?? MAX_HEARTS));
          setMyOnlineReady(Boolean(data.myReady));
          setPrepTimer(Number(data.prepTimer ?? PREP_DURATION_SEC));
          setTurnTimer(Number(data.turnTimer ?? TURN_DURATION_SEC));
          setRevealTimer(Number(data.revealTimer ?? REVEAL_DURATION_SEC));
          setIsResolvingPick(Boolean(data.isResolvingPick));
          setRematchPending(Boolean(data.rematchPending));

          const serverTurnSlot = Number(data.turnSlot) === 1 ? 1 : 0;
          setTurnOwner(serverTurnSlot === slot ? 'PLAYER' : 'OPPONENT');

          const cdVal = Number(data.countdownValue ?? 3);
          setCountdownValue(cdVal);
          if (serverPhase === 'COUNTDOWN' && prevCountdownRef.current !== cdVal) {
            soundEngine.playCountdownTick(cdVal);
            prevCountdownRef.current = cdVal;
          } else if (serverPhase !== 'COUNTDOWN') {
            prevCountdownRef.current = 0;
          }

          const wSlot =
            data.winnerSlot === 0 || data.winnerSlot === 1
              ? (data.winnerSlot as 0 | 1)
              : null;
          setOnlineWinnerSlot(wSlot);

          const wdSlot =
            data.withdrawnSlot === 0 || data.withdrawnSlot === 1
              ? (data.withdrawnSlot as 0 | 1)
              : null;
          setWithdrawnByMe(wdSlot === slot);
          setWithdrawnByOpponent(wdSlot !== null && wdSlot !== slot);

          if (serverPhase === 'GAME_OVER' && prevOnlinePhaseRef.current !== 'GAME_OVER') {
            if (wSlot === slot) {
              soundEngine.playWin();
            } else {
              soundEngine.playLose();
            }
          }

          prevOnlinePhaseRef.current = serverPhase;
          setPhase(serverPhase as GamePhase);
        }
      };

      ws.onclose = () => {
        if (screenRef.current === 'online_lobby') {
          setLobbyPlayers([]);
        }
      };
    },
    [closeWs, settings.haptics, showToast]
  );

  // Join the Telegram invitation's internal game ID automatically.
  useEffect(() => {
    if (!initialRoomId || autoJoinedRef.current) return;
    autoJoinedRef.current = true;
    const myName = getTelegramPlayerName();
    connectOnlineWs((ws) => {
      ws.send(
        JSON.stringify({
          type: 'join_room',
          roomId: initialRoomId,
          clientId,
          name: myName,
        })
      );
    });
  }, [clientId, connectOnlineWs, initialRoomId]);

  const chooseTelegramOpponent = () => {
    const picker = (
      window as unknown as {
        Telegram?: {
          WebApp?: {
            switchInlineQuery?: (query: string, chatTypes?: string[]) => void;
          };
        };
      }
    ).Telegram?.WebApp?.switchInlineQuery;
    if (typeof picker !== 'function') {
      showToast('افتح اللعبة من الميني آب داخل تيليجرام لاختيار المحادثة.');
      return;
    }
    picker('الشبس', ['users', 'groups', 'channels']);
  };

  // --- BOT MODE LOCAL GAME ENGINE ---
  const startBotCountdownPhase = useCallback(
    (finalPlayerCells?: TrayCell[]) => {
      if (mode !== 'bot') return;
      const sourceCells = finalPlayerCells ?? playerCells;
      const existingBombIndices = sourceCells
        .filter((c) => c.hasBomb)
        .map((c) => c.index);
      const completedBombs = generateRandomBombIndices(
        BOMB_COUNT,
        existingBombIndices
      );
      setPlayerCells(createTrayWithBombs(completedBombs));

      const botBombs = generateBotBombIndices(settings.difficulty);
      setOpponentCells(createTrayWithBombs(botBombs));

      setPhase('COUNTDOWN');
      setCountdownValue(3);
      soundEngine.playCountdownTick(3);

      scheduleTimeout(() => {
        setCountdownValue(2);
        soundEngine.playCountdownTick(2);
      }, 850);

      scheduleTimeout(() => {
        setCountdownValue(1);
        soundEngine.playCountdownTick(1);
      }, 1700);

      scheduleTimeout(() => {
        setPhase('PLAYING');
        setTurnOwner('PLAYER');
        setTurnTimer(TURN_DURATION_SEC);
        setIsResolvingPick(false);
      }, 2550);
    },
    [mode, playerCells, scheduleTimeout, settings.difficulty]
  );

  // Bot Prep 25s timer
  useEffect(() => {
    if (mode !== 'bot' || screen !== 'playing' || phase !== 'PREP') return;
    if (prepTimer <= 0) {
      startBotCountdownPhase();
      return;
    }
    const id = window.setTimeout(() => {
      setPrepTimer((t) => Math.max(0, t - 1));
    }, 1000);
    return () => window.clearTimeout(id);
  }, [mode, phase, prepTimer, screen, startBotCountdownPhase]);

  const handlePrepCellClick = (index: number) => {
    if (screen !== 'playing' || phase !== 'PREP') return;
    if (mode === 'online' && myOnlineReady) return;

    setPlayerCells((prev) => {
      const target = prev[index];
      const currentCount = prev.filter((c) => c.hasBomb).length;

      let next: TrayCell[];
      if (target.hasBomb) {
        soundEngine.playPlaceBomb(true);
        triggerHaptic(settings.haptics, 'light');
        next = prev.map((c) =>
          c.index === index ? { ...c, hasBomb: false } : c
        );
      } else {
        if (currentCount >= BOMB_COUNT) return prev;
        soundEngine.playPlaceBomb(false);
        triggerHaptic(settings.haptics, 'light');
        next = prev.map((c) =>
          c.index === index ? { ...c, hasBomb: true } : c
        );
      }

      if (mode === 'online' && wsRef.current?.readyState === WebSocket.OPEN) {
        const bombs = next.filter((c) => c.hasBomb).map((c) => c.index);
        wsRef.current.send(JSON.stringify({ type: 'update_bombs', bombs }));
      }
      return next;
    });
  };

  const handleRandomize = () => {
    if (screen !== 'playing' || phase !== 'PREP') return;
    if (mode === 'online' && myOnlineReady) return;

    soundEngine.playRandomize();
    triggerHaptic(settings.haptics, 'light');
    const randomIndices = generateRandomBombIndices(BOMB_COUNT);
    setPlayerCells(createTrayWithBombs(randomIndices));

    if (mode === 'online' && wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(
        JSON.stringify({ type: 'update_bombs', bombs: randomIndices })
      );
    }
  };

  const handleReady = () => {
    if (
      screen !== 'playing' ||
      phase !== 'PREP' ||
      playerBombsCount < BOMB_COUNT
    )
      return;
    if (mode === 'online' && myOnlineReady) return;

    triggerHaptic(settings.haptics, 'light');
    if (mode === 'online') {
      const bombs = playerCells.filter((c) => c.hasBomb).map((c) => c.index);
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        setMyOnlineReady(true);
        wsRef.current.send(JSON.stringify({ type: 'submit_bombs', bombs }));
      }
      return;
    }

    startBotCountdownPhase();
  };

  const triggerBotEndReveal = useCallback(
    (winner: 'PLAYER' | 'BOT') => {
      setPhase('REVEALING_BOMBS');
      setRevealTimer(REVEAL_DURATION_SEC);

      setPlayerCells((prev) =>
        prev.map((c) =>
          c.hasBomb && c.status === 'CHIP'
            ? { ...c, status: 'BOMB_REVEALED' }
            : c
        )
      );
      setOpponentCells((prev) =>
        prev.map((c) =>
          c.hasBomb && c.status === 'CHIP'
            ? { ...c, status: 'BOMB_REVEALED' }
            : c
        )
      );

      scheduleTimeout(() => setRevealTimer(2), 1000);
      scheduleTimeout(() => setRevealTimer(1), 2000);

      scheduleTimeout(() => {
        setPhase('GAME_OVER');
        if (winner === 'PLAYER') {
          soundEngine.playWin();
        } else {
          soundEngine.playLose();
        }
      }, REVEAL_DURATION_SEC * 1000);
    },
    [scheduleTimeout]
  );

  const executeBotPick = useCallback(
    (actor: 'PLAYER' | 'BOT', cellIndex: number) => {
      if (
        mode !== 'bot' ||
        screen !== 'playing' ||
        phase !== 'PLAYING' ||
        isResolvingPick
      )
        return;

      const isPlayerActing = actor === 'PLAYER';
      const targetCells = isPlayerActing ? opponentCells : playerCells;
      const setTargetCells = isPlayerActing ? setOpponentCells : setPlayerCells;
      const pickedCell = targetCells[cellIndex];

      if (!pickedCell || pickedCell.status !== 'CHIP') return;

      setIsResolvingPick(true);

      if (!pickedCell.hasBomb) {
        soundEngine.playCrunch();
        triggerHaptic(settings.haptics, 'light');
        setTargetCells((prev) =>
          prev.map((c) =>
            c.index === cellIndex ? { ...c, status: 'SAFE_EATEN' } : c
          )
        );

        scheduleTimeout(() => {
          setTurnOwner(isPlayerActing ? 'BOT' : 'PLAYER');
          setTurnTimer(TURN_DURATION_SEC);
          setIsResolvingPick(false);
        }, 580);
      } else {
        soundEngine.playBombReveal();
        setTargetCells((prev) =>
          prev.map((c) =>
            c.index === cellIndex ? { ...c, status: 'EXPLODING_BOMB' } : c
          )
        );

        const nextHearts =
          (isPlayerActing ? playerHearts : opponentHearts) - 1;

        scheduleTimeout(() => {
          soundEngine.playExplosion();
          triggerHaptic(settings.haptics, 'heavy');
          setShakingTray(isPlayerActing ? 'red' : 'blue');
          setTargetCells((prev) =>
            prev.map((c) =>
              c.index === cellIndex ? { ...c, status: 'EXPLODING_SMOKE' } : c
            )
          );
          if (isPlayerActing) {
            setPlayerHearts(Math.max(0, nextHearts));
          } else {
            setOpponentHearts(Math.max(0, nextHearts));
          }
        }, 440);

        scheduleTimeout(() => {
          setShakingTray(null);
          setTargetCells((prev) =>
            prev.map((c) =>
              c.index === cellIndex ? { ...c, status: 'BOMB_CHARRED' } : c
            )
          );

          if (nextHearts <= 0) {
            scheduleTimeout(() => {
              triggerBotEndReveal(isPlayerActing ? 'BOT' : 'PLAYER');
            }, 320);
          } else {
            setTurnOwner(isPlayerActing ? 'BOT' : 'PLAYER');
            setTurnTimer(TURN_DURATION_SEC);
            setIsResolvingPick(false);
          }
        }, 1060);
      }
    },
    [
      isResolvingPick,
      mode,
      opponentCells,
      opponentHearts,
      phase,
      playerCells,
      playerHearts,
      scheduleTimeout,
      screen,
      settings.haptics,
      triggerBotEndReveal,
    ]
  );

  // Bot turn 15s countdown
  useEffect(() => {
    if (
      mode !== 'bot' ||
      screen !== 'playing' ||
      phase !== 'PLAYING' ||
      isResolvingPick
    )
      return;

    if (turnTimer <= 0) {
      const pool = (turnOwner === 'PLAYER' ? opponentCells : playerCells).filter(
        (c) => c.status === 'CHIP'
      );
      if (pool.length > 0) {
        const randomCell = pool[Math.floor(Math.random() * pool.length)];
        executeBotPick(turnOwner === 'PLAYER' ? 'PLAYER' : 'BOT', randomCell.index);
      }
      return;
    }

    const id = window.setTimeout(() => {
      setTurnTimer((t) => Math.max(0, t - 1));
    }, 1000);
    return () => window.clearTimeout(id);
  }, [
    executeBotPick,
    isResolvingPick,
    mode,
    opponentCells,
    phase,
    playerCells,
    screen,
    turnOwner,
    turnTimer,
  ]);

  // Bot AI turn scheduler
  useEffect(() => {
    if (
      mode !== 'bot' ||
      screen !== 'playing' ||
      phase !== 'PLAYING' ||
      turnOwner !== 'BOT' ||
      isResolvingPick
    )
      return;

    const chosenIndex = pickBotTargetIndex(playerCells, settings.difficulty);
    if (chosenIndex === null) return;

    const thinkDelay = 900 + Math.floor(Math.random() * 600);
    const id = scheduleTimeout(() => {
      executeBotPick('BOT', chosenIndex);
    }, thinkDelay);

    return () => window.clearTimeout(id);
  }, [
    executeBotPick,
    isResolvingPick,
    mode,
    phase,
    playerCells,
    scheduleTimeout,
    screen,
    settings.difficulty,
    turnOwner,
  ]);

  const handleOpponentCellClick = (index: number) => {
    if (
      screen !== 'playing' ||
      phase !== 'PLAYING' ||
      turnOwner !== 'PLAYER' ||
      isResolvingPick
    )
      return;

    if (mode === 'online') {
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ type: 'pick_cell', index }));
      }
      return;
    }

    executeBotPick('PLAYER', index);
  };

  const playerWon =
    mode === 'online'
      ? onlineWinnerSlot === mySlot
      : !withdrawnByMe && opponentHearts <= 0;

  return (
    <div className="min-h-dvh w-full select-none text-white" dir="rtl">
      {toast && <div className="nawaf-toast">{toast}</div>}

      {/* HOME SCREEN */}
      {screen === 'home' && (
        <div className="mx-auto flex min-h-dvh w-full max-w-md flex-col px-4 pb-6 pt-4">
          {/* Top Brand Header */}
          <div className="mb-4 flex items-center gap-2.5">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-rose-500 to-red-800 shadow-lg border border-white/20">
              <Bomb className="h-5 w-5 text-amber-300" />
            </div>
            <div>
              <h1 className="m-0 text-xl font-black leading-tight text-white">
                البطاطس
              </h1>
              <p className="m-0 text-[11px] font-bold text-white/60">
                تحدي 1 ضد 1
              </p>
            </div>
          </div>

          {/* Showcase Preview Card */}
          <div className="nawaf-panel mb-4 overflow-hidden p-3">
            <div className="relative rounded-2xl bg-crimson-tablecloth p-4 flex items-center justify-center gap-4 border border-white/15 shadow-inner overflow-hidden">
              <div className="grid grid-cols-3 gap-1.5 p-2 rounded-2xl tray-blue-frame w-36 shrink-0">
                {Array.from({ length: 9 }).map((_, idx) => (
                  <div
                    key={idx}
                    className="relative aspect-square rounded-lg tray-blue-well p-1 flex items-center justify-center"
                  >
                    <PotatoChipSvg variant={idx} />
                    {(idx === 1 || idx === 4 || idx === 6) && (
                      <div className="absolute -top-1 -right-1 scale-[0.65]">
                        <HiddenBombBadge />
                      </div>
                    )}
                  </div>
                ))}
              </div>
              <div className="flex flex-col gap-1.5 text-right">
                <span className="inline-flex items-center gap-1 text-xs font-black text-amber-300">
                  <Sparkles className="w-3.5 h-3.5" />
                  <span>تحدي التخمين والحظ</span>
                </span>
                <p className="text-xs sm:text-sm font-bold text-white/95 leading-relaxed">
                  زبِّن 3 قنابل تحت البطاطس واكتشف بطاطس الخصم الآمنة!
                </p>
              </div>
            </div>

            <div className="mt-2.5 flex items-center justify-between px-1">
              <span className="text-xs font-black text-white/90">
                1 ضد 1 · 3 قلوب لكل لاعب
              </span>
              <span className="rounded-lg bg-rose-500/20 px-2.5 py-0.5 text-xs font-black text-rose-200">
                9 رقائق
              </span>
            </div>
          </div>

          {/* Bot Difficulty Selector (for Bot Mode) */}
          <div className="nawaf-panel mb-4 p-3.5">
            <div className="mb-2 flex items-center justify-between text-xs font-extrabold text-white/80">
              <span>مستوى البوت:</span>
              <span className="text-amber-300">
                {DIFFICULTY_META[settings.difficulty].label}
              </span>
            </div>
            <div className="grid grid-cols-3 gap-2">
              {DIFFICULTIES.map((level) => (
                <button
                  key={level}
                  type="button"
                  onClick={() =>
                    updateSettings({ ...settings, difficulty: level })
                  }
                  className={`nawaf-choice py-2.5 text-center text-sm ${
                    settings.difficulty === level ? 'active' : ''
                  }`}
                >
                  {DIFFICULTY_META[level].label}
                </button>
              ))}
            </div>
            <p className="mt-2 text-[11px] font-bold text-white/60">
              {DIFFICULTY_META[settings.difficulty].hint}
            </p>
          </div>

          {/* Primary Actions */}
          <div className="space-y-2.5 mb-4">
            <button
              type="button"
              onClick={startBotMatch}
              className="nawaf-primary flex items-center justify-center gap-2.5"
            >
              <Play className="h-5 w-5 fill-current" />
              <span>ابدأ اللعب ضد البوت</span>
            </button>

            <button
              type="button"
              onClick={chooseTelegramOpponent}
              className="nawaf-secondary flex items-center justify-center gap-2.5"
            >
              <span className="text-xl">👥</span>
              <span>لعب ضد شخص بالتيليجرام</span>
            </button>

            <button
              type="button"
              onClick={handleDownloadZip}
              disabled={downloadingZip}
              className="nawaf-secondary flex items-center justify-center gap-2 disabled:opacity-60"
            >
              <Download className="h-4 w-4 text-amber-300" />
              <span>
                {downloadingZip
                  ? 'جاري تجهيز الملف...'
                  : 'تحميل ملفات اللعبة (Zip)'}
              </span>
            </button>
          </div>

          {/* Rules Summary Card */}
          <div className="rounded-2xl border border-white/15 bg-[#12060a]/80 p-3.5 text-xs text-white/80 leading-relaxed space-y-1">
            <div className="font-black text-amber-200 mb-1">
              قواعد لعبة البطاطس:
            </div>
            <div>• يمتلك كل لاعب صينية فيها 9 رقائق بطاطس و3 قلوب حمراء.</div>
            <div>• في مرحلة التحضير (25 ثانية) خبّي 3 قنابل في صينيتك.</div>
            <div>• تناوب مع خصمك على أكل الرقائق؛ من يفجّر 3 قنابل يخسر!</div>
          </div>
        </div>
      )}

      {/* ONLINE LOBBY SCREEN */}
      {screen === 'online_lobby' && (
        <div className="mx-auto flex min-h-dvh w-full max-w-md flex-col px-4 pb-6 pt-4">
          <div className="mb-4 flex items-center justify-between">
            <button
              type="button"
              onClick={() => {
                if (wsRef.current?.readyState === WebSocket.OPEN) {
                  wsRef.current.send(JSON.stringify({ type: 'withdraw' }));
                }
                closeWs();
                setScreen('home');
              }}
              className="nawaf-pill flex items-center gap-1.5"
            >
              <ArrowRight className="h-4 w-4" />
              <span>رجوع</span>
            </button>
            <h2 className="m-0 text-lg font-black">تحدي الشبس 🥔</h2>
            <div className="w-16" aria-hidden="true" />
          </div>

          <div className="nawaf-panel space-y-4 p-4">
            <p className="text-xs font-bold text-white/75 leading-relaxed">
              تم فتح دعوة تيليجرام. انتظر انضمام اللاعب الآخر لبدء المواجهة.
            </p>
            <div className="space-y-2">
              <div className="text-xs font-extrabold text-white/75">
                اللاعبون ({lobbyPlayers.length} / 2)
              </div>
              {lobbyPlayers.map((p) => (
                <div
                  key={p.slot}
                  className="flex items-center justify-between rounded-xl border border-white/15 bg-black/30 px-3.5 py-2.5"
                >
                  <span className="font-black text-white">{p.name}</span>
                  <span
                    className={`rounded-lg px-2.5 py-0.5 text-xs font-black ${
                      p.slot === mySlot
                        ? 'bg-sky-500/25 text-sky-300'
                        : 'bg-rose-500/25 text-rose-300'
                    }`}
                  >
                    {p.slot === mySlot ? 'أنت' : 'الخصم'}
                  </span>
                </div>
              ))}
            </div>

            {mySlot === 0 ? (
              <button
                type="button"
                disabled={lobbyPlayers.length < 2}
                onClick={() =>
                  wsRef.current?.send(JSON.stringify({ type: 'start_match' }))
                }
                className="nawaf-primary disabled:opacity-50"
              >
                {lobbyPlayers.length < 2
                  ? 'بانتظار اللاعب الآخر...'
                  : 'ابدأ المباراة الآن'}
              </button>
            ) : (
              <div className="rounded-xl border border-sky-400/25 bg-sky-500/10 py-3 text-center text-sm font-extrabold text-sky-200">
                بانتظار بدء المباراة...
              </div>
            )}

            <button
              type="button"
              onClick={() => {
                if (wsRef.current?.readyState === WebSocket.OPEN) {
                  wsRef.current.send(JSON.stringify({ type: 'withdraw' }));
                }
                closeWs();
                setScreen('home');
              }}
              className="nawaf-secondary flex items-center justify-center gap-1.5 text-xs text-white/80"
            >
              <LogOut className="w-3.5 h-3.5" />
              <span>مغادرة التحدي</span>
            </button>
          </div>
        </div>
      )}

      {/* GAMEPLAY ARENA (Crimson Checkered Tablecloth) */}
      {screen === 'playing' && (
        <div className="min-h-dvh w-full flex flex-col justify-between overflow-x-hidden bg-crimson-tablecloth relative">
          <TopHud
            mode={mode}
            playerName={playerName}
            opponentName={opponentName}
            playerHearts={playerHearts}
            opponentHearts={opponentHearts}
            difficulty={settings.difficulty}
            isMuted={!settings.soundEnabled}
            onToggleMute={handleToggleMute}
          />

          {/* Signature Nawaf-Games Right-Edge Withdraw Tab inside gameplay */}
          {phase !== 'GAME_OVER' && phase !== 'REVEALING_BOMBS' && (
            <button
              type="button"
              onClick={handleWithdraw}
              className="fixed right-0 top-24 z-30 flex h-24 w-10 sm:w-11 cursor-pointer items-center justify-center rounded-l-full bg-white text-[#23262f] shadow-xl transition-transform active:scale-95 focus-visible:outline-2 focus-visible:outline-amber-300"
              aria-label="انسحاب"
            >
              <span className="-rotate-90 whitespace-nowrap text-sm font-black tracking-wide">
                انسحاب
              </span>
            </button>
          )}

          <main className="flex-1 flex flex-col items-center justify-center px-3 py-2 relative">
            {/* SCREEN 1: PREP PHASE */}
            {phase === 'PREP' && (
              <div className="flex flex-col items-center gap-4 w-full max-w-sm">
                <TrayGrid
                  cells={playerCells}
                  variant="blue"
                  size="prep"
                  showHiddenBombMarkers
                  interactive={!(mode === 'online' && myOnlineReady)}
                  onCellClick={handlePrepCellClick}
                />

                <div className="w-full flex flex-col items-center gap-3 mt-1">
                  <div className="bg-black/25 backdrop-blur-xs border border-white/20 rounded-xl px-4 py-1.5 flex items-center gap-2 text-white font-extrabold text-sm sm:text-base shadow-sm">
                    <Bomb className="w-4 h-4 text-amber-300 shrink-0" />
                    <span>
                      {mode === 'online' && myOnlineReady
                        ? `بانتظار ${opponentName}...`
                        : 'خبي 3 قنابل'}
                    </span>
                  </div>

                  <div className="w-full max-w-[290px] flex items-center gap-2.5">
                    <button
                      type="button"
                      onClick={handleRandomize}
                      disabled={mode === 'online' && myOnlineReady}
                      className="flex-1 py-2.5 px-4 rounded-2xl bg-rose-500 hover:bg-rose-400 active:translate-y-0.5 text-white font-black text-base shadow-[0_4px_0_0_#9f1239] flex items-center justify-center gap-1.5 transition-all cursor-pointer whitespace-nowrap disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-2 focus-visible:outline-white"
                    >
                      <Shuffle className="w-4 h-4" />
                      <span>عشوائي</span>
                    </button>

                    <button
                      type="button"
                      onClick={handleReady}
                      disabled={
                        playerBombsCount < BOMB_COUNT ||
                        (mode === 'online' && myOnlineReady)
                      }
                      className={`flex-[1.35] py-2.5 px-4 rounded-2xl font-black text-base flex items-center justify-center gap-2 transition-all whitespace-nowrap focus-visible:outline-2 focus-visible:outline-white ${
                        playerBombsCount === BOMB_COUNT &&
                        !(mode === 'online' && myOnlineReady)
                          ? 'bg-amber-400 hover:bg-amber-300 active:translate-y-0.5 text-slate-950 shadow-[0_4px_0_0_#b45309] cursor-pointer'
                          : 'bg-amber-400/55 text-slate-950/60 shadow-[0_4px_0_0_rgba(180,83,9,0.45)] cursor-not-allowed'
                      }`}
                    >
                      <span>
                        {mode === 'online' && myOnlineReady ? 'تم التجهيز' : 'جاهز'}
                      </span>
                      <span className="tabular-nums text-sm font-extrabold bg-black/15 rounded-lg px-2 py-0.5">
                        {playerBombsCount}/{BOMB_COUNT} - {prepTimer}
                      </span>
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* SCREENS 2, 3, 4, 5: DUAL-TRAY ARENA */}
            {phase !== 'PREP' && (
              <div className="flex flex-col items-center justify-center gap-2.5 sm:gap-3 w-full max-w-md relative">
                <TrayGrid
                  cells={playerCells}
                  variant="blue"
                  size="compact"
                  showHiddenBombMarkers
                  shaking={shakingTray === 'blue'}
                  label="صينيتك"
                />

                <div className="h-12 flex items-center justify-center z-20">
                  {phase === 'COUNTDOWN' && (
                    <div
                      key={countdownValue}
                      className="text-5xl sm:text-6xl font-black text-amber-300 drop-shadow-[0_4px_0_rgba(120,53,15,0.9)] tabular-nums animate-countdown-pop"
                    >
                      {countdownValue}
                    </div>
                  )}

                  {phase === 'PLAYING' && (
                    <div
                      className={`px-5 py-2 rounded-2xl border-2 border-white shadow-lg flex items-center gap-3 transition-colors duration-200 ${
                        turnOwner === 'PLAYER'
                          ? 'bg-amber-400 text-slate-950'
                          : 'bg-sky-300 text-slate-950'
                      }`}
                    >
                      <span className="font-black text-sm sm:text-base whitespace-nowrap">
                        {turnOwner === 'PLAYER'
                          ? 'دورك'
                          : mode === 'bot'
                            ? 'دور البوت'
                            : `دور ${opponentName}`}
                      </span>
                      <span className="flex items-center gap-1 bg-black/15 rounded-xl px-2.5 py-0.5 font-black text-sm sm:text-base tabular-nums">
                        <Timer className="w-3.5 h-3.5" />
                        <span>{turnTimer}</span>
                      </span>
                    </div>
                  )}

                  {phase === 'REVEALING_BOMBS' && (
                    <div className="px-5 py-2 rounded-2xl border-2 border-amber-300 bg-neutral-950/90 text-white shadow-lg flex items-center gap-2.5 animate-bomb-pop">
                      <Bomb className="w-4 h-4 text-amber-400" />
                      <span className="font-extrabold text-sm whitespace-nowrap">
                        أماكن القنابل المتبقية
                      </span>
                      <span className="tabular-nums font-black text-amber-300 bg-white/15 rounded-lg px-2 py-0.5 text-sm">
                        {revealTimer}
                      </span>
                    </div>
                  )}
                </div>

                <TrayGrid
                  cells={opponentCells}
                  variant="red"
                  size="play"
                  interactive={
                    phase === 'PLAYING' &&
                    turnOwner === 'PLAYER' &&
                    !isResolvingPick
                  }
                  shaking={shakingTray === 'red'}
                  label={
                    mode === 'bot'
                      ? 'صينية البوت'
                      : `صينية ${opponentName}`
                  }
                  onCellClick={handleOpponentCellClick}
                />
              </div>
            )}
          </main>

          <div className="h-2 shrink-0" aria-hidden="true" />

          {/* NAWAF-GAMES END MATCH OVERLAY */}
          <EndMatchOverlay
            open={phase === 'GAME_OVER'}
            mode={mode}
            playerWon={playerWon}
            withdrawnByMe={withdrawnByMe}
            withdrawnByOpponent={withdrawnByOpponent}
            playerName={playerName}
            opponentName={opponentName}
            playerHearts={playerHearts}
            opponentHearts={opponentHearts}
            difficulty={settings.difficulty}
            rematchPending={rematchPending}
            onRematch={handleRematch}
            onExitHome={handleExitHome}
          />
        </div>
      )}
    </div>
  );
}
