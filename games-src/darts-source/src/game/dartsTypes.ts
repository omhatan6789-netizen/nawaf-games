export type StartingScore = 200 | 300 | 350 | 501;

export type GameMode = 'bot' | 'local' | 'online';

export type Difficulty = 'easy' | 'medium' | 'hard';

export type AimSpeed = 'normal' | 'fast';

export type PlayerSide = 'red' | 'blue';

export type DartRing =
  | 'inner_bull'
  | 'outer_bull'
  | 'inner_single'
  | 'triple'
  | 'outer_single'
  | 'double'
  | 'miss';

export type TurnPhase =
  | 'countdown'
  | 'turn_intro'
  | 'aim_x'
  | 'aim_y'
  | 'flying'
  | 'impact_zoom'
  | 'finished';

export interface DartsSettings {
  startingScore: StartingScore;
  difficulty: Difficulty;
  aimSpeed: AimSpeed;
  haptics: boolean;
}

export interface HitResult {
  score: number;
  sector: number;
  multiplier: 0 | 1 | 2 | 3;
  ring: DartRing;
  labelAr: string;
  shortTag: string;
  isBust?: boolean;
  isCheckout?: boolean;
}

export interface RoundThrowRecord {
  round: number;
  side: PlayerSide;
  playerName: string;
  hitScore: number;
  shortTag: string;
  labelAr: string;
  remainingAfter: number;
  isBust: boolean;
  isCheckout: boolean;
  xNorm: number;
  yNorm: number;
}

export interface PinnedDart {
  side: PlayerSide;
  xNorm: number;
  yNorm: number;
  rotationRad: number;
}

export interface HudSnapshot {
  phase: TurnPhase;
  activeSide: PlayerSide;
  mySide: PlayerSide;
  mode: GameMode;
  redName: string;
  blueName: string;
  redScore: number;
  blueScore: number;
  startingScore: StartingScore;
  round: number;
  countdownValue: number;
  showHelp: boolean;
  canToggleHelp: boolean;
  lastHit: HitResult | null;
  winnerSide: PlayerSide | null;
  winnerName: string | null;
  endReason: 'checkout' | 'withdraw' | null;
  history: RoundThrowRecord[];
}
