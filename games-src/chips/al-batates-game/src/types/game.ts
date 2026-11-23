export type Screen = 'home' | 'online_lobby' | 'playing';

export type GameMode = 'bot' | 'online';

export type Difficulty = 'easy' | 'medium' | 'hard';

export type GamePhase =
  | 'PREP'
  | 'COUNTDOWN'
  | 'PLAYING'
  | 'REVEALING_BOMBS'
  | 'GAME_OVER';

export type TurnOwner = 'PLAYER' | 'BOT' | 'OPPONENT';

export type CellStatus =
  | 'CHIP'
  | 'SAFE_EATEN'
  | 'EXPLODING_BOMB'
  | 'EXPLODING_SMOKE'
  | 'BOMB_CHARRED'
  | 'BOMB_REVEALED';

export interface TrayCell {
  index: number;
  hasBomb: boolean;
  status: CellStatus;
}

export interface PotatoSettings {
  difficulty: Difficulty;
  soundEnabled: boolean;
  haptics: boolean;
}

export interface LobbyPlayerInfo {
  slot: 0 | 1;
  name: string;
  connected: boolean;
}

export const GRID_SIZE = 9;
export const BOMB_COUNT = 3;
export const MAX_HEARTS = 3;
export const PREP_DURATION_SEC = 25;
export const TURN_DURATION_SEC = 15;
export const REVEAL_DURATION_SEC = 3;

export const DIFFICULTY_META: Record<
  Difficulty,
  { label: string; hint: string }
> = {
  easy: {
    label: 'سهل',
    hint: 'البوت يختار بتهور وفرصتك للفوز أعلى',
  },
  medium: {
    label: 'متوسط',
    hint: 'تحدي متوازن وتوزيع ذكي للقنابل',
  },
  hard: {
    label: 'صعب',
    hint: 'البوت حذر جداً ويتفادى القنابل بذكاء',
  },
};
