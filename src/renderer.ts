// Runs inside the window. Plain script (no imports): it shows the state the app sends
// and reports clicks, key presses and controller buttons back through `window.chests`.
type ShownAction = 'add' | 'undo' | 'newMatch' | 'toggleBar';

interface ShownState {
  readonly counts: { readonly match: number; readonly session: number; readonly total: number };
  readonly view: 'counter' | 'settings';
  readonly keys: Readonly<Record<ShownAction, string>>;
  readonly padLabels: Readonly<Record<ShownAction, string>>;
  readonly capture: { readonly kind: 'key' | 'pad'; readonly action: ShownAction } | null;
  readonly message: string;
  readonly opacity: number;
  readonly autoCount: boolean;
  readonly sensitivity: number;
  readonly showHistory: boolean;
  readonly theme: string;
  readonly listening: string;
  readonly fortniteProblem: string;
  readonly heard: number;
  readonly replay: { readonly status: string; readonly chests?: number; readonly broken?: number; readonly heard?: number; readonly seen?: number; readonly reason?: string };
  readonly phase:'match' | 'lobby' | 'unknown';
  readonly history: { readonly last: readonly number[]; readonly average: number | null; readonly matches: number };
  readonly locked: boolean;
  readonly onlyHuntMatches: boolean;
  readonly notifications: boolean;
  readonly cat: boolean;
  readonly screenCount: boolean;
  readonly liveCount: boolean;
  readonly screenStatus: string;
  readonly seen: number;
  /** Where the "+XP CHEST" text shows, at 1080p, from the screen's centre. */
  readonly screenArea: { readonly left: number; readonly top: number; readonly width: number; readonly height: number };
  readonly obsFile: string;
  readonly update: { readonly current: string; readonly available: string | null; readonly status: 'idle' | 'downloading' | 'failed'; readonly canInstall: boolean; readonly progress: number };
  readonly replayFiles: { readonly count: number; readonly megabytes: number; readonly old: number; readonly oldMegabytes: number };
  readonly openWithFortnite: boolean;
  readonly stats: ShownStats;
}

interface ShownStats {
  readonly report: {
    readonly totalChests: number;
    readonly matches: number;
    readonly average: number | null;
    readonly best: number;
    readonly manualChests: number;
    readonly perDay: readonly (readonly [string, number])[];
    readonly kinds: Readonly<Record<string, number>>;
    readonly broken: number;
    readonly treasures: number;
    readonly chestsPerTreasure: number | null;
    readonly teamChests: number;
    readonly skipped: number;
  };
  readonly chances: readonly { readonly kind: string; readonly name: string; readonly weekly: boolean; readonly chests: number; readonly chance: number; readonly word: string; readonly oneIn: number }[];
  readonly week: { readonly number: number; readonly title: string; readonly endMs: number } | null;
  readonly hour: { readonly startMs: number; readonly endMs: number; readonly boosts: Readonly<Record<string, number>>; readonly active: boolean } | null;
  readonly collection: readonly {
    readonly number: number;
    readonly title: string;
    readonly current: boolean;
    readonly prizes: readonly { readonly id: string; readonly name: string; readonly kind: string; readonly found: boolean; readonly ticked: boolean; readonly image: string }[];
  }[];
  readonly pirateShop: { readonly name: string; readonly id: string; readonly image: string; readonly found: boolean; readonly ticked: boolean };
  readonly manual: readonly { readonly id: string; readonly chests: number; readonly addedMs: number; readonly kind: string; readonly careerMatches?: number }[];
  readonly treasures: number;
}

interface ChestsApi {
  state(): Promise<ShownState>;
  onState(show: (state: ShownState) => void): void;
  onCounted(show: (action: string, by: string) => void): void;
  onTab(open: (tab: string) => void): void;
  action(name: string): void;
  view(name: string): void;
  settingsTab(tab: string): void;
  lock(on: boolean): void;
  gearHover(over: boolean, gear?: { x: number; y: number; width: number; height: number }): void;
  barWidth(width: number): void;
  capture(kind: string, action: string): void;
  cancel(): void;
  key(press: { code: string; ctrl: boolean; alt: boolean; shift: boolean }): void;
  pad(pressed: number[]): void;
  clearPad(action: string): void;
  reset(): void;
  resetStats(): void;
  deleteOldReplays(): void;
  theme(name: string): void;
  addChests(chests: number): void;
  estimate(careerMatches: number): void;
  removeManual(id: string): void;
  tickPrize(id: string): void;
  onlyHunt(on: boolean): void;
  notifications(on: boolean): void;
  cat(on: boolean): void;
  screenCount(on: boolean): void;
  liveCount(on: boolean): void;
  screenStatus(status: string): void;
  screenFrame(pixels: Uint8ClampedArray): void;
  copyObsPath(): void;
  installUpdate(): void;
  openWithFortnite(on: boolean): void;
  opacity(value: number): void;
  autoCount(on: boolean): void;
  sensitivity(value: number): void;
  showHistory(on: boolean): void;
  audio(samples: Float32Array): void;
  quit(): void;
}

const app = (window as unknown as { chests: ChestsApi }).chests;
const byId = (id: string): HTMLElement => document.getElementById(id)!;
const input = (id: string): HTMLInputElement => byId(id) as HTMLInputElement;
const buttons = (attribute: string): HTMLButtonElement[] => [...document.querySelectorAll<HTMLButtonElement>(`[data-${attribute}]`)];
const setDot = (id: string, kind: 'on' | 'wait' | 'bad' | 'off'): void => {
  const dot = byId(id);
  dot.className = `dot ${kind === 'off' ? '' : kind}`;
  dot.parentElement!.dataset['state'] = kind; // the status line around the dot takes its colour
};
/** A small element with text, for building lines without HTML strings. */
const part = (text: string, className = '', tag = 'span'): HTMLElement => {
  const element = document.createElement(tag);
  element.textContent = text;
  element.className = className;
  return element;
};
/** One of the icons drawn in index.html (<symbol id="i-…">). */
const icon = (name: string): SVGSVGElement => {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.classList.add('i');
  const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
  use.setAttribute('href', `#i-${name}`);
  svg.append(use);
  return svg;
};
/** A slider's track is coloured up to its knob. */
const fill = (slider: HTMLInputElement): void => {
  const share = (Number(slider.value) - Number(slider.min)) / (Number(slider.max) - Number(slider.min));
  slider.style.setProperty('--fill', `${Math.round(share * 100)}%`);
};
const formatNumber = (n: number): string => n.toLocaleString('en-US');

let shown: ShownState | undefined;

// ---- Showing the state ----

function show(state: ShownState): void {
  shown = state;
  const body = document.body;
  body.dataset['view'] = state.view;
  body.classList.toggle('moving', !state.locked);
  body.classList.toggle('with-history', state.showHistory && state.history.last.length > 0);
  body.classList.toggle('cat', state.cat);
  body.style.setProperty('--alpha', String(state.opacity));
  body.dataset['theme'] = state.theme;
  buttons('theme-pick').forEach((button) => button.classList.toggle('picked', button.dataset['themePick'] === state.theme));

  for (const key of ['match', 'session', 'total'] as const) {
    byId(key).textContent = state.counts[key].toLocaleString('en-US');
  }
  showHistory(state);
  showSound(state);
  showControls(state);
  showStats(state);
  fitBar();

  input('opacity').value = String(Math.round(state.opacity * 100));
  fill(input('opacity'));
  byId('opacity-value').textContent = state.opacity === 0 ? 'None' : `${Math.round(state.opacity * 100)} %`;
  input('show-history').checked = state.showHistory;
  input('cat').checked = state.cat;
  input('live-count').checked = state.liveCount;
  // live counting off: its two ways are greyed out, and only the replays and your keys count
  byId('live-ways').classList.toggle('off', !state.liveCount);
  input('screen-count').disabled = !state.liveCount;
  input('auto-count').disabled = !state.liveCount;
  input('screen-count').checked = state.screenCount;
  readScreen(state.liveCount && state.screenCount && state.phase === 'match');
  byId('screen-status').textContent =
    !state.liveCount ? 'Off (live counting is off)'
    : !state.screenCount ? (state.autoCount ? 'Off: the sound counts alone' : 'Off: count with your keys or controller')
      : state.screenStatus === 'on' ? `Reading the screen · ${state.seen} seen`
        : state.phase !== 'match' ? 'Starts with the next match'
          : `Cannot read the screen: ${state.screenStatus}`;
  setDot('screen-dot', !state.liveCount || !state.screenCount ? 'off' : state.screenStatus === 'on' ? 'on' : state.phase !== 'match' ? 'wait' : 'bad');
  showLivePill(state);
  input('open-with-fortnite').checked = state.openWithFortnite;
  input('only-hunt').checked = state.onlyHuntMatches;
  input('notifications').checked = state.notifications;
  byId('obs-file').textContent = state.obsFile;
  const { update } = state;
  byId('app-version').textContent = `v${update.current}`;
  byId('update-status').textContent =
    update.status === 'downloading'
      ? `Downloading ${update.available}… ${update.progress}%. The app restarts by itself.`
      : update.status === 'failed'
        ? 'The download failed. Try again later.'
        : update.available
          ? `Version ${update.available} is out (you have ${update.current}).`
          : `Chest Counter ${update.current} · up to date`;
  byId('update-bar').hidden = update.status !== 'downloading';
  byId('update-fill').style.width = `${update.progress}%`;
  const installButton = byId('install-update') as HTMLButtonElement;
  installButton.hidden = !update.available || !update.canInstall;
  installButton.disabled = update.status === 'downloading';
  const files = state.replayFiles;
  byId('replay-files').textContent =
    files.count === 0 ? 'No replays on this PC yet.' : `${files.count} replay${files.count === 1 ? '' : 's'} · ${files.megabytes} MB on disk`;
  (byId('clean-replays') as HTMLButtonElement).disabled = files.old === 0 || state.replay.status === 'checking';
  input('lock').checked = state.locked;
  byId('message').textContent = state.message;
  byId('gear').style.color = state.message === '' ? '' : 'var(--bad)';
}

function showHistory(state: ShownState): void {
  const { last, average } = state.history;
  const avg = part('', 'avg');
  if (average !== null) avg.append(part('Avg ', 'label'), part(average.toFixed(1), '', 'b'));
  // the newest match first, a little brighter
  const matches = part(last.length === 0 ? 'no matches yet' : '');
  last.forEach((chests, index) => matches.append(...(index > 0 ? [' · '] : []), part(String(chests), index === 0 ? 'newest' : '')));
  byId('history-line').replaceChildren(part('Last', 'label'), matches, avg);
}

/** At the top of the settings: whether chests are being counted right now. */
function showLivePill(state: ShownState): void {
  const reading = state.screenCount && state.screenStatus === 'on';
  const listening = state.autoCount && state.listening === 'on';
  const counting = state.liveCount && state.phase === 'match' && (reading || listening);
  const pill = byId('live-pill');
  pill.textContent = !state.liveCount ? 'Live off' : counting ? 'Live' : state.phase === 'match' ? 'Not counting' : state.phase === 'lobby' ? 'Lobby' : 'Waiting';
  pill.title = !state.liveCount ? 'Live counting is off' : counting ? 'Counting chests in this match' : state.phase === 'lobby' ? 'In the lobby: nothing is counted' : '';
  pill.className = `pill ${!state.liveCount ? '' : counting ? 'on' : 'wait'}`;
}

/** Tells the app how wide the bar must be for its numbers: the widths of what is shown, the gaps and the padding. */
let askedWidth = 0;
function fitBar(): void {
  if (document.body.dataset['view'] !== 'counter') return;
  // measured with the icons beside the numbers (not pushed to the right edge), then put back: nothing is drawn between
  byId('counter').classList.add('measuring');
  try {
    measureBar();
  } finally {
    byId('counter').classList.remove('measuring');
  }
}

function measureBar(): void {
  const numbers = byId('counter').querySelector('.numbers') as HTMLElement;
  const cells = [...numbers.querySelectorAll<HTMLElement>(':scope > *, :scope > .stat > *')].filter((cell) => cell.offsetWidth > 0 && cell.id !== 'pops');
  const numbersWidth = Math.max(...cells.map((cell) => cell.getBoundingClientRect().right)) - numbers.getBoundingClientRect().left;
  const rows = [byId('history-line')];
  const needed = Math.max(
    numbersWidth,
    ...rows.map((rowElement) => {
      const shownParts = [...rowElement.children].filter((child) => (child as HTMLElement).offsetWidth > 0) as HTMLElement[];
      const gap = parseFloat(getComputedStyle(rowElement).columnGap) || 0;
      // fixed margins count; an automatic one (Avg is pushed right with margin-left: auto) would measure free space
      const margins = shownParts.reduce((sum, child) => {
        const style = getComputedStyle(child);
        const left = child.classList.contains('avg') ? 12 : parseFloat(style.marginLeft);
        return sum + left + parseFloat(style.marginRight);
      }, 0);
      return shownParts.reduce((sum, child) => sum + child.offsetWidth, 0) + gap * Math.max(0, shownParts.length - 1) + margins;
    }),
  );
  const counter = getComputedStyle(byId('counter'));
  const width = Math.ceil(needed + parseFloat(counter.paddingLeft) + parseFloat(counter.paddingRight) + 2);
  if (Math.abs(width - askedWidth) > 2) {
    askedWidth = width;
    app.barWidth(width);
  }
}

// ---- Stats tab ----

/** "Chests opened by squad": never exact, so it says "about" and explains why on hover. */
function squadRow(squad: number, teammates: number): HTMLElement {
  const line = row('Chests opened by squad (approx.)', `≈ ${formatNumber(squad)}`);
  line.title =
    `Your chests in counted matches + ${teammates} opened by teammates, as far as your replays recorded them. ` +
    'A teammate more than about 150 m away from you is not in your replays, so the real number is usually higher.';
  return line;
}

const KIND_SHORT: Readonly<Record<string, string>> = {
  outfit: 'Outfit',
  pickaxe: 'Pickaxe / back bling',
  car: 'Vehicle',
  jam: 'Jam Track',
  loading: 'Loading screen',
  'pirate-shop': 'Pirate Shop',
};

/** A row of prize tiles: picture, name, kind. Found in a replay = gold border and ✓; ticked by hand = ✓ only. */
function tiles(prizes: readonly { id: string; name: string; kind: string; found: boolean; ticked: boolean; image: string }[]): HTMLElement {
  const grid = part('', 'tiles', 'div');
  for (const prize of prizes) {
    const tile = part('', `tile${prize.found ? ' found' : prize.ticked ? ' ticked' : ''}`, 'button');
    tile.title = prize.found ? 'Found in a replay' : prize.ticked ? 'Ticked by hand (click to untick)' : 'Not found yet (click if you got it)';
    const picture = document.createElement('img');
    picture.alt = '';
    picture.loading = 'lazy';
    if (prize.image) {
      picture.src = prize.image;
      // the same pictures are kept in LED-N/Fortnite-ChestCounter, in case the first site is down
      const file = prize.image.split('/').pop()!.split('?')[0]!;
      picture.addEventListener('error', () => {
        if (!picture.src.includes('raw.githubusercontent.com')) picture.src = `https://raw.githubusercontent.com/LED-N/Fortnite-ChestCounter/main/assets/treasures/${file}`;
      }, { once: false });
    }
    tile.append(picture, part(prize.name, 'name'), part(KIND_SHORT[prize.kind] ?? prize.kind, 'kind'));
    if (prize.found || prize.ticked) {
      const check = part('', 'check');
      check.append(icon('check'));
      tile.append(check);
    }
    if (!prize.found) tile.addEventListener('click', () => app.tickPrize(prize.id));
    grid.append(tile);
  }
  return grid;
}

const dhm = (ms: number): string => {
  const minutes = Math.max(0, Math.round(ms / 60_000));
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  return days > 0 ? `${days}d ${hours}h` : hours > 0 ? `${hours}h ${minutes % 60}m` : `${minutes % 60}m`;
};
const percent = (chance: number): string =>
  chance >= 0.9995 ? '100 %' : chance < 0.0001 ? '<0.01 %' : `${(chance * 100).toLocaleString('en-US', { maximumSignificantDigits: 2 })} %`;
/** One row of a two-column table. */
const row = (label: string, value: string, className = ''): HTMLElement => {
  const line = part('', `table-row ${className}`, 'div');
  line.append(part(label), part(value, '', 'b'));
  return line;
};
const KIND_LABELS: Readonly<Record<string, string>> = { normal: 'Normal', rare: 'Rare', buried: 'Buried', spirit: 'Spirit (rare)', poster: 'Spirit posters', other: 'Other' };
/** Each kind of chest in a colour of its own, the same in every theme. */
const KIND_COLOURS: Readonly<Record<string, string>> = { normal: '#d9d4c7', rare: '#5aa9ff', spirit: '#b57bff', poster: '#ff7ac6', buried: '#c99a5b', other: '#7c8494' };

/** A big number of the report, with its name, an icon and a line under it. */
function kpi(name: string, iconName: string, value: string, below: string, main = false): HTMLElement {
  const tile = part('', `kpi${main ? ' main' : ''}`, 'div');
  const label = part('', 'k-label');
  label.append(icon(iconName), name);
  tile.append(label, part(value, '', 'b'), part(below, 'k-sub'));
  return tile;
}

/** The chests of the last 7 days, oldest on the left, a column each (days without matches stay low and grey). */
function lastDays(perDay: readonly (readonly [string, number])[]): HTMLElement[] {
  if (perDay.length === 0) return [];
  const byDay = new Map(perDay);
  const days = Array.from({ length: 7 }, (_, back) => {
    const date = new Date();
    date.setDate(date.getDate() - (6 - back));
    return { date, chests: byDay.get(date.toLocaleDateString('en-CA')) ?? 0 };
  });
  const most = Math.max(1, ...days.map((d) => d.chests));
  const columns = part('', 'columns', 'div');
  days.forEach(({ date, chests }, index) => {
    const day = part('', `day${chests === 0 ? ' none' : ''}${index === 6 ? ' today' : ''}`, 'div');
    const column = part('', 'column', 'div');
    column.style.setProperty('--h', `${Math.round((chests / most) * 100)}%`);
    day.title = `${date.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'short' })}: ${chests} chests`;
    day.append(part(String(chests), '', 'b'), column, part(index === 6 ? 'Today' : date.toLocaleDateString('en-US', { weekday: 'short' })));
    columns.append(day);
  });
  return [part('Last 7 days', 'sub', 'div'), columns];
}

function showStats(state: ShownState): void {
  const { stats } = state;
  const now = Date.now();
  byId('week-chip').textContent = stats.week ? `Week ${stats.week.number}` : '';
  byId('week-title').textContent = stats.week ? stats.week.title : 'Treasure hunt';
  // times in the player's own time zone and clock style (whatever Windows is set to)
  const when = (ms: number): string => new Date(ms).toLocaleString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' });
  byId('week-ends').replaceChildren(icon('clock'), stats.week ? `New prizes ${when(stats.week.endMs)} · in ${dhm(stats.week.endMs - now)}` : 'No treasure week right now.');
  const hour = stats.hour;
  const banner = byId('hour-banner');
  if (!hour) {
    banner.replaceChildren();
  } else {
    const live = hour.startMs <= now;
    const head = part('', 'when', 'div');
    head.append(icon('bolt'), live ? `Treasure Hour now · ${dhm(hour.endMs - now)} left` : `Next Treasure Hour ${when(hour.startMs)}`);
    const boosts = part('', 'boosts', 'div');
    for (const [kind, times] of Object.entries(hour.boosts)) boosts.append(part(`${KIND_SHORT[kind] ?? kind} ×${times}`, 'chip'));
    banner.replaceChildren(head, part(live ? `Until ${when(hour.endMs)}: chests count at boosted odds.` : `In ${dhm(hour.startMs - now)}. Boosted odds:`, 'hint'), boosts);
  }
  banner.classList.toggle('on', !!hour && hour.startMs <= now);

  byId('chances').replaceChildren(
    ...stats.chances.map((c) => {
      const line = part('', `chance${c.chance >= 0.5 ? ' likely' : ''}`, 'div');
      line.title = `1 in ${formatNumber(c.oneIn)} per chest · ${c.chests} chests ${c.weekly ? 'this week' : 'in the hunt'}`;
      const meter = part('', 'meter', 'div');
      const filled = part('', '', 'i');
      filled.style.setProperty('--w', `${Math.min(100, c.chance * 100)}%`);
      meter.append(filled);
      line.append(part(c.name), part(c.word, 'word'), part(percent(c.chance), '', 'b'), meter);
      return line;
    }),
  );

  const weeks = [...stats.collection].sort((a, b) => Number(b.current) - Number(a.current) || b.number - a.number);
  const pirate = stats.pirateShop;
  const weekHead = (title: string, prizes: readonly { found: boolean; ticked: boolean }[], now = false): HTMLElement => {
    const head = part('', 'week-head', 'div');
    const got = prizes.filter((p) => p.found || p.ticked).length;
    head.append(part(title), ...(now ? [part('Now', 'chip')] : []), part(`${got} / ${prizes.length}`, 'found-count'));
    return head;
  };
  byId('collection').replaceChildren(
    weekHead('Whole hunt', [pirate]),
    tiles([{ id: pirate.id, name: pirate.name, kind: 'pirate-shop', found: pirate.found, ticked: pirate.ticked, image: pirate.image }]),
    ...weeks.flatMap((week) => [weekHead(`Week ${week.number} · ${week.title}`, week.prizes, week.current), tiles(week.prizes)]),
  );

  const r = stats.report;
  byId('kpis').replaceChildren(
    kpi('Chests in total', 'chest', formatNumber(r.totalChests), r.manualChests !== 0 ? `${formatNumber(r.manualChests)} added by hand` : 'in counted matches', true),
    kpi('Matches', 'flag', formatNumber(r.matches), r.skipped > 0 ? `+ ${r.skipped} in other modes` : 'counted'),
    kpi('Per match', 'stats', r.average === null ? '–' : r.average.toFixed(1), 'on average'),
    kpi('Best match', 'trophy', String(r.best), 'chests'),
    kpi('Treasures', 'gem', String(r.treasures), r.chestsPerTreasure === null ? 'none found yet' : `1 every ${Math.round(r.chestsPerTreasure)} chests`),
  );

  const kinds = Object.entries(r.kinds).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]);
  if (kinds.length === 0) {
    byId('kinds').replaceChildren();
  } else {
    const bar = part('', 'kinds-bar', 'div');
    const legend = part('', 'legend', 'div');
    for (const [kind, n] of kinds) {
      const colour = KIND_COLOURS[kind] ?? KIND_COLOURS['other']!;
      const piece = part('', '', 'i');
      piece.style.setProperty('--n', String(n));
      piece.style.setProperty('--c', colour);
      piece.title = `${KIND_LABELS[kind] ?? kind}: ${n}`;
      bar.append(piece);
      const entry = part(KIND_LABELS[kind] ?? kind);
      entry.style.setProperty('--c', colour);
      entry.append(part(formatNumber(n), '', 'b'));
      legend.append(entry);
    }
    byId('kinds').replaceChildren(part('Chest kinds', 'sub', 'div'), bar, legend);
  }
  byId('report').replaceChildren(
    // broken chests count like opened ones, but give no "+XP CHEST" and make no opening sound: the live count misses them
    ...(r.broken > 0 ? [row('Broken, not opened (counted)', formatNumber(r.broken))] : []),
    // your chests in counted matches + the teammates' chests your replays recorded; teammates far away are missing
    squadRow(r.totalChests - r.manualChests + r.teamChests, r.teamChests),
    ...(r.manualChests !== 0 ? [row('Added by hand', formatNumber(r.manualChests))] : []),
    ...(r.skipped > 0 ? [row('Other modes (not counted)', String(r.skipped))] : []),
  );
  byId('days').replaceChildren(...lastDays(r.perDay));

  byId('manual').replaceChildren(
    ...stats.manual.map((entry) => {
      const line = part('', 'table-row', 'div');
      const label = entry.kind === 'estimate' ? `Estimate (${entry.careerMatches} matches)` : new Date(entry.addedMs).toLocaleDateString('en-CA');
      const remove = part('', 'icon', 'button');
      remove.append(icon('close'));
      remove.title = 'Take it back';
      remove.addEventListener('click', () => app.removeManual(entry.id));
      line.append(part(label), part(`${entry.chests > 0 ? '+' : ''}${formatNumber(entry.chests)}`, '', 'b'), remove);
      return line;
    }),
  );
}

function showSound(state: ShownState): void {
  input('auto-count').checked = state.autoCount;
  input('sensitivity').closest<HTMLElement>('.slider')!.hidden = !state.autoCount; // only means something while it listens

  const paused = state.listening === 'on' && state.phase === 'lobby';
  const ear = state.listening === 'on' ? (paused ? 'wait' : 'on') : state.listening === 'waiting' ? 'wait' : 'off';
  const reading = state.liveCount && state.screenCount && state.screenStatus === 'on';
  // the icon on the bar shows what counts (an eye: the screen, earphones: the sound); the dot under it is green while
  // chests are counted by themselves, red otherwise
  byId('ear').className = `ear ${ear === 'on' || reading ? 'on' : 'off'}${reading ? ' by-screen' : ''}`;
  setDot('sound-dot', !state.liveCount ? 'off' : ear);
  byId('ear').title = reading
    ? 'Counting from the screen, and by sound what it missed'
    : paused ? 'In the lobby: not counting' : ear === 'on' ? 'Counting by sound' : 'Not counting';
  byId('sound-status').textContent =
    !state.liveCount
      ? 'Off (live counting is off)'
      : state.listening === 'off'
      ? (state.screenCount ? 'Off: the screen counts alone' : 'Off: count with your keys or controller')
      : state.listening === 'waiting'
        ? 'Waiting for Fortnite to start'
        : state.listening === 'on'
          ? `Listening · ${state.heard} heard`
          : 'This PC cannot hear Fortnite on its own';
  byId('fortnite-problem').textContent =
    state.fortniteProblem === '' ? '' : `Windows said: ${state.fortniteProblem}. The app never listens to the whole PC.`;

  const { replay } = state;
  setDot('replay-dot', replay.status === 'done' || replay.status === 'skipped' ? 'on' : replay.status === 'checking' ? 'wait' : replay.status === 'off' ? 'off' : 'bad');
  // a match could not be checked: say so on the bar too, as the count may be off
  const replayProblem = replay.status === 'missing' || replay.status === 'failed';
  byId('replay-warning').hidden = !replayProblem;
  byId('replay-warning').title =
    replay.status === 'missing' ? 'No replay of the last match: turn on Record Replays in Fortnite (Settings → Game → Replays)' : 'The replay of the last match could not be read';
  const seen = replay.seen ?? 0;
  const kept = replay.status === 'done' && seen > (replay.chests ?? 0); // the replay lost chests: the screen's number stays
  byId('replay-status').textContent = replay.status === 'checking'
      ? 'Reading the replay of the last match…'
      : replay.status === 'done'
        ? kept ? `Kept the screen's count: the replay lost some` : 'Last match read from its replay'
        : replay.status === 'missing'
          ? 'No replay found. Turn on Record Replays in Fortnite.'
          : replay.status === 'skipped'
            ? `Not counted: ${replay.reason || 'not a treasure hunt match'}`
          : replay.status === 'failed'
            ? `Could not read the replay: ${replay.reason}`
            : 'Waiting for a match to finish';
  showReplaySummary(replay, kept);

  const sensitivity = Math.round(state.sensitivity * 100);
  input('sensitivity').value = String(sensitivity);
  fill(input('sensitivity'));
  byId('sensitivity-value').textContent = sensitivity === 50 ? 'Normal' : sensitivity < 50 ? 'Strict' : 'Eager';
}

/** The last match in the Replays card: its count, big, and what made it up. */
function showReplaySummary(replay: ShownState['replay'], kept: boolean): void {
  const box = byId('replay-summary');
  box.hidden = (replay.status !== 'done' && replay.status !== 'skipped') || replay.chests === undefined;
  if (box.hidden) return;
  const big = part('', 'big', 'div');
  big.append(part(String(kept ? replay.seen : replay.chests), '', 'b'), part(replay.status === 'skipped' ? 'not counted' : 'chests'));
  const fact = (iconName: string, n: number, words: string): HTMLElement => {
    const chip = part('', 'fact');
    chip.append(icon(iconName), part(String(n), '', 'b'), ` ${words}`);
    return chip;
  };
  const facts = part('', 'facts', 'div');
  facts.append(
    ...(replay.broken ? [fact('warning', replay.broken, 'broken')] : []),
    fact('eye', replay.seen ?? 0, 'on screen'),
    fact('headphones', replay.heard ?? 0, 'heard'),
    ...(kept ? [part(`The replay had only ${replay.chests}.`, 'note')] : []),
  );
  const side = part('', '', 'div');
  side.append(part('Last match', 'sub', 'div'), facts);
  box.replaceChildren(big, side);
}

function showControls(state: ShownState): void {
  const capturing = (kind: string, action: string): boolean => state.capture?.kind === kind && state.capture.action === action;
  for (const button of buttons('key')) {
    const action = button.dataset['key'] as ShownAction;
    button.textContent = capturing('key', action) ? 'Press a key…' : state.keys[action];
    button.classList.toggle('listening', capturing('key', action));
  }
  for (const button of buttons('pad')) {
    const action = button.dataset['pad'] as ShownAction;
    button.textContent = capturing('pad', action) ? 'Press button(s)…' : state.padLabels[action];
    button.classList.toggle('listening', capturing('pad', action));
  }
}

// ---- "+1 🎧" when a chest is counted ----

const ICONS: Readonly<Record<string, string>> = { sound: 'headphones', screen: 'eye', key: 'keyboard', pad: 'gamepad', hand: 'mouse' };

app.onCounted((action, by) => {
  if (action !== 'add' && action !== 'undo') return;
  const cat = (by === 'sound' || by === 'screen') && document.body.classList.contains('cat'); // cat mode: the cat found it
  const pop = part(action === 'add' ? '+1' : '−1', `pop ${action === 'undo' ? 'minus' : ''}`);
  if (cat) {
    const picture = document.createElement('img');
    picture.src = 'assets/ear-cat.png';
    picture.className = 'pop-cat';
    picture.alt = '';
    pop.append(picture);
  } else if (ICONS[by]) {
    pop.append(icon(ICONS[by]));
  }
  byId('pops').append(pop);
  pop.addEventListener('animationend', () => pop.remove());
  if (action === 'add') {
    const match = byId('match');
    match.classList.add('flash');
    setTimeout(() => match.classList.remove('flash'), 350);
  }
});

app.onState(show);
void app.state().then(show);

// ---- Settings ----

const openTab = (tab: string): void => {
  document.body.dataset['tab'] = tab;
  app.settingsTab(tab); // the Stats tab gets a bigger window
};
app.onTab(openTab);
buttons('tab').forEach((button) => button.addEventListener('click', () => openTab(button.dataset['tab']!)));

byId('quit').addEventListener('click', () => app.quit());
byId('done').addEventListener('click', () => app.lock(true));
byId('gear').addEventListener('click', () => {
  app.gearHover(false);
  app.view('settings');
});
byId('gear').addEventListener('mouseenter', () => {
  // where ⚙ is in the window, so the app can tell for itself when the pointer leaves it
  const { x, y, width, height } = byId('gear').getBoundingClientRect();
  app.gearHover(true, { x, y, width, height });
});
byId('gear').addEventListener('mouseleave', () => app.gearHover(false));
byId('back').addEventListener('click', () => app.view('counter'));
byId('reset').addEventListener('click', () => app.reset());
buttons('theme-pick').forEach((button) => button.addEventListener('click', () => app.theme(button.dataset['themePick']!)));

// Anything that removes data asks first, in a dialog of its own; Cancel has the focus, so Enter or Esc never removes anything.
const confirmBox = byId('confirm');
let onConfirm: (() => void) | undefined;
const closeConfirm = (): void => {
  confirmBox.hidden = true;
  onConfirm = undefined;
};
function askFirst(title: string, text: string, yes: string, then: () => void): void {
  byId('confirm-title').textContent = title;
  byId('confirm-text').textContent = text;
  byId('confirm-yes').textContent = yes;
  onConfirm = then;
  confirmBox.hidden = false;
  byId('confirm-cancel').focus();
}
byId('reset-stats').addEventListener('click', () => {
  const { counts, history } = shown!;
  askFirst(
    'Reset all stats?',
    `Match, Session and Total (${counts.total.toLocaleString('en-US')} chests) go back to 0 and the history of ` +
      `${history.matches} ${history.matches === 1 ? 'match is' : 'matches is'} deleted. This cannot be undone.`,
    'Reset',
    () => app.resetStats(),
  );
});
byId('clean-replays').addEventListener('click', () => {
  const files = shown!.replayFiles;
  askFirst(
    'Clean up older replays?',
    `${files.old} older replay${files.old === 1 ? '' : 's'} (${files.oldMegabytes} MB) go to the Recycle Bin. ` +
      'The newest one stays, and replays you saved in Fortnite under a name of your own are never touched. ' +
      'Their matches are already counted.',
    'Move to Recycle Bin',
    () => app.deleteOldReplays(),
  );
});
byId('confirm-cancel').addEventListener('click', closeConfirm);
byId('confirm-yes').addEventListener('click', () => {
  onConfirm?.();
  closeConfirm();
});
confirmBox.addEventListener('click', (event) => {
  if (event.target === confirmBox) closeConfirm(); // a click outside the dialog
});
window.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && !confirmBox.hidden) closeConfirm();
});
input('opacity').addEventListener('input', () => app.opacity(Number(input('opacity').value) / 100));
input('sensitivity').addEventListener('input', () => fill(input('sensitivity'))); // the colour follows the knob at once
input('sensitivity').addEventListener('change', () => app.sensitivity(Number(input('sensitivity').value) / 100));
input('auto-count').addEventListener('change', () => app.autoCount(input('auto-count').checked));
input('show-history').addEventListener('change', () => app.showHistory(input('show-history').checked));
input('cat').addEventListener('change', () => app.cat(input('cat').checked));
input('screen-count').addEventListener('change', () => app.screenCount(input('screen-count').checked));
input('live-count').addEventListener('change', () => app.liveCount(input('live-count').checked));
input('open-with-fortnite').addEventListener('change', () => app.openWithFortnite(input('open-with-fortnite').checked));
input('only-hunt').addEventListener('change', () => app.onlyHunt(input('only-hunt').checked));
input('notifications').addEventListener('change', () => app.notifications(input('notifications').checked));
byId('install-update').addEventListener('click', () => app.installUpdate());
byId('copy-obs').addEventListener('click', () => {
  app.copyObsPath();
  byId('copy-obs').textContent = 'Copied ✓';
  setTimeout(() => (byId('copy-obs').textContent = 'Copy path'), 1500);
});

byId('add-chests-go').addEventListener('click', () => {
  const chests = Math.trunc(Number(input('add-chests').value));
  if (chests !== 0 && Number.isFinite(chests)) app.addChests(chests);
  input('add-chests').value = '';
});
byId('estimate-go').addEventListener('click', () => {
  const matches = Math.trunc(Number(input('career-matches').value));
  if (matches > 0) app.estimate(matches);
  input('career-matches').value = '';
});
// countdowns in the Stats tab stay current
setInterval(() => {
  if (shown !== undefined) showStats(shown);
}, 30_000);
input('lock').addEventListener('change', () => app.lock(input('lock').checked));
buttons('action').forEach((button) => button.addEventListener('click', () => app.action(button.dataset['action']!)));
buttons('clear').forEach((button) => button.addEventListener('click', () => app.clearPad(button.dataset['clear']!)));

// Clicking a binding starts listening for it; clicking it again stops.
for (const kind of ['key', 'pad'] as const) {
  buttons(kind).forEach((button) =>
    button.addEventListener('click', () => {
      const action = button.dataset[kind]!;
      if (shown?.capture?.kind === kind && shown.capture.action === action) {
        app.cancel();
      } else {
        app.capture(kind, action);
      }
      button.blur();
    }),
  );
}

window.addEventListener('keydown', (event) => {
  if (shown?.capture?.kind === 'key') {
    event.preventDefault();
    app.key({ code: event.code, ctrl: event.ctrlKey, alt: event.altKey, shift: event.shiftKey });
  }
});

// ---- Controller: it has no button events, so look at it 30 times a second ----

let lastPressed = '';
let lastPadName: string | undefined;
setInterval(() => {
  const pad = navigator.getGamepads().find((candidate) => candidate?.connected);
  // the page is only touched when something changed: each change has the window redrawn over the game
  const padName = pad ? pad.id.replace(/\s*\(.*\)\s*$/, '') : '';
  if (padName !== lastPadName) {
    lastPadName = padName;
    setDot('pad-dot', pad ? 'on' : 'off');
    byId('pad-status').textContent = pad ? padName : 'No controller found. Press any button on it.';
  }
  const pressed = pad ? pad.buttons.flatMap((button, index) => (button.pressed ? [index] : [])) : [];
  if (pressed.join() !== lastPressed) {
    lastPressed = pressed.join();
    app.pad(pressed);
  }
}, 33);


// ---- Reading the "+XP CHEST" text off the screen, during matches only ----

/** Five looks a second at the XP area right of the crosshair; the picture is looked at and dropped, never kept. */
const SCREEN_EVERY_MS = 200;
// Chromium has it, the DOM types not yet: hands over the stream's frames one by one.
declare const MediaStreamTrackProcessor: new (init: { track: MediaStreamTrack }) => { readable: ReadableStream<VideoFrame> };
let screenStream: MediaStream | undefined;
let screenReader: ReadableStreamDefaultReader<VideoFrame> | undefined;
let latestFrame: VideoFrame | undefined;
let screenTimer: number | undefined;
let screenStarting = false;
let looking = false;
let darkFrames = 0;
// only for a screen that is not 1080p: the area is scaled to 1080p size through these
const nativeCanvas = document.createElement('canvas');
const screenCanvas = document.createElement('canvas');
const screenContext = screenCanvas.getContext('2d', { willReadFrequently: true })!;

function readScreen(on: boolean): void {
  if (on && screenStream === undefined && !screenStarting) void startScreen();
  if (!on && screenStream !== undefined) stopScreen();
}

async function startScreen(): Promise<void> {
  screenStarting = true;
  try {
    const stream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: { max: 5 } }, audio: false });
    screenStream = stream;
    const reader = new MediaStreamTrackProcessor({ track: stream.getVideoTracks()[0]! }).readable.getReader();
    screenReader = reader;
    void keepLatestFrame(reader);
    darkFrames = 0;
    screenTimer = window.setInterval(() => void lookAtScreen(), SCREEN_EVERY_MS);
    app.screenStatus('on');
  } catch (error) {
    app.screenStatus(error instanceof Error ? error.message : String(error));
  } finally {
    screenStarting = false;
  }
}

/** Keeps only the newest frame of the screen (the others are let go at once). */
async function keepLatestFrame(reader: ReadableStreamDefaultReader<VideoFrame>): Promise<void> {
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) return;
      if (reader !== screenReader) {
        value.close();
        return;
      }
      latestFrame?.close();
      latestFrame = value;
    }
  } catch {
    // stopped
  }
}

function stopScreen(): void {
  window.clearInterval(screenTimer);
  void screenReader?.cancel().catch(() => undefined);
  screenReader = undefined;
  latestFrame?.close();
  latestFrame = undefined;
  screenStream?.getTracks().forEach((track) => track.stop());
  screenStream = undefined;
  app.screenStatus('off');
}

/**
 * The XP area's pixels at 1080p size. Only that small area is copied out of the frame (copying the whole screen out
 * of the graphics card each time cost about three times more CPU).
 */
async function areaPixels(frame: VideoFrame, area: { left: number; top: number; width: number; height: number }): Promise<Uint8ClampedArray> {
  const width = frame.displayWidth;
  const height = frame.displayHeight;
  // the HUD scales with the screen's height: the area is given at 1080p; the frame's colours come in pairs of pixels
  const scale = height / 1080;
  const even = (n: number, most: number): number => Math.min(most, Math.max(0, Math.round(n / 2) * 2));
  const x = even(width / 2 + area.left * scale, width - 2);
  const y = even(height / 2 + area.top * scale, height - 2);
  const rect = { x, y, width: even(area.width * scale, width - x), height: even(area.height * scale, height - y) };
  const native = new Uint8ClampedArray(rect.width * rect.height * 4);
  await frame.copyTo(native, { rect, format: 'RGBA' } as VideoFrameCopyToOptions);
  if (rect.width === area.width && rect.height === area.height) return native;
  if (nativeCanvas.width !== rect.width) nativeCanvas.width = rect.width; // setting a size clears the canvas: only on change
  if (nativeCanvas.height !== rect.height) nativeCanvas.height = rect.height;
  if (screenCanvas.width !== area.width) screenCanvas.width = area.width;
  if (screenCanvas.height !== area.height) screenCanvas.height = area.height;
  nativeCanvas.getContext('2d')!.putImageData(new ImageData(native, rect.width, rect.height), 0, 0);
  screenContext.drawImage(nativeCanvas, 0, 0, area.width, area.height);
  return screenContext.getImageData(0, 0, area.width, area.height).data;
}

async function lookAtScreen(): Promise<void> {
  const AREA = shown?.screenArea;
  if (looking || latestFrame === undefined || AREA === undefined) return;
  looking = true;
  const frame = latestFrame.clone(); // the newest may be let go while this one is copied
  let pixels: Uint8ClampedArray;
  try {
    pixels = await areaPixels(frame, AREA);
  } catch {
    return;
  } finally {
    frame.close();
    looking = false;
  }
  // all black for a while: exclusive fullscreen, where Windows gives no picture of the game
  let lit = 0;
  for (let i = 0; i < pixels.length; i += 64) if (pixels[i]! + pixels[i + 1]! + pixels[i + 2]! > 30) lit++;
  darkFrames = lit === 0 ? darkFrames + 1 : 0;
  if (darkFrames === 50) app.screenStatus('the game is not visible (play in Windowed Fullscreen)');
  if (darkFrames === 0 && shown?.screenStatus !== 'on') app.screenStatus('on');
  if (darkFrames !== 0) return;
  // the "+XP" text has a purple edge: a frame without any (nearly every one) is not sent to be looked at
  let purple = 0;
  for (let i = 0; i < pixels.length && purple < 15; i += 4) {
    const r = pixels[i]!, g = pixels[i + 1]!, b = pixels[i + 2]!;
    if (r > 150 && b > 170 && g < r - 40 && !(r > 200 && g > 190 && b > 200)) purple++;
  }
  if (purple >= 15) app.screenFrame(pixels); // the app looks for the word CHEST in it
}
