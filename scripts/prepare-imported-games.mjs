import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const root = process.cwd();
const temp = path.join(root, '.tmp-imported-games');
const gravityZip = path.join(root, 'imports', 'gravity-run-game 2.zip');
const snowballZip = path.join(root, 'imports', 'snowball-game.zip');

function copyFiles(from, to, files) {
  for (const file of files) {
    const src = path.join(from, file);
    const dest = path.join(to, file);
    if (!fs.existsSync(src)) throw new Error('Missing imported file: ' + src);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(src, dest);
  }
}
function replaceOnce(file, before, after, label) {
  const text = fs.readFileSync(file, 'utf8');
  if (!text.includes(before)) throw new Error('Could not patch ' + label + ' in ' + file);
  fs.writeFileSync(file, text.replace(before, after));
}

fs.rmSync(temp, { recursive: true, force: true });
fs.mkdirSync(temp, { recursive: true });
execFileSync('unzip', ['-q', '-o', gravityZip, '-d', path.join(temp, 'gravity')]);
execFileSync('unzip', ['-q', '-o', snowballZip, '-d', path.join(temp, 'snowball')]);

const gravitySource = path.join(temp, 'gravity');
const snowballSource = path.join(temp, 'snowball', 'snowball-game');
const gravityDest = path.join(root, 'games-src', 'gravity');
const snowballDest = path.join(root, 'games-src', 'snowball');

fs.rmSync(gravityDest, { recursive: true, force: true });
fs.rmSync(snowballDest, { recursive: true, force: true });
fs.mkdirSync(gravityDest, { recursive: true });
fs.mkdirSync(snowballDest, { recursive: true });


const dartsZip = path.join(root, 'imports', 'nawaf-darts-project.zip');
const dartsSource = path.join(temp, 'darts');
const dartsDest = path.join(root, 'games-src', 'darts');
execFileSync('unzip', ['-q', '-o', dartsZip, '-d', dartsSource]);
fs.rmSync(dartsDest, { recursive: true, force: true });
fs.mkdirSync(dartsDest, { recursive: true });
copyFiles(dartsSource, dartsDest, [
  'index.html', 'package.json', 'tsconfig.json', 'vite.config.ts',
  'src/index.css', 'src/main.tsx', 'src/assets/images/darts_cover_1795304337579.jpg',
  'src/game/dartsEngine.ts', 'src/game/dartsRenderer.ts', 'src/game/dartsScoring.ts',
  'src/game/dartsSound.ts', 'src/game/dartsTypes.ts'
]);
fs.mkdirSync(path.join(dartsDest, 'src/components'), { recursive: true });
fs.copyFileSync(path.join(root, 'games-src/darts-integration/App.tsx'), path.join(dartsDest, 'src/App.tsx'));
fs.copyFileSync(path.join(root, 'games-src/darts-integration/EndMatchOverlay.tsx'), path.join(dartsDest, 'src/components/EndMatchOverlay.tsx'));
fs.rmSync(path.join(dartsDest, 'server.ts'), { force: true });
fs.rmSync(path.join(dartsDest, 'src/components/SettingsModal.tsx'), { force: true });

const common = ['index.html', 'package.json', 'tsconfig.json', 'vite.config.ts', 'server.ts',
  'src/index.css', 'src/main.tsx', 'src/game/onlineClient.ts', 'src/game/telegram.ts', 'src/game/types.ts'];
copyFiles(gravitySource, gravityDest, [...common, 'src/components/GravityRunArena.tsx',
  'src/game/gravityLevel.ts', 'src/game/gravityPhysics.ts', 'src/game/sound.ts', 'src/game/ballistics.ts', 'public/assets/aistudio/IMG_7493_3386b8c5.jpeg']);
copyFiles(snowballSource, snowballDest, [...common, 'src/components/SnowballArena.tsx', 'src/game/ballistics.ts', 'src/game/sound.ts']);

for (const dir of [gravityDest, snowballDest, dartsDest]) {
  const viteFile = path.join(dir, 'vite.config.ts');
  let vite = fs.readFileSync(viteFile, 'utf8');
  if (!vite.includes("base: './'")) {
    if (!vite.includes('return {\n    plugins:')) throw new Error('Could not set relative Vite base in ' + viteFile);
    vite = vite.replace('return {\n    plugins:', "return {\n    base: './',\n    plugins:");
    fs.writeFileSync(viteFile, vite);
  }
}

const gravityApp = String.raw`import { useEffect, useRef, useState } from 'react';
import { Bot, Users } from 'lucide-react';
import { GravityRunArena } from './components/GravityRunArena';
import { OnlineGameClient, type GravityFlipPayload } from './game/onlineClient';
import { closeTelegramWebApp, getInitialRoomCodeFromUrl, getTelegramDisplayName, initTelegramWebApp } from './game/telegram';
import { GRAVITY_DIFFICULTIES, type Difficulty, type GameResult, type GravityTickPayload, type OnlineRoomSnapshot, type PlayMode } from './game/types';

type Screen = 'home' | 'setup' | 'lobby' | 'playing' | 'over';

export default function App() {
  const [screen, setScreen] = useState<Screen>('home');
  const [cover, setCover] = useState('./assets/aistudio/IMG_7493_3386b8c5.jpeg');
  const [mode, setMode] = useState<PlayMode>('bot');
  const [difficulty, setDifficulty] = useState<Difficulty>('medium');
  const [playerName, setPlayerName] = useState('انت');
  const [matchKey, setMatchKey] = useState(1);
  const [snapshot, setSnapshot] = useState<OnlineRoomSnapshot | null>(null);
  const [error, setError] = useState('');
  const [result, setResult] = useState<GameResult | null>(null);
  const [gravityState, setGravityState] = useState<GravityTickPayload | null>(null);
  const [gravityFlip, setGravityFlip] = useState<{seq:number;flip:GravityFlipPayload}|null>(null);
  const clientRef = useRef<OnlineGameClient|null>(null);
  const screenRef = useRef<Screen>(screen);
  const flipSeq = useRef(0);
  screenRef.current = screen;

  const ensureClient = () => {
    if (!clientRef.current) {
      clientRef.current = new OnlineGameClient({
        onRoomState: (next) => {
          setSnapshot(next);
          if (next.status === 'waiting') setScreen('lobby');
          if (next.status === 'playing' && screenRef.current !== 'playing') {
            setResult(null); setMatchKey(k => k + 1); setScreen('playing');
          }
        },
        onShotBroadcast: () => {},
        onAimSync: () => {},
        onGravityState: (next) => setGravityState(next),
        onGravityFlip: (flip) => { flipSeq.current += 1; setGravityFlip({seq:flipSeq.current,flip}); },
        onError: (message) => setError(message),
        onLeft: () => { setSnapshot(null); setGravityState(null); setGravityFlip(null); setScreen('home'); },
      });
      clientRef.current.connect();
    }
    return clientRef.current;
  };

  useEffect(() => {
    initTelegramWebApp();
    const name = getTelegramDisplayName();
    setPlayerName(name);
    fetch('/api/mini-app').then(r => r.json()).then(data => { if (data.online_game_images?.gravity) setCover(data.online_game_images.gravity); }).catch(() => {});
    const room = getInitialRoomCodeFromUrl();
    if (room) { setMode('online'); setScreen('lobby'); ensureClient().joinRoom(room, name); }
    return () => { clientRef.current?.destroy(); clientRef.current = null; };
  }, []);

  const startBot = () => { setMode('bot'); setResult(null); setMatchKey(k => k + 1); setScreen('playing'); };
  const chooseTelegram = () => {
    const picker = window.Telegram?.WebApp?.switchInlineQuery;
    if (typeof picker !== 'function') { setError('افتح الميني آب من تيليجرام لاختيار المحادثة.'); return; }
    picker('جري الجاذبية', ['users','groups','channels']);
  };
  const leaveOnline = () => {
    clientRef.current?.leaveRoom(); setSnapshot(null); setGravityState(null); setGravityFlip(null);
    setResult(null); setScreen('home');
  };
  const home = () => { if (mode === 'online') leaveOnline(); else { setResult(null); setScreen('home'); } };
  const closePage = () => { if (!closeTelegramWebApp()) home(); };
  const gameOver = (next: GameResult) => { setResult(next); setScreen('over'); };
  const players = snapshot?.players;
  const pCount = Number(Boolean(players?.p1)) + Number(Boolean(players?.p2)) + Number(Boolean(players?.p3));

  return <div className="min-h-dvh w-full flex flex-col items-center justify-center px-4 py-5 text-white">
    {screen === 'home' && <main className="w-full max-w-[540px] mx-auto text-center">
      <div className="mx-auto mb-5 h-44 overflow-hidden rounded-3xl border border-white/20 bg-gradient-to-br from-[#7d1321] via-[#251018] to-[#08090f] shadow-2xl">{cover ? <img src={cover} alt="جري الجاذبية" className="h-full w-full object-cover" /> : <div className="flex h-full items-center justify-center text-7xl">⚡</div>}</div>
      <h1 className="text-3xl sm:text-4xl font-black mb-2">جري الجاذبية</h1>
      <p className="text-white/70 font-bold mb-6">اقلب الجاذبية وتجاوز الأشواك والصناديق!</p>
      <section className="nawaf-panel grid gap-3">
        <button className="nawaf-start flex items-center justify-center gap-2" onClick={() => {setMode('bot');setScreen('setup');}}><Bot/> لعب ضد البوت</button>
        <button className="nawaf-secondary flex items-center justify-center gap-2" onClick={chooseTelegram}><Users/> لعب ضد شخص بالتيليجرام</button>
        {error && <p className="text-sm text-red-200">{error}</p>}
      </section>
      <button className="nawaf-secondary w-full mt-3" onClick={() => {window.location.href='/miniapp/';}}>↩ الرجوع للقائمة الرئيسية</button>
    </main>}

    {screen === 'setup' && <main className="w-full max-w-[540px] mx-auto">
      <h1 className="text-3xl font-black text-center mb-2">إعدادات جري الجاذبية ⚡</h1>
      <p className="text-center text-white/70 mb-5">اختر مستوى البوت</p>
      <section className="nawaf-panel">
        <div className="grid grid-cols-3 gap-2 mb-5">
          {GRAVITY_DIFFICULTIES.map(level => <button key={level.id} className={'nawaf-level '+(difficulty===level.id?'active':'')} onClick={()=>setDifficulty(level.id)}>{level.label}</button>)}
        </div>
        <button className="nawaf-start w-full" onClick={startBot}>ابدأ اللعب ⚡</button>
        <button className="nawaf-secondary w-full mt-3" onClick={()=>setScreen('home')}>رجوع</button>
      </section>
    </main>}

    {screen === 'lobby' && <main className="w-full max-w-[540px] mx-auto text-center">
      <h1 className="text-3xl font-black mb-2">تحدي جري الجاذبية ⚡</h1>
      <p className="text-white/70 mb-5">بانتظار انضمام اللاعبين من الرسالة المرسلة في تيليجرام</p>
      <section className="nawaf-panel space-y-3">
        {(['p1','p2','p3'] as const).map((slot,i)=><div key={slot} className="rounded-xl bg-black/25 p-3 font-bold">{players?.[slot]?.name || (i===2?'لاعب إضافي (اختياري)':'بانتظار لاعب')} {players?.[slot]?.connected?'✓':''}</div>)}
        {snapshot?.yourSlot === 'p1' ? <button className="nawaf-start w-full" disabled={pCount<2} onClick={()=>clientRef.current?.startMatch()}>{pCount>=2?'ابدأ التحدي':'بانتظار لاعب آخر...'}</button> : <p className="text-sm text-white/75">انضممت بنجاح، بانتظار بدء التحدي</p>}
        {error && <p className="text-sm text-red-200">{error}</p>}
        <button className="nawaf-secondary w-full" onClick={leaveOnline}>رجوع</button>
      </section>
    </main>}

    {screen === 'playing' && <div className="gravity-fullscreen-stage w-full">
      <GravityRunArena key={matchKey} mode={mode} difficulty={difficulty} playerName={playerName}
        onlineSnapshot={snapshot || undefined} onlineClient={clientRef.current || undefined}
        latestGravityState={gravityState} latestGravityFlip={gravityFlip}
        onExit={home} onGameOver={gameOver}/>
    </div>}

    {screen === 'over' && result && <div className="online-end-overlay" role="dialog" aria-modal="true">
      <div className="online-end-card">
        <h2>{result.didLocalWin?'🎉 مبروك الفوز!':'🏁 انتهى التحدي!'}</h2>
        <div className="online-end-winner">{result.winnerName}</div>
        <p>{result.winReason==='finish'?'وصلت إلى خط النهاية!':result.didLocalWin?'أحسنت، فزت بالتحدي!':'حاول مرة ثانية وتجاوز العقبات 💪'}</p>
        <div className="online-end-actions">
          <button onClick={()=>{if(mode==='online')clientRef.current?.requestRematch();else startBot();}}>لعب مرة ثانية</button>
          <button onClick={home}>الصفحة الرئيسية</button>
          <button onClick={closePage}>قفل الصفحة</button>
        </div>
      </div>
    </div>}
  </div>;
}
`;

const snowballApp = String.raw`import { useEffect, useRef, useState } from 'react';
import { Bot, Users } from 'lucide-react';
import { SnowballArena } from './components/SnowballArena';
import { OnlineGameClient, type AimSyncPayload } from './game/onlineClient';
import { closeTelegramWebApp, getInitialRoomCodeFromUrl, getTelegramDisplayName, initTelegramWebApp } from './game/telegram';
import { DIFFICULTIES, type Difficulty, type GameResult, type OnlineRoomSnapshot, type OnlineShotOutcome, type PlayMode } from './game/types';

type Screen = 'home' | 'setup' | 'lobby' | 'playing' | 'over';

export default function App() {
  const [screen, setScreen] = useState<Screen>('home');
  const [cover, setCover] = useState('');
  const [mode, setMode] = useState<PlayMode>('bot');
  const [difficulty, setDifficulty] = useState<Difficulty>('medium');
  const [playerName, setPlayerName] = useState('انت');
  const [matchKey, setMatchKey] = useState(1);
  const [snapshot, setSnapshot] = useState<OnlineRoomSnapshot | null>(null);
  const [error, setError] = useState('');
  const [result, setResult] = useState<GameResult | null>(null);
  const [shot, setShot] = useState<{seq:number;outcome:OnlineShotOutcome}|null>(null);
  const [aim, setAim] = useState<AimSyncPayload|null>(null);
  const clientRef = useRef<OnlineGameClient|null>(null);
  const screenRef = useRef<Screen>(screen);
  const shotSeq = useRef(0);
  screenRef.current = screen;

  // Lock the Telegram Mini App viewport while a Snowball match is active.
  useEffect(() => {
    if (screen !== 'playing') return;
    const html = document.documentElement;
    const body = document.body;
    const previous = {
      htmlOverflow: html.style.overflow,
      bodyOverflow: body.style.overflow,
      bodyPosition: body.style.position,
      bodyWidth: body.style.width,
      bodyHeight: body.style.height,
      bodyTop: body.style.top,
      bodyLeft: body.style.left,
    };
    const scrollY = window.scrollY;
    const preventScroll = (event: Event) => event.preventDefault();
    html.style.overflow = 'hidden';
    body.style.overflow = 'hidden';
    body.style.position = 'fixed';
    body.style.width = '100%';
    body.style.height = '100%';
    body.style.top = '0';
    body.style.left = '0';
    document.addEventListener('touchmove', preventScroll, { passive: false, capture: true });
    document.addEventListener('wheel', preventScroll, { passive: false, capture: true });
    const webApp = (window as any).Telegram?.WebApp;
    webApp?.expand?.();
    webApp?.disableVerticalSwipes?.();
    return () => {
      document.removeEventListener('touchmove', preventScroll, true);
      document.removeEventListener('wheel', preventScroll, true);
      html.style.overflow = previous.htmlOverflow;
      body.style.overflow = previous.bodyOverflow;
      body.style.position = previous.bodyPosition;
      body.style.width = previous.bodyWidth;
      body.style.height = previous.bodyHeight;
      body.style.top = previous.bodyTop;
      body.style.left = previous.bodyLeft;
      window.scrollTo(0, scrollY);
      webApp?.enableVerticalSwipes?.();
    };
  }, [screen]);

  const ensureClient = () => {
    if (!clientRef.current) {
      clientRef.current = new OnlineGameClient({
        onRoomState: (next) => {
          setSnapshot(next);
          if (next.status === 'waiting') setScreen('lobby');
          if (next.status === 'playing' && screenRef.current !== 'playing') {
            setResult(null); setMatchKey(k => k + 1); setScreen('playing');
          }
        },
        onShotBroadcast: (outcome) => { shotSeq.current += 1; setAim(null); setShot({seq:shotSeq.current,outcome}); },
        onAimSync: (next) => setAim(next),
        onError: (message) => setError(message),
        onLeft: () => { setSnapshot(null); setShot(null); setAim(null); setScreen('home'); },
      });
      clientRef.current.connect();
    }
    return clientRef.current;
  };

  useEffect(() => {
    initTelegramWebApp();
    const name = getTelegramDisplayName();
    setPlayerName(name);
    fetch('/api/mini-app').then(r => r.json()).then(data => { if (data.online_game_images?.snowball) setCover(data.online_game_images.snowball); }).catch(() => {});
    const room = getInitialRoomCodeFromUrl();
    if (room) { setMode('online'); setScreen('lobby'); ensureClient().joinRoom(room, name); }
    return () => { clientRef.current?.destroy(); clientRef.current = null; };
  }, []);

  const startBot = () => { setMode('bot'); setResult(null); setMatchKey(k => k + 1); setScreen('playing'); };
  const chooseTelegram = () => {
    const picker = window.Telegram?.WebApp?.switchInlineQuery;
    if (typeof picker !== 'function') { setError('افتح الميني آب من تيليجرام لاختيار المحادثة.'); return; }
    picker('كرة الثلج', ['users','groups','channels']);
  };
  const leaveOnline = () => { clientRef.current?.leaveRoom(); setSnapshot(null); setShot(null); setAim(null); setResult(null); setScreen('home'); };
  const home = () => { if (mode === 'online') leaveOnline(); else { setResult(null); setScreen('home'); } };
  const closePage = () => { if (!closeTelegramWebApp()) home(); };
  const gameOver = (next: GameResult) => { setResult(next); setScreen('over'); };

  return <div className="min-h-dvh w-full flex flex-col items-center justify-center px-4 py-5 text-white">
    {screen === 'home' && <main className="w-full max-w-[540px] mx-auto text-center">
      <div className="mx-auto mb-5 h-44 overflow-hidden rounded-3xl border border-white/20 bg-gradient-to-br from-[#1b5a82] via-[#172033] to-[#08090f] shadow-2xl">{cover ? <img src={cover} alt="كرة الثلج" className="h-full w-full object-cover" /> : <div className="flex h-full items-center justify-center text-7xl">❄️</div>}</div>
      <h1 className="text-3xl sm:text-4xl font-black mb-2">كرة الثلج</h1>
      <p className="text-white/70 font-bold mb-6">اسحب وصوّب كرة الثلج نحو الخصم قبل ما يطيّحك</p>
      <section className="nawaf-panel grid gap-3">
        <button className="nawaf-start flex items-center justify-center gap-2" onClick={()=>{setMode('bot');setScreen('setup');}}><Bot/> لعب ضد البوت</button>
        <button className="nawaf-secondary flex items-center justify-center gap-2" onClick={chooseTelegram}><Users/> لعب ضد شخص بالتيليجرام</button>
        {error && <p className="text-sm text-red-200">{error}</p>}
      </section>
      <button className="nawaf-secondary w-full mt-3" onClick={() => {window.location.href='/miniapp/';}}>↩ الرجوع للقائمة الرئيسية</button>
    </main>}

    {screen === 'setup' && <main className="w-full max-w-[540px] mx-auto">
      <h1 className="text-3xl font-black text-center mb-2">إعدادات كرة الثلج ❄️</h1>
      <p className="text-center text-white/70 mb-5">اختر مستوى البوت</p>
      <section className="nawaf-panel">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 mb-5">
          {DIFFICULTIES.map(level=><button key={level.id} className={'nawaf-level '+(difficulty===level.id?'active':'')} onClick={()=>setDifficulty(level.id)}><span className="font-black">{level.label}</span><small className="block text-xs mt-1">{level.description}</small></button>)}
        </div>
        <button className="nawaf-start w-full" onClick={startBot}>ابدأ اللعب ❄️</button>
        <button className="nawaf-secondary w-full mt-3" onClick={()=>setScreen('home')}>رجوع</button>
      </section>
    </main>}

    {screen === 'lobby' && <main className="w-full max-w-[540px] mx-auto text-center">
      <h1 className="text-3xl font-black mb-2">تحدي كرة الثلج ❄️</h1>
      <p className="text-white/70 mb-5">بانتظار انضمام اللاعب الآخر من الرسالة المرسلة في تيليجرام</p>
      <section className="nawaf-panel space-y-3">
        <div className="rounded-xl bg-black/25 p-3 font-bold">{snapshot?.players.p1?.name || 'بانتظار اللاعب الأول'} {snapshot?.players.p1?.connected?'✓':''}</div>
        <div className="rounded-xl bg-black/25 p-3 font-bold">{snapshot?.players.p2?.name || 'بانتظار اللاعب الثاني'} {snapshot?.players.p2?.connected?'✓':''}</div>
        {snapshot?.yourSlot === 'p1' ? <button className="nawaf-start w-full" disabled={!snapshot.players.p2} onClick={()=>clientRef.current?.startMatch()}>{snapshot.players.p2?'ابدأ المباراة':'بانتظار انضمام اللاعب الثاني...'}</button> : <p className="text-sm text-white/75">انضممت بنجاح، بانتظار بدء المباراة</p>}
        {error && <p className="text-sm text-red-200">{error}</p>}
        <button className="nawaf-secondary w-full" onClick={leaveOnline}>رجوع</button>
      </section>
    </main>}

    {screen === 'playing' && <div className="snowball-fullscreen-stage">
      <SnowballArena key={matchKey} mode={mode} difficulty={difficulty} playerName={playerName}
        onlineSnapshot={snapshot || undefined} onlineClient={clientRef.current || undefined}
        latestOnlineShot={shot} remoteAimSync={aim} onExit={home} onGameOver={gameOver}/>
    </div>}

    {screen === 'over' && result && <div className="online-end-overlay" role="dialog" aria-modal="true">
      <div className="online-end-card">
        <h2>{result.didLocalWin?'🎉 مبروك الفوز!':'❄️ انتهت المباراة!'}</h2>
        <div className="online-end-winner">{result.winnerName}</div>
        <p>{result.didLocalWin?'مبروك، تستاهل الفوز!':'هارد لك! حاول مرة ثانية وهزم البوت 💪'}</p>
        <div className="online-end-actions">
          <button onClick={()=>{if(mode==='online')clientRef.current?.requestRematch();else startBot();}}>لعب مرة ثانية</button>
          <button onClick={home}>الصفحة الرئيسية</button>
          <button onClick={closePage}>قفل الصفحة</button>
        </div>
      </div>
    </div>}
  </div>;
}
`;

fs.writeFileSync(path.join(gravityDest, 'src/App.tsx'), gravityApp);
fs.appendFileSync(path.join(snowballDest, 'src/index.css'), `
/* Keep Telegram's Mini App viewport fixed while aiming and dragging. */
html, body, #root { overscroll-behavior: none; }
.snowball-fullscreen-stage {
  position: fixed; inset: 0; z-index: 20; width: 100vw;
  height: 100dvh; min-height: 100dvh; overflow: hidden;
  overscroll-behavior: none; touch-action: none;
  -webkit-user-select: none; user-select: none;
}
.snowball-fullscreen-stage, .snowball-fullscreen-stage * { touch-action: none; -webkit-tap-highlight-color: transparent !important; -webkit-touch-callout: none; }
`);
fs.writeFileSync(path.join(snowballDest, 'src/App.tsx'), snowballApp);

for (const [dir, wsPath, gameType] of [[gravityDest, '/ws/gravity', 'gravity'], [snowballDest, '/ws/snowball', 'snowball']]) {
  const clientFile = path.join(dir, 'src/game/onlineClient.ts');
  const client = fs.readFileSync(clientFile, 'utf8');
  const oldUrl = "const url = `\${proto}//\${window.location.host}/ws`;";
  const newUrl = "const wsPath = window.location.pathname.startsWith('/snowball') ? '/ws/snowball' : '/ws/gravity';\n    const url = `\${proto}//\${window.location.host}\${wsPath}`;";
  if (!client.includes(oldUrl)) throw new Error('Could not patch WebSocket path in ' + clientFile);
  fs.writeFileSync(clientFile, client.replace(oldUrl, newUrl));

  const telegramFile = path.join(dir, 'src/game/telegram.ts');
  let telegram = fs.readFileSync(telegramFile, 'utf8');
  telegram = telegram.replace(
    "if (startParam.startsWith('room_')) {\n      const code = startParam.slice(5).trim().toUpperCase();\n      if (code) return code;\n    }",
    "for (const prefix of ['room_', 'gravity_', 'snowball_']) {\n      if (startParam.startsWith(prefix)) {\n        const code = startParam.slice(prefix.length).trim().toUpperCase();\n        if (code) return code;\n      }\n    }"
  );
  telegram = telegram.replace("if (room.startsWith('room_')) return room.slice(5).toUpperCase();", "for (const prefix of ['room_', 'gravity_', 'snowball_']) if (room.startsWith(prefix)) return room.slice(prefix.length).toUpperCase();");
  telegram = telegram.replace("openTelegramLink?: (url: string) => void;", "openTelegramLink?: (url: string) => void;\n  switchInlineQuery?: (query: string, types?: Array<'users'|'groups'|'channels'>) => void;");
  fs.writeFileSync(telegramFile, telegram);

  const serverFile = path.join(dir, 'server.ts');
  let server = fs.readFileSync(serverFile, 'utf8');
  const roomsMarker = "const rooms = new Map<string, GameRoom>();";
  const cleanup = gameType === 'gravity'
    ? [
      "const inlineRoomCreatedAt = new Map<string, number>();",
      "setInterval(() => {",
      "  const now = Date.now();",
      "  for (const [id, createdAt] of inlineRoomCreatedAt) {",
      "    const room = rooms.get(id);",
      "    if (!room || room.players.p1 || room.players.p2 || room.players.p3) { inlineRoomCreatedAt.delete(id); continue; }",
      "    if (now - createdAt > 30 * 60 * 1000) { rooms.delete(id); inlineRoomCreatedAt.delete(id); }",
      "  }",
      "}, 60_000).unref();"
    ].join('\n')
    : [
      "const inlineRoomCreatedAt = new Map<string, number>();",
      "setInterval(() => {",
      "  const now = Date.now();",
      "  for (const [id, createdAt] of inlineRoomCreatedAt) {",
      "    const room = rooms.get(id);",
      "    if (!room || room.players.p1 || room.players.p2) { inlineRoomCreatedAt.delete(id); continue; }",
      "    if (now - createdAt > 30 * 60 * 1000) { rooms.delete(id); inlineRoomCreatedAt.delete(id); }",
      "  }",
      "}, 60_000).unref();"
    ].join('\n');
  if (!server.includes(roomsMarker)) throw new Error('Could not add inline room cleanup in ' + serverFile);
  server = server.replace(roomsMarker, roomsMarker + '\n' + cleanup);
  const health = "  app.get('/api/health', (_req, res) => {\n    res.json({ ok: true, rooms: rooms.size });\n  });";
  const endpoint = gameType === 'gravity'
    ? [
      "  app.post('/api/internal/inline-room', (req, res) => {",
      "    if (!process.env.BOT_TOKEN || req.headers['x-bot-token'] !== process.env.BOT_TOKEN) return res.status(403).json({ ok: false, error: 'Forbidden' });",
      "    const roomId = generateRoomCode();",
      "    const setup = generateMatchSetup();",
      "    const room: GameRoom = { roomId, gameType: 'gravity', status: 'waiting', players: { p1: null, p2: null, p3: null }, terrain: setup.terrain, turn: 'p1', turnCount: 1, p1X: setup.p1X, p2X: setup.p2X, p1Hp: MAX_HP, p2Hp: MAX_HP, shotLocked: false, gravity: null, winner: null };",
      "    rooms.set(roomId, room);",
      "    inlineRoomCreatedAt.set(roomId, Date.now());",
      "    res.json({ ok: true, roomId });",
      "  });"
    ].join('\n')
    : [
      "  app.post('/api/internal/inline-room', (req, res) => {",
      "    if (!process.env.BOT_TOKEN || req.headers['x-bot-token'] !== process.env.BOT_TOKEN) return res.status(403).json({ ok: false, error: 'Forbidden' });",
      "    const roomId = generateRoomCode();",
      "    const setup = generateMatchSetup();",
      "    const room: GameRoom = { roomId, status: 'waiting', players: { p1: null, p2: null }, terrain: setup.terrain, turn: 'p1', turnCount: 1, p1X: setup.p1X, p2X: setup.p2X, p1Hp: MAX_HP, p2Hp: MAX_HP, winner: null, shotLocked: false };",
      "    rooms.set(roomId, room);",
      "    inlineRoomCreatedAt.set(roomId, Date.now());",
      "    res.json({ ok: true, roomId });",
      "  });"
    ].join('\n');
  if (!server.includes(health)) throw new Error('Could not find health route in ' + serverFile);
  server = server.replace(health, health + '\n\n' + endpoint);
  server = server.replace("new WebSocketServer({ server, path: '/ws' })", "new WebSocketServer({ server, path: '" + wsPath + "' })");

  if (gameType === 'gravity') {
    // The imported server source may differ slightly between archive revisions.
    // Keep the authoritative simulation at 60Hz and broadcast a snapshot every tick
    // instead of every other tick to avoid visible online movement stutter.
    server = server.replace(/g\.tickCounter % 2 === 0/g, 'g.tickCounter % 1 === 0');
  }
  fs.writeFileSync(serverFile, server);
}

fs.rmSync(temp, { recursive: true, force: true });
console.log('Imported Gravity Run, Snowball, and original Darts sources prepared.');
