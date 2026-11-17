export const ACTIONS = ['add', 'undo', 'newMatch', 'toggleBar'] as const;
export type Action = (typeof ACTIONS)[number];

export function isAction(value: unknown): value is Action {
  return ACTIONS.includes(value as Action);
}

/** Colour themes for the counter and settings; the colours themselves are in style.css. */
export const THEMES = ['dark', 'midnight', 'storm'] as const;
export type Theme = (typeof THEMES)[number];

export function isTheme(value: unknown): value is Theme {
  return THEMES.includes(value as Theme);
}

/**
 * What triggers each action: one keyboard shortcut (an Electron accelerator such as "F8" or "Ctrl+K")
 * and one controller chord (button numbers held together; empty = not set).
 */
export interface Settings {
  readonly keys: Readonly<Record<Action, string>>;
  readonly pad: Readonly<Record<Action, readonly number[]>>;
  /** How solid the counter's background is: 0 (no background, just shadowed numbers) to 1. */
  readonly opacity: number;
  /** Count chests by listening to the computer's sound. */
  readonly autoCount: boolean;
  /** 0 = fewest false alarms … 1 = catch the most chests. */
  readonly sensitivity: number;
  /** Show the last matches and the average under the counter. */
  readonly showHistory: boolean;
  readonly theme: Theme;
  /** Count only treasure hunt Battle Royale matches (the replay tells the mode): ranked, LTMs, Creative... are left out. */
  readonly onlyHuntMatches: boolean;
  /** Start with Windows, hidden, and show the counter while Fortnite runs. */
  readonly openWithFortnite: boolean;
  /** Windows notifications: a Treasure Hour is about to start, a treasure was found. */
  readonly notifications: boolean;
  /** A cat with earphones on the bar instead of 🎧. */
  readonly cat: boolean;
  /** Count chests from the "+XP CHEST" text on screen (the sound then counts only what the screen missed). */
  readonly screenCount: boolean;
  /** Count during matches at all (screen and sound); off, only the replays and your keys count. */
  readonly liveCount: boolean;
  /** Version of the saved settings, for one-time changes of a default (see readSettings). */
  readonly version: number;
}

export const DEFAULT_SETTINGS: Settings = {
  keys: { add: 'F8', undo: 'F7', newMatch: 'F9', toggleBar: 'Ctrl+Shift+O' },
  pad: { add: [], undo: [], newMatch: [], toggleBar: [] },
  opacity: 0.45,
  autoCount: true,
  sensitivity: 0.5,
  showHistory: true,
  theme: 'dark',
  onlyHuntMatches: true,
  openWithFortnite: true,
  notifications: true,
  cat: false,
  screenCount: true,
  liveCount: true,
  version: 2,
};

const isButton = (value: unknown): value is number => Number.isInteger(value) && (value as number) >= 0;

/** Sorted, no doubles: [5, 4, 5] → [4, 5]. */
function chord(buttons: readonly number[]): number[] {
  return [...new Set(buttons)].sort((a, b) => a - b);
}

/** Reads settings from stored JSON; anything missing or broken falls back to its default. */
export function readSettings(data: unknown): Settings {
  const stored = (data ?? {}) as { keys?: Record<string, unknown>; pad?: Record<string, unknown>; opacity?: unknown; autoCount?: unknown; sensitivity?: unknown; showHistory?: unknown; theme?: unknown; onlyHuntMatches?: unknown; openWithFortnite?: unknown; notifications?: unknown; cat?: unknown; screenCount?: unknown; liveCount?: unknown; version?: unknown };
  const keys = { ...DEFAULT_SETTINGS.keys };
  const pad: Record<Action, readonly number[]> = { ...DEFAULT_SETTINGS.pad };
  for (const action of ACTIONS) {
    const key = stored.keys?.[action];
    if (typeof key === 'string' && key !== '') keys[action] = key;
    const buttons = stored.pad?.[action];
    if (Array.isArray(buttons) && buttons.every(isButton)) pad[action] = chord(buttons);
  }
  const autoCount = typeof stored.autoCount === 'boolean' ? stored.autoCount : DEFAULT_SETTINGS.autoCount;
  const sensitivity =
    typeof stored.sensitivity === 'number' && stored.sensitivity >= 0 && stored.sensitivity <= 1 ? stored.sensitivity : DEFAULT_SETTINGS.sensitivity;
  const showHistory = typeof stored.showHistory === 'boolean' ? stored.showHistory : DEFAULT_SETTINGS.showHistory;
  const theme = isTheme(stored.theme) ? stored.theme : DEFAULT_SETTINGS.theme;
  const flag = (value: unknown, fallback: boolean): boolean => (typeof value === 'boolean' ? value : fallback);
  const onlyHuntMatches = flag(stored.onlyHuntMatches, DEFAULT_SETTINGS.onlyHuntMatches);
  const notifications = flag(stored.notifications, DEFAULT_SETTINGS.notifications);
  const cat = flag(stored.cat, DEFAULT_SETTINGS.cat);
  const screenCount = flag(stored.screenCount, DEFAULT_SETTINGS.screenCount);
  const liveCount = flag(stored.liveCount, DEFAULT_SETTINGS.liveCount);
  // version 2 turned "Open with Fortnite" on by default: settings saved before that get it turned on once
  const upToDate = stored.version === DEFAULT_SETTINGS.version;
  const openWithFortnite = upToDate ? flag(stored.openWithFortnite, DEFAULT_SETTINGS.openWithFortnite) : DEFAULT_SETTINGS.openWithFortnite;
  return withOpacity({ keys, pad, opacity: DEFAULT_SETTINGS.opacity, autoCount, sensitivity, showHistory, theme, onlyHuntMatches, openWithFortnite, notifications, cat, screenCount, liveCount, version: DEFAULT_SETTINGS.version }, stored.opacity);
}

/** The settings with a new background opacity, kept between 0 and 1. Anything that is not a number changes nothing. */
export function withOpacity(settings: Settings, opacity: unknown): Settings {
  if (typeof opacity !== 'number' || Number.isNaN(opacity)) {
    return settings;
  }
  return { ...settings, opacity: Math.min(1, Math.max(0, opacity)) };
}

/** The settings with a new key for `action`, or a message saying why not. */
export function withKey(settings: Settings, action: Action, accelerator: string): Settings | string {
  if (ACTIONS.some((other) => other !== action && settings.keys[other] === accelerator)) {
    return `${accelerator} is already used for another action.`;
  }
  return { ...settings, keys: { ...settings.keys, [action]: accelerator } };
}

/** The settings with a new controller chord for `action` (empty clears it), or a message saying why not. */
export function withPad(settings: Settings, action: Action, buttons: readonly number[]): Settings | string {
  const next = chord(buttons);
  const taken = ACTIONS.some((other) => other !== action && next.length > 0 && settings.pad[other].join() === next.join());
  if (taken) {
    return 'Those buttons are already used for another action.';
  }
  return { ...settings, pad: { ...settings.pad, [action]: next } };
}
