import { app, BrowserWindow, clipboard, desktopCapturer, globalShortcut, ipcMain, Menu, nativeImage, Notification, screen, session, shell, Tray } from 'electron';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { ChestCounter, type Counts } from './counter';
import { chances, findPrize, hourToAnnounce, kindName, loadContent, nextTreasureHour, refreshContent, weekAt, type Chance } from './content';
import { AREA, ChestTextWatcher, chestsShown, textMask } from './chest-text';
import { ChestDetector } from './detector';
import { FortniteWatch } from './fortnite-watch';
import { GameAudio } from './game-audio';
import { MatchHistory } from './history';
import { isModifierKey, toAccelerator, type KeyPress } from './keys';
import { MatchLog, type MatchEvent } from './match-log';
import { MatchTracker, type MatchPhase } from './match-tracker';
import { oldReplays, ReplayReader, replayStartMs, type ReplayResult } from './replays';
import { hourSplit, Records, type ManualEntry, type MatchRecord, type Report } from './records';
import { obsPage } from './obs';
import { download, newerRelease, replaceAndRestart, type Release } from './updater';
import { appFile } from './paths';
import { ChordWatcher, chordLabel } from './pad';
import { defaultPlace, grow, savedPlace } from './placement';
import { ACTIONS, DEFAULT_SETTINGS, isAction, isTheme, readSettings, THEMES, withKey, withOpacity, withPad, type Action, type Settings } from './settings';

type View = 'counter' | 'settings';
/** The bar's width at start; it then grows or shrinks to fit its numbers (see 'bar-width'). */
const BAR_WIDTH = 340;
const BAR_HEIGHT = { plain: 62, withHistory: 82, moving: 30 } as const;
/** Settings: a narrow panel, or a big window for the Stats tab (cards side by side, the collection with pictures). */
const SETTINGS_SIZE = [310, 580] as const;
const STATS_SIZE = [800, 680] as const;

/** What counted a chest, so the bar can show it. */
export type CountedBy = 'sound' | 'screen' | 'key' | 'pad' | 'hand';

/** A binding the user is choosing right now; `buttons` collects the controller buttons held so far. */
interface Capture {
  readonly kind: 'key' | 'pad';
  readonly action: Action;
  buttons: number[];
}

/** Everything the window shows. */
export interface AppState {
  readonly counts: Counts;
  readonly view: View;
  readonly keys: Settings['keys'];
  readonly padLabels: Readonly<Record<Action, string>>;
  readonly capture: { readonly kind: 'key' | 'pad'; readonly action: Action } | null;
  readonly message: string;
  readonly opacity: number;
  readonly autoCount: boolean;
  readonly sensitivity: number;
  readonly showHistory: boolean;
  readonly theme: Settings['theme'];
  /** 'on', 'off', 'waiting' (for Fortnite to start), or why it cannot listen. */
  readonly listening: string;
  /** Fortnite-only listening is not possible on this PC, and why. */
  readonly fortniteProblem: string;
  /** Chests counted by sound since the app was started. */
  readonly heard: number;
  /**
   * Replay check of the last finished match: 'off', 'checking', 'done' (with replay and sound counts),
   * 'missing' (no replay: recording is off in Fortnite) or 'failed' (with the reason).
   */
  readonly replay: { readonly status: string; readonly chests?: number; readonly broken?: number; readonly heard?: number; readonly seen?: number; readonly reason?: string };
  readonly onlyHuntMatches: boolean;
  readonly notifications: boolean;
  readonly cat: boolean;
  readonly screenCount: boolean;
  readonly liveCount: boolean;
  /** Reading the screen: 'on', 'off', or why it cannot. */
  readonly screenStatus: string;
  /** Chests seen on screen since the app was started. */
  readonly seen: number;
  readonly screenArea: typeof AREA;
  /** This version, and a newer one on GitHub if there is one. */
  readonly update: { readonly current: string; readonly available: string | null; readonly status: 'idle' | 'downloading' | 'failed'; readonly canInstall: boolean; readonly progress: number };
  /** Where the page for OBS is written. */
  readonly obsFile: string;
  /** Replays on disk, and the older ones that may be moved to the Recycle Bin. */
  readonly replayFiles: { readonly count: number; readonly megabytes: number; readonly old: number; readonly oldMegabytes: number };
  readonly openWithFortnite: boolean;
  readonly stats: Stats;
  readonly phase: MatchPhase;
  /** Chests in the last matches (newest first) and per match on average. */
  readonly history: { readonly last: readonly number[]; readonly average: number | null; readonly matches: number };
  /** Locked: the bar stays where it is and the mouse goes through it to the game. Unlocked: it can be dragged. */
  readonly locked: boolean;
}

/** Everything the Stats tab and the ★ on the bar show. */
export interface Stats {
  readonly report: Report;
  readonly chances: readonly Chance[];
  readonly week: { readonly number: number; readonly title: string; readonly endMs: number } | null;
  readonly hour: { readonly startMs: number; readonly endMs: number; readonly boosts: Readonly<Record<string, number>>; readonly active: boolean } | null;
  readonly collection: readonly {
    readonly number: number;
    readonly title: string;
    readonly current: boolean;
    readonly prizes: readonly { readonly id: string; readonly name: string; readonly kind: string; readonly found: boolean; readonly ticked: boolean; readonly image: string }[];
  }[];
  readonly pirateShop: { readonly name: string; readonly id: string; readonly image: string; readonly found: boolean; readonly ticked: boolean };
  readonly manual: readonly ManualEntry[];
  readonly treasures: number;
  readonly lastMatch: MatchRecord | null;
}

/** The app's icon for the tray (made from build/icon.png; see the README). */
function trayIcon(): Electron.NativeImage {
  return nativeImage.createFromPath(join(__dirname, '..', 'build', 'tray.png'));
}

/** Set to a file path to run a self-check: counts a few chests, saves pictures there and quits. */
const selfCheck = process.env['CHEST_SELF_CHECK'];

function dataFile(name: string): string {
  return selfCheck === undefined ? join(app.getPath('userData'), name) : `${selfCheck}.${name}`;
}

function readJson(name: string): unknown {
  try {
    return JSON.parse(readFileSync(dataFile(name), 'utf8'));
  } catch {
    return undefined; // first run
  }
}

function loadTotal(): number {
  const total = (readJson('total.json') as { total?: unknown } | undefined)?.total;
  return typeof total === 'number' && Number.isSafeInteger(total) && total >= 0 ? total : 0;
}

// Chrome stops drawing windows it believes are covered. A see-through, click-through overlay can be judged
// "covered" by mistake and then stays empty, so that check is switched off.
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');

// The data folder is %APPDATA%chest-counter whether it runs from the source or installed (the installed app has a
// different name), so totals, history and settings carry over.
app.setPath('userData', join(app.getPath('appData'), 'chest-counter'));

/** The ChestCounter.exe the player started (only for the packaged app; the update replaces this file). */
const runningExe = process.env['PORTABLE_EXECUTABLE_FILE'];
let newer: Release | undefined;
let updateStatus: 'idle' | 'downloading' | 'failed' = 'idle';
let updatePercent = 0; // of the download, while downloading

// A second copy could not get the shortcuts and would keep its own total: only one may run.
if (selfCheck === undefined && !app.requestSingleInstanceLock()) {
  app.quit();
}

void app.whenReady().then(() => {
  Menu.setApplicationMenu(null); // the default menu would grab keys like Ctrl+R

  let counter = new ChestCounter(loadTotal());
  let history = new MatchHistory(readJson('history.json'));
  let records = new Records(readJson('records.json'));
  /** Prizes ticked by hand in the collection (found outside the replays). */
  const ticked = new Set<string>(Array.isArray(readJson('ticked.json')) ? (readJson('ticked.json') as string[]) : []);
  // the treasure hunt data: the bundled copy, replaced by a newer one from LED-N/Fortnite-ChestCounter if there is one
  let content = loadContent(join(__dirname, '..', 'content', 'content.json'), dataFile('content.json'));
  if (selfCheck === undefined) {
    void refreshContent('https://raw.githubusercontent.com/LED-N/Fortnite-ChestCounter/main/content/content.json', content, dataFile('content.json')).then((fresh) => {
      content = fresh;
      push();
    });
  }
  const watcher = new ChordWatcher();
  let settings = readSettings(readJson('settings.json'));
  let view: View = 'counter';
  let capture: Capture | undefined;
  let message = '';
  let gameDetector = new ChestDetector(24000, settings.sensitivity); // for Fortnite's own sound
  let heard = 0;
  const audioCheck = { chunks: 0, loudest: 0, heardAt: [] as number[] };

  const saveSettings = (): void => writeFileSync(dataFile('settings.json'), JSON.stringify(settings));

  // The app never hears the whole PC (Discord, music, browser...): only Fortnite's own sound, see GameAudio below.

  // while unlocked, the Lock row is added below: the bar grows down only, its numbers stay where they are
  const barHeight = (): number =>
    (settings.showHistory && history.matches > 0 ? BAR_HEIGHT.withHistory : BAR_HEIGHT.plain) + (locked ? 0 : BAR_HEIGHT.moving);
  const screens = (): Electron.Rectangle[] => screen.getAllDisplays().map((display) => display.bounds);
  const savedPosition = readJson('position.json') as { locked?: unknown } | undefined;
  let locked = savedPosition?.locked !== false;
  const startAt = savedPlace(savedPosition, screens(), BAR_WIDTH, barHeight()) ??
    defaultPlace(screen.getPrimaryDisplay().bounds, BAR_WIDTH);

  const window = new BrowserWindow({
    ...startAt,
    width: BAR_WIDTH,
    height: barHeight(),
    show: false,
    focusable: false, // clicking the game must never hand the keyboard to the counter
    skipTaskbar: true,
    frame: false,
    resizable: false,
    maximizable: false,
    transparent: true, // the page draws its own see-through background
    hasShadow: false,
    // keep reading the controller while the game has the focus
    webPreferences: { preload: join(__dirname, 'preload.js'), backgroundThrottling: false },
  });
  // 'screen-saver' keeps the window above a game in windowed-fullscreen mode
  window.setAlwaysOnTop(true, 'screen-saver');
  window.setIgnoreMouseEvents(true, { forward: true }); // the mouse goes through to the game (see takeMouse)
  window.once('ready-to-show', () => {
    // started by Windows: there, but see-through until Fortnite runs (the window itself is never hidden, see hideBar)
    if (process.argv.includes('--standby')) {
      hideBar();
      window.showInactive();
    } else {
      showBar();
    }
  });
  void window.loadFile(join(__dirname, '..', 'index.html'));

  // If the page or the graphics process crashes, a see-through window is left empty: draw the page again.
  // The counts live here in the main process, so nothing is lost.
  const redraw = (): void => {
    if (!window.isDestroyed()) setTimeout(() => window.webContents.reload(), 1000);
  };
  window.webContents.on('render-process-gone', redraw);
  app.on('child-process-gone', (_event, details) => {
    if (details.type === 'GPU') redraw();
  });

  const state = (): AppState => ({
    counts: counter.counts(),
    view,
    keys: settings.keys,
    padLabels: { add: chordLabel(settings.pad.add), undo: chordLabel(settings.pad.undo), newMatch: chordLabel(settings.pad.newMatch), toggleBar: chordLabel(settings.pad.toggleBar) },
    capture: capture === undefined ? null : { kind: capture.kind, action: capture.action },
    message,
    opacity: settings.opacity,
    autoCount: settings.autoCount,
    sensitivity: settings.sensitivity,
    showHistory: settings.showHistory,
    theme: settings.theme,
    listening: listening(),
    fortniteProblem: gameAudio.status === 'unsupported' ? gameAudio.problem || 'not supported' : '',
    heard,
    replay,
    onlyHuntMatches: settings.onlyHuntMatches,
    notifications: settings.notifications,
    cat: settings.cat,
    screenCount: settings.screenCount,
    liveCount: settings.liveCount,
    screenStatus,
    seen,
    screenArea: AREA,
    update: { current: app.getVersion(), available: newer?.version ?? null, status: updateStatus, canInstall: runningExe !== undefined, progress: updatePercent },
    obsFile: dataFile('overlay.html'),
    replayFiles: (() => {
      const all = replays.files().filter((file) => file.name.toLowerCase().endsWith('.replay'));
      const old = oldReplays(all);
      const mb = (files: readonly { bytes: number }[]): number => Math.round(files.reduce((sum, file) => sum + file.bytes, 0) / 1_048_576);
      return { count: all.length, megabytes: mb(all), old: old.length, oldMegabytes: mb(old) };
    })(),
    openWithFortnite: settings.openWithFortnite,
    stats: stats(),
    phase: matches.phase,
    history: { last: history.last(5), average: history.average() ?? null, matches: history.matches },
    locked,
  });
  let obsShown = '';
  const push = (): void => {
    if (window.isDestroyed()) return; // closing: the sound helper still says it stopped
    // the bar gets taller once there is a match to show on its second row
    if (view === 'counter' && window.getBounds().height !== barHeight()) resize();
    window.webContents.send('state', state());
    // the page for OBS: rewritten only when its numbers change
    const page = obsPage({ counts: counter.counts(), last: history.last(5) });
    if (page !== obsShown) {
      obsShown = page;
      try {
        writeFileSync(dataFile('overlay.html'), page);
      } catch {
        // the data folder is not writable: OBS just keeps the last page
      }
    }
  };

  /** A Windows notification, if the player has them on. */
  const notify = (title: string, body: string): void => {
    if (settings.notifications && Notification.isSupported()) new Notification({ title, body, silent: false }).show();
  };

  const stats = (): Stats => {
    const now = Date.now();
    const found = records.foundPrizeIds();
    const week = weekAt(content, now);
    const hour = nextTreasureHour(content, now);
    return {
      report: records.report(content, now),
      chances: chances(content, records.chestGroups(), now),
      week: week === undefined ? null : { number: week.number, title: week.title, endMs: Date.parse(week.end) },
      hour:
        hour === undefined
          ? null
          : { startMs: Date.parse(hour.start), endMs: Date.parse(hour.end), boosts: hour.boosts, active: Date.parse(hour.start) <= now },
      collection: content.weeks
        .filter((w) => Date.parse(w.start) <= now)
        .map((w) => ({
          number: w.number,
          title: w.title,
          current: week?.number === w.number,
          prizes: w.prizes.map((p) => ({
            id: p.id,
            name: p.name,
            kind: p.kind,
            found: p.prizeIds.some((id) => found.has(id)),
            image: p.image ?? '',
            ticked: ticked.has(p.id),
          })),
        })),
      pirateShop: { name: content.pirateShop.name, id: content.pirateShop.id, image: content.pirateShop.image ?? '', found: content.pirateShop.prizeIds.some((id) => found.has(id)), ticked: ticked.has(content.pirateShop.id) },
      manual: records.manualEntries(),
      treasures: records.treasuresCount(content),
      lastMatch: records.last() ?? null,
    };
  };

  const matches = new MatchTracker(
    () => counter,
    () => history,
  );
  const saveCounts = (): void => {
    writeFileSync(dataFile('total.json'), JSON.stringify({ total: counter.total }));
    writeFileSync(dataFile('history.json'), JSON.stringify(history));
    writeFileSync(dataFile('records.json'), JSON.stringify(records));
  };

  const run = (action: Action, by: CountedBy): void => {
    if (action === 'toggleBar') {
      // show / hide the bar (only the bar: settings stay as they are)
      if (view === 'counter') {
        // hidden by hand: "Open with Fortnite" must not bring it back while the game runs
        closedByHand = !barHidden;
        if (barHidden) showBar();
        else hideBar();
      }
      return;
    }
    if (action === 'add') counter.add(1);
    if (action === 'undo') counter.add(-1);
    if (action === 'newMatch') matches.newMatchByHand();
    saveCounts();
    window.webContents.send('counted', action, by);
    push();
  };

  const heardChest = (at: number): void => {
    if (matches.phase === 'lobby') return; // lobby music, not a chest
    audioCheck.heardAt.push(Math.round(at * 10) / 10);
    heard++;
    if (!readingScreen()) {
      run('add', 'sound');
      return;
    }
    // While the screen is read, its "+XP CHEST" text counts first. The sound counts a chest only if the screen saw
    // none from 1 s before to 3 s after it (the text shows about a second after the sound): 73 of 87 chests in tests,
    // against 68 by screen alone and 51 by sound alone.
    push();
    const heardMs = Date.now();
    setTimeout(() => {
      const seenNear = seenAtMs.some((ms) => ms >= heardMs - SOUND_AFTER_SCREEN.beforeMs && ms <= heardMs + SOUND_AFTER_SCREEN.afterMs);
      if (!seenNear && readingScreen() && matches.phase !== 'lobby') run('add', 'sound');
    }, SOUND_AFTER_SCREEN.afterMs);
  };

  // The window reads the "+XP CHEST" text off the screen during matches (src/chest-text.ts) and says when it sees it.
  let screenStatus = 'off';
  let seen = 0;
  const seenAtMs: number[] = []; // when the last chests were seen on screen
  const SOUND_AFTER_SCREEN = { beforeMs: 1000, afterMs: 3000 } as const;
  const readingScreen = (): boolean => settings.liveCount && settings.screenCount && screenStatus === 'on';
  ipcMain.on('screen-status', (_event, status: unknown) => {
    if (typeof status !== 'string' || status === screenStatus) return;
    screenStatus = status;
    push();
  });
  const textWatcher = new ChestTextWatcher();
  ipcMain.on('screen-frame', (_event, pixels: unknown) => {
    if (!(pixels instanceof Uint8Array || pixels instanceof Uint8ClampedArray) || pixels.length !== AREA.width * AREA.height * 4) return;
    if (!settings.liveCount || !settings.screenCount || matches.phase === 'lobby') return;
    // chests opened one after another are listed together ("RARE CHEST X2", "SPRITE CHEST"): each one counts
    const shown = chestsShown(textMask(pixels, AREA.width, AREA.height), AREA.width, AREA.height);
    for (let opened = textWatcher.push(shown, Date.now()); opened > 0; opened--) {
      seen++;
      seenAtMs.push(Date.now());
      if (seenAtMs.length > 20) seenAtMs.shift(); // only the last few seconds matter
      run('add', 'screen');
    }
  });
  // The window asks for the screen the bar is on (a picture only, no sound); only the XP area is looked at, and no
  // picture is ever kept or sent anywhere.
  session.defaultSession.setDisplayMediaRequestHandler((_request, answer) => {
    const display = screen.getDisplayMatching(window.getBounds());
    void desktopCapturer.getSources({ types: ['screen'] }).then((sources) => {
      const source = sources.find((s) => s.display_id === String(display.id)) ?? sources[0];
      if (source) answer({ video: source });
      else answer({});
    });
  });

  // Fortnite's log says when a match starts and when the player is back in the lobby.
  // After each match, Fortnite's replay of it gives the exact count: it replaces what was counted live. Only when the
  // screen saw more chests opened than the replay has, the screen's number stays: at busy moments Fortnite's replay
  // recorder falls behind ("Frames Over Budget" in its log) and loses who opened what, so the replay can miss chests.
  // Replays are required: without one the sound's count stays, and the bar says replays are off.
  const replays = new ReplayReader(appFile('replay-reader', 'bin', 'chest-replay.exe'), process.env['CHEST_REPLAYS']);
  let replay: AppState['replay'] = { status: 'off' };
  let matchStartMs = Date.now();
  let seenAtMatchStart = 0; // chests seen on screen before this match
  /** A finished match as the replay tells it. */
  const fromReplay = (result: ReplayResult, heardThisMatch: number, seenThisMatch: number, loggedStartMs: number, endedMs: number): MatchRecord => {
    const startMs = replayStartMs(result) ?? loggedStartMs;
    return {
      endedMs,
      startMs,
      chests: Math.max(result.chests ?? 0, seenThisMatch),
      heard: heardThisMatch,
      fromReplay: true,
      ...(result.mode ? { mode: result.mode } : {}),
      counted: !settings.onlyHuntMatches || result.counts !== false,
      kinds: result.kinds ?? {},
      broken: result.destroyed ?? 0,
      treasures: (result.treasures ?? []).map((t) => ({ ...(t.prizeId ? { prizeId: t.prizeId } : {}), ...(t.item ? { item: t.item } : {}), golden: t.golden })),
      teamChests: result.teamChests ?? 0,
      ...hourSplit(content, startMs, result.chestSeconds ?? []),
    };
  };

  /** Reads the replay of the match that ran from `startMs` to `endMs` and puts its exact numbers in place of the sound's. */
  const checkReplay = async (startMs: number, endMs: number, seenThisMatch: number): Promise<void> => {
    const heardThisMatch = history.last(1)[0] ?? 0;
    replay = { status: 'checking' };
    push();
    const result = await replays.readMatch(startMs, endMs);
    if (result?.ok && typeof result.chests === 'number') {
      const record = fromReplay(result, heardThisMatch, seenThisMatch, startMs, endMs);
      if (!record.counted) {
        // not a treasure hunt match: out of the totals, kept in the list
        counter.correctFinishedMatch(-history.removeLast());
      } else {
        counter.correctFinishedMatch(history.correctLast(record.chests));
      }
      records.replaceLast(record);
      saveCounts();
      const found = record.counted ? (record.treasures ?? []) : [];
      if (found.length > 0) {
        const names = found.map((t) => (t.prizeId ? findPrize(content, t.prizeId)?.prize.name : undefined) ?? t.item ?? 'a treasure');
        notify('Treasure found!', `Last match: ${names.join(', ')}`);
      }
      replay = { status: record.counted ? 'done' : 'skipped', chests: result.chests, broken: result.destroyed ?? 0, heard: heardThisMatch, seen: seenThisMatch, reason: result.mode ?? '' };
    } else if (result === undefined) {
      replay = { status: 'missing' };
    } else {
      replay = { status: 'failed', reason: result.error ?? 'unknown' };
    }
    push();
  };

  const onMatchEvent = (event: MatchEvent): void => {
    const wasInMatch = matches.phase === 'match';
    const endedStartMs = matchStartMs;
    const now = Date.now();
    const seenThisMatch = seen - seenAtMatchStart;
    if (matches.onEvent(event)) {
      seenAtMatchStart = seen;
      gameDetector = new ChestDetector(24000, settings.sensitivity); // forget anything half-heard in the lobby
      matchStartMs = now;
    }
    // a match just ended: back in the lobby, or a new match started straight away (the tracker has recorded it);
    // keep what the sound counted until its replay says better
    if (wasInMatch) {
      const heardThisMatch = history.last(1)[0] ?? 0;
      records.add({ endedMs: now, startMs: endedStartMs, chests: heardThisMatch, heard: heardThisMatch, fromReplay: false, counted: true });
      void checkReplay(endedStartMs, now, seenThisMatch);
    }
    saveCounts();
    push();
  };
  const matchLog = new MatchLog(onMatchEvent, process.env['CHEST_GAME_LOG']);
  matchLog.start();

  // Only Fortnite's sound. Where Windows cannot give one program's sound, counting by sound stays off (keys still work).
  const gameAudio = new GameAudio(
    (samples) => {
      audioCheck.chunks++;
      audioCheck.loudest = Math.max(audioCheck.loudest, ...samples.map(Math.abs));
      gameDetector.push(samples).forEach((chest) => heardChest(chest.at));
    },
    () => {
      if (gameAudio.status === 'on') gameDetector = new ChestDetector(24000, settings.sensitivity); // fresh for every game run
      push();
    },
  );
  const listening = (): string => {
    if (!settings.liveCount || !settings.autoCount) return 'off';
    if (gameAudio.status === 'unsupported') return 'unsupported';
    return gameAudio.status === 'on' ? 'on' : 'waiting';
  };
  const updateGameAudio = (): void => {
    if (settings.liveCount && settings.autoCount) gameAudio.start();
    else gameAudio.stop();
    push();
  };

  /** Registers the three keys system-wide, so they work while the game has the focus. Returns false if one failed. */
  const registerKeys = (): boolean => {
    globalShortcut.unregisterAll();
    return ACTIONS.map((action) => {
      try {
        return globalShortcut.register(settings.keys[action], () => run(action, 'key'));
      } catch {
        return false; // not a valid shortcut
      }
    }).every(Boolean);
  };

  const endCapture = (text = ''): void => {
    capture = undefined;
    message = text;
    registerKeys();
    push();
  };

  /** Switches to new settings and saves them, or shows the message that says why not. */
  const apply = (next: Settings | string): void => {
    if (typeof next === 'string') {
      endCapture(next);
      return;
    }
    const previous = settings;
    settings = next;
    if (!registerKeys() && next.keys !== previous.keys) {
      settings = previous;
      endCapture('That shortcut is taken by another program. Try another one.');
      return;
    }
    saveSettings();
    endCapture();
  };

  /** Where the counter bar sits; settings open from there and the bar goes back there. */
  let barAt = startAt;
  let barWidth = BAR_WIDTH;
  let statsOpen = false;
  const saveBarPlace = (): void => {
    barAt = { x: window.getBounds().x, y: window.getBounds().y };
    writeFileSync(dataFile('position.json'), JSON.stringify({ ...barAt, locked }));
  };

  /**
   * The bar takes the mouse only while its position is unlocked; settings always take it.
   * Otherwise the mouse goes through to the game, but the window still hears where it is ("forward"),
   * so the ⚙ button can take the mouse for as long as the pointer is on it.
   */
  const takeMouse = (on: boolean): void => {
    window.setIgnoreMouseEvents(!on, { forward: true });
    window.setFocusable(on);
    if (on) window.focus();
  };

  /**
   * Hiding the bar makes it see-through with the mouse going straight through, instead of hiding the window: after a
   * real hide and show, Windows no longer handed clicks on ⚙ to it (seen after Ctrl+Shift+O).
   */
  let barHidden = false;
  const hideBar = (): void => {
    barHidden = true;
    window.setOpacity(0);
    window.setIgnoreMouseEvents(true);
  };
  /** Shows the window (and the bar) without taking the game's focus. */
  const showBar = (): void => {
    barHidden = false;
    window.setOpacity(1);
    if (!window.isVisible()) window.showInactive();
    if (view === 'counter' && locked) window.setIgnoreMouseEvents(true, { forward: true });
    else takeMouse(true);
  };

  const resize = (): void => {
    const [width, height] = view === 'counter' ? [barWidth, barHeight()] : statsOpen ? STATS_SIZE : SETTINGS_SIZE;
    const bar = { ...barAt, width: barWidth, height: barHeight() };
    const at = view === 'counter' ? barAt : grow(bar, width, height, screen.getDisplayMatching(bar).bounds);
    window.setResizable(true); // Windows ignores setBounds on a fixed-size window
    window.setBounds({ ...at, width, height });
    window.setResizable(false);
  };

  const show = (next: View): void => {
    if (next === view) return;
    if (view === 'counter') saveBarPlace();
    view = next;
    if (next === 'settings') void checkForUpdate(); // so "up to date" is never hours old
    if (barHidden) {
      // settings opened while the bar was hidden: they must be seen
      barHidden = false;
      window.setOpacity(1);
    }
    resize();
    takeMouse(next === 'settings' || !locked);
    endCapture();
  };

  // The bar lets the mouse through, so it is also reached from the tray icon next to the clock.
  const tray = new Tray(trayIcon());
  const setLocked = (lock: boolean): void => {
    locked = lock;
    if (view === 'counter') {
      takeMouse(!lock);
      saveBarPlace();
    } else {
      writeFileSync(dataFile('position.json'), JSON.stringify({ ...barAt, locked }));
    }
    tray.setContextMenu(trayMenu());
    push();
  };
  const trayMenu = (): Menu =>
    Menu.buildFromTemplate([
      { label: 'Settings', click: () => show('settings') },
      { label: 'Lock position', type: 'checkbox', checked: locked, click: (item) => setLocked(item.checked) },
      {
        label: 'Put counter back under the minimap',
        click: () => {
          if (view === 'settings') show('counter');
          window.setPosition(...(Object.values(defaultPlace(screen.getPrimaryDisplay().bounds, BAR_WIDTH)) as [number, number]));
          saveBarPlace();
        },
      },
      { type: 'separator' },
      // the only real exit: after it, nothing opens the counter with Fortnite until it is started by hand or Windows restarts
      { label: 'Quit completely', click: () => app.quit() },
    ]);
  tray.setToolTip('Chest Counter');
  tray.setContextMenu(trayMenu());
  tray.on('click', () => show(view === 'settings' ? 'counter' : 'settings'));

  if (!registerKeys()) {
    message = 'A shortcut is taken by another program. Pick another one in settings.';
  }
  app.on('second-instance', () => {
    window.showInactive();
    show('settings'); // settings take the mouse anyway
  });

  // "Open with Fortnite": starts with Windows (hidden, --standby) and shows the counter only while the game runs.
  const standby = process.argv.includes('--standby');
  let closedByHand = false; // hidden with × or Ctrl+Shift+O: stays hidden until shown again or the game restarts
  const watch = new FortniteWatch((visible) => {
    if (view === 'settings') return; // never hide settings the player is using
    if (!visible) closedByHand = false;
    if (visible && !closedByHand && barHidden) showBar();
    if (!visible && !barHidden) hideBar();
  });
  const applyOpenWithFortnite = (): void => {
    if (selfCheck !== undefined) return;
    const on = settings.openWithFortnite;
    app.setLoginItemSettings({
      openAtLogin: on && app.isPackaged,
      path: runningExe ?? process.execPath,
      args: app.isPackaged ? ['--standby'] : [app.getAppPath(), '--standby'],
    });
    if (on) watch.start();
    else watch.stop();
  };
  applyOpenWithFortnite();

  // Updates: the app looks for a newer ChestCounter.exe on GitHub Releases at start, every hour and when the settings
  // open (at most once a minute), and says so. It used to look every 6 hours, so a running app said "up to date" too long.
  // "Update" in the settings downloads it, closes the app, swaps the exe and starts the new one.
  let checkedAt = 0;
  const checkForUpdate = async (): Promise<void> => {
    if (selfCheck !== undefined || Date.now() - checkedAt < 60_000) return;
    checkedAt = Date.now();
    const found = await newerRelease(app.getVersion());
    if (found && found.version !== newer?.version) {
      newer = found;
      notify('Chest Counter update', `Version ${found.version} is ready: Settings → Display → Update.`);
      push();
    }
  };
  if (selfCheck === undefined) {
    void checkForUpdate();
    setInterval(() => void checkForUpdate(), 3_600_000);
  }
  ipcMain.on('install-update', () => {
    if (newer === undefined || runningExe === undefined || updateStatus === 'downloading') return;
    updateStatus = 'downloading';
    updatePercent = 0;
    push();
    download(newer, (done) => {
      // the window is told only when the whole percent changes, not for every piece that arrives
      const percent = Math.floor(done * 100);
      if (percent === updatePercent) return;
      updatePercent = percent;
      push();
    })
      .then((file) => {
        replaceAndRestart(file, runningExe);
        app.quit();
      })
      .catch(() => {
        updateStatus = 'failed';
        push();
      });
  });

  // Five minutes before a Treasure Hour: a Windows notification (once per Treasure Hour).
  const announced = new Set<string>(Array.isArray(readJson('announced.json')) ? (readJson('announced.json') as string[]) : []);
  setInterval(() => {
    const hour = hourToAnnounce(content, Date.now(), announced);
    if (hour === undefined) return;
    announced.add(hour.start);
    writeFileSync(dataFile('announced.json'), JSON.stringify([...announced]));
    const boosts = Object.entries(hour.boosts).map(([kind, times]) => `${kindName(kind)} ×${times}`).join(', ');
    notify('Treasure Hour in 5 minutes', `Boosted odds: ${boosts}`);
  }, 30_000);
  // started hidden by Windows, but the option was turned off since: just show the counter
  if (standby && !settings.openWithFortnite) window.once('ready-to-show', () => showBar());
  updateGameAudio();
  app.on('will-quit', () => {
    gameAudio.stop();
    matchLog.stop();
  });

  ipcMain.handle('state', () => state());
  // × on the bar: with "Open with Fortnite" the app only hides until the game's next start (it stays next to the clock)
  ipcMain.on('quit', () => {
    if (!settings.openWithFortnite) {
      app.quit();
      return;
    }
    closedByHand = true;
    hideBar();
  });
  ipcMain.on('action', (_event, action: unknown) => {
    if (isAction(action)) run(action, 'hand');
  });
  ipcMain.on('lock', (_event, lock: unknown) => {
    if (typeof lock === 'boolean') setLocked(lock);
  });
  // while unlocked, every drag is remembered at once
  window.on('moved', () => {
    if (view === 'counter' && !locked) saveBarPlace();
  });
  // the Stats tab opens in a bigger window than the other tabs
  ipcMain.on('settings-tab', (_event, tab: unknown) => {
    const stats = tab === 'stats';
    if (stats === statsOpen) return;
    statsOpen = stats;
    if (view === 'settings') resize();
  });
  // The window measured what its numbers need (a total of 5,000 is wider than 50): the bar grows or shrinks to it,
  // keeping its right edge where it is, so ⚙ never slides off.
  ipcMain.on('bar-width', (_event, wanted: unknown) => {
    if (typeof wanted !== 'number' || !Number.isFinite(wanted)) return;
    const width = Math.round(Math.min(900, Math.max(300, wanted)));
    if (width === barWidth) return;
    if (view === 'counter') barAt = { x: window.getBounds().x + window.getBounds().width - width, y: window.getBounds().y };
    else barAt = { x: barAt.x + barWidth - width, y: barAt.y };
    barWidth = width;
    if (view === 'counter') resize();
    writeFileSync(dataFile('position.json'), JSON.stringify({ ...barAt, locked }));
  });
  // the pointer entered or left ⚙ on the bar: let only that button catch the click, without taking the keyboard
  // Windows can report the pointer leaving ⚙ when it did not (it did after Ctrl+Shift+O hid and showed the bar), and the
  // click then went to the game. So once the pointer is over ⚙, where it really is gets checked instead.
  let gearWatch: NodeJS.Timeout | undefined;
  const stopGearWatch = (): void => {
    clearInterval(gearWatch);
    gearWatch = undefined;
  };
  ipcMain.on('gear-hover', (_event, over: unknown, gear: unknown) => {
    if (view !== 'counter' || !locked) return;
    if (over !== true) {
      if (gearWatch === undefined) window.setIgnoreMouseEvents(true, { forward: true });
      return;
    }
    const box = gear as { x?: unknown; y?: unknown; width?: unknown; height?: unknown } | null;
    if (typeof box?.x !== 'number' || typeof box.y !== 'number' || typeof box.width !== 'number' || typeof box.height !== 'number') return;
    const { x, y, width, height } = box as { x: number; y: number; width: number; height: number };
    window.setIgnoreMouseEvents(false);
    stopGearWatch();
    gearWatch = setInterval(() => {
      if (view !== 'counter' || !locked) {
        stopGearWatch(); // settings opened or the bar was unlocked: they take the mouse themselves
        return;
      }
      const pointer = screen.getCursorScreenPoint();
      const bar = window.getBounds();
      const left = bar.x + x - 2;
      const top = bar.y + y - 2;
      const over = pointer.x >= left && pointer.x <= left + width + 4 && pointer.y >= top && pointer.y <= top + height + 4;
      if (!over || barHidden) {
        stopGearWatch();
        window.setIgnoreMouseEvents(true, { forward: true });
      }
    }, 100);
  });
  ipcMain.on('view', (_event, next: unknown) => {
    if (next === 'counter' || next === 'settings') show(next);
  });
  ipcMain.on('capture', (_event, kind: unknown, action: unknown) => {
    if ((kind !== 'key' && kind !== 'pad') || !isAction(action)) return;
    capture = { kind, action, buttons: [] };
    message = '';
    if (kind === 'key') globalShortcut.unregisterAll(); // or the current shortcuts would never reach the window
    push();
  });
  ipcMain.on('cancel', () => endCapture());
  ipcMain.on('key', (_event, press: KeyPress) => {
    if (capture?.kind !== 'key' || isModifierKey(press.code)) return;
    if (press.code === 'Escape') {
      endCapture();
      return;
    }
    const accelerator = toAccelerator(press);
    if (accelerator === undefined) {
      message = 'That key cannot be used as a shortcut. Try another one.';
      push();
      return;
    }
    apply(withKey(settings, capture.action, accelerator));
  });
  ipcMain.on('pad', (_event, pressed: unknown) => {
    if (!Array.isArray(pressed) || !pressed.every((button) => Number.isInteger(button))) return;
    const buttons = pressed as number[];
    if (capture?.kind === 'pad') {
      // collect every button held, and save the chord when they are all released
      if (buttons.length > 0) {
        capture.buttons = [...new Set([...capture.buttons, ...buttons])];
      } else if (capture.buttons.length > 0) {
        apply(withPad(settings, capture.action, capture.buttons));
      }
      return;
    }
    const fired = watcher.update(settings.pad, buttons);
    if (capture === undefined) fired.forEach((action) => run(action, 'pad'));
  });
  ipcMain.on('clear-pad', (_event, action: unknown) => {
    if (isAction(action)) apply(withPad(settings, action, []));
  });
  // Wiping every count cannot be undone: the window has already asked "Reset all stats?" (with "Cancel" as the safe
  // default), and this only runs after a yes.
  ipcMain.on('reset-stats', () => {
    counter = new ChestCounter(0);
    history = new MatchHistory();
    records = new Records();
    ticked.clear();
    writeFileSync(dataFile('ticked.json'), '[]');
    heard = 0;
    saveCounts();
    push();
  });
  // chests opened before the counter: added by hand, or estimated from the matches of Fortnite's Career tab
  ipcMain.on('add-chests', (_event, chests: unknown) => {
    if (!Number.isSafeInteger(chests) || chests === 0) return;
    counter.addToTotal(records.addManual({ id: `hand-${Date.now()}`, chests: chests as number, addedMs: Date.now(), kind: 'hand' }));
    saveCounts();
    push();
  });
  ipcMain.on('estimate', (_event, careerMatches: unknown) => {
    if (!Number.isSafeInteger(careerMatches) || (careerMatches as number) <= 0) return;
    const chests = records.estimate(careerMatches as number);
    counter.addToTotal(records.addManual({ id: `estimate-${Date.now()}`, chests, addedMs: Date.now(), kind: 'estimate', careerMatches: careerMatches as number }));
    saveCounts();
    push();
  });
  ipcMain.on('remove-manual', (_event, id: unknown) => {
    if (typeof id !== 'string') return;
    counter.addToTotal(records.removeManual(id));
    saveCounts();
    push();
  });
  // Older replays take room: Fortnite's unsaved ones go to the Recycle Bin (never one the player saved, never the
  // newest, never while a replay is being read). The window asked "are you sure" first.
  ipcMain.on('delete-old-replays', () => {
    if (replay.status === 'checking') return;
    void Promise.allSettled(oldReplays(replays.files()).map((file) => shell.trashItem(replays.pathOf(file.name)))).then(() => push());
  });
  ipcMain.on('tick-prize', (_event, id: unknown) => {
    if (typeof id !== 'string') return;
    if (ticked.has(id)) ticked.delete(id);
    else ticked.add(id);
    writeFileSync(dataFile('ticked.json'), JSON.stringify([...ticked]));
    push();
  });
  const setFlag = (key: 'onlyHuntMatches' | 'openWithFortnite' | 'notifications' | 'cat' | 'screenCount', on: unknown): void => {
    if (typeof on !== 'boolean') return;
    settings = { ...settings, [key]: on };
    saveSettings();
    if (key === 'openWithFortnite') applyOpenWithFortnite();
    push();
  };
  ipcMain.on('only-hunt', (_event, on: unknown) => setFlag('onlyHuntMatches', on));
  ipcMain.on('notifications', (_event, on: unknown) => setFlag('notifications', on));
  ipcMain.on('cat', (_event, on: unknown) => setFlag('cat', on));
  ipcMain.on('screen-count', (_event, on: unknown) => setFlag('screenCount', on));
  ipcMain.on('copy-obs-path', () => clipboard.writeText(dataFile('overlay.html')));
  ipcMain.on('open-with-fortnite', (_event, on: unknown) => setFlag('openWithFortnite', on));
  ipcMain.on('theme', (_event, theme: unknown) => {
    if (!isTheme(theme)) return;
    settings = { ...settings, theme };
    saveSettings();
    push();
  });
  ipcMain.on('reset', () => {
    apply(DEFAULT_SETTINGS);
    resize();
    updateGameAudio();
    applyOpenWithFortnite();
  });
  ipcMain.on('opacity', (_event, opacity: unknown) => {
    settings = withOpacity(settings, opacity);
    saveSettings();
    push();
  });
  ipcMain.on('live-count', (_event, on: unknown) => {
    if (typeof on !== 'boolean') return;
    settings = { ...settings, liveCount: on };
    saveSettings();
    updateGameAudio(); // the window stops reading the screen by itself
  });
  ipcMain.on('auto-count', (_event, on: unknown) => {
    if (typeof on !== 'boolean') return;
    settings = { ...settings, autoCount: on };
    saveSettings();
    updateGameAudio();
  });
  ipcMain.on('sensitivity', (_event, value: unknown) => {
    if (typeof value !== 'number' || !(value >= 0 && value <= 1)) return;
    settings = { ...settings, sensitivity: value };
    saveSettings();
    gameDetector = new ChestDetector(24000, value);
    push();
  });
  ipcMain.on('show-history', (_event, on: unknown) => {
    if (typeof on !== 'boolean') return;
    settings = { ...settings, showHistory: on };
    saveSettings();
    resize();
    push();
  });

  if (selfCheck !== undefined) {
    // A picture of the screen where the window is, so it shows exactly what the player sees (or does not see).
    const picture = async (file: string, waitMs = 700): Promise<void> => {
      await new Promise((done) => setTimeout(done, waitMs));
      const bounds = window.getBounds();
      const display = screen.getDisplayMatching(bounds);
      const sources = await desktopCapturer.getSources({
        types: ['screen'],
        thumbnailSize: { width: display.bounds.width, height: display.bounds.height },
      });
      const shot = sources.find((source) => source.display_id === String(display.id)) ?? sources[0]!;
      const crop = { x: bounds.x - display.bounds.x, y: bounds.y - display.bounds.y, width: bounds.width, height: bounds.height };
      writeFileSync(file, shot.thumbnail.crop(crop).toPNG());
    };
    window.webContents.once('did-finish-load', () => {
      void (async () => {
        // a match with 3 chests, then one in progress with 5 (one taken back), shown as it is being counted
        onMatchEvent('start');
        (['add', 'add', 'add'] as Action[]).forEach((action) => run(action, 'key'));
        onMatchEvent('lobby');
        onMatchEvent('start');
        (['add', 'add', 'add', 'add', 'add', 'add', 'undo'] as Action[]).forEach((action) => run(action, 'key'));
        await new Promise((done) => setTimeout(done, 1200));
        run('add', 'sound');
        await picture(selfCheck.replace(/\.png$/, '-anim.png'), 250);
        await picture(selfCheck);
        const barBounds = window.getBounds();
        show('settings');
        apply(withPad(settings, 'add', [10, 11]));
        for (const tab of ['sound', 'controls', 'look']) {
          window.webContents.send('tab', tab);
          await picture(selfCheck.replace(/\.png$/, `-${tab}.png`));
        }
        // the Stats tab is long: scroll it down in steps
        window.webContents.send('tab', 'stats');
        for (const [name, top] of [['stats', 0], ['stats-2', 440], ['stats-3', 880], ['stats-4', 5000]] as const) {
          await window.webContents.executeJavaScript(`document.getElementById('tab-stats').scrollTop = ${top}`);
          await picture(selfCheck.replace(/\.png$/, `-${name}.png`), 300);
        }
        // the confirm dialog, then every theme on the Look tab and on the bar
        await window.webContents.executeJavaScript("document.getElementById('reset-stats').click()");
        await picture(selfCheck.replace(/\.png$/, '-confirm.png'));
        await window.webContents.executeJavaScript("document.getElementById('confirm-cancel').click()");
        const settingsBounds = window.getBounds();
        window.webContents.send('tab', 'look');
        for (const theme of THEMES) {
          settings = { ...settings, theme };
          push();
          await picture(selfCheck.replace(/\.png$/, `-look-${theme}.png`), 400);
        }
        show('counter');
        for (const theme of THEMES) {
          settings = { ...settings, theme };
          push();
          await picture(selfCheck.replace(/\.png$/, `-bar-${theme}.png`), 400);
        }
        writeFileSync(`${selfCheck}.place.json`, JSON.stringify({ screen: screen.getPrimaryDisplay().bounds, barBounds, settingsBounds, backTo: window.getBounds() }));
        // give the sound capture a few seconds, then record whether any sound arrived
        await new Promise((done) => setTimeout(done, Number(process.env['CHEST_SELF_CHECK_SECONDS'] ?? 2) * 1000));
        writeFileSync(`${selfCheck}.audio.json`, JSON.stringify({ listening: listening(), phase: matches.phase, heard, history: history.toJSON(), ...audioCheck }));
        app.quit();
      })();
    });
  }
});

app.on('will-quit', () => globalShortcut.unregisterAll());
app.on('window-all-closed', () => app.quit());
