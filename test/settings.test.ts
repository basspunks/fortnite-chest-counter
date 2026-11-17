import { describe, expect, it } from 'vitest';

import { isModifierKey, toAccelerator, type KeyPress } from '../src/keys';
import { ChordWatcher, chordLabel } from '../src/pad';
import { DEFAULT_SETTINGS, readSettings, withKey, withOpacity, withPad, type Settings } from '../src/settings';

const press = (code: string, mods: Partial<KeyPress> = {}): KeyPress => ({ code, ctrl: false, alt: false, shift: false, ...mods });

describe('keyboard shortcuts', () => {
  it('accepts function, numpad and navigation keys on their own', () => {
    expect(toAccelerator(press('F8'))).toBe('F8');
    expect(toAccelerator(press('Numpad1'))).toBe('num1');
    expect(toAccelerator(press('ArrowUp'))).toBe('Up');
    expect(toAccelerator(press('F8', { shift: true }))).toBe('Shift+F8');
  });

  it('accepts typing keys alone and with modifiers', () => {
    expect(toAccelerator(press('KeyK'))).toBe('K');
    expect(toAccelerator(press('KeyK', { shift: true }))).toBe('Shift+K');
    expect(toAccelerator(press('Backquote'))).toBe('`');
    expect(toAccelerator(press('KeyK', { ctrl: true }))).toBe('Ctrl+K');
    expect(toAccelerator(press('Digit1', { ctrl: true, alt: true }))).toBe('Ctrl+Alt+1');
  });

  it('rejects unknown keys and tells modifiers apart', () => {
    expect(toAccelerator(press('F25'))).toBeUndefined();
    expect(toAccelerator(press('ControlLeft', { ctrl: true }))).toBeUndefined();
    expect(isModifierKey('ControlLeft')).toBe(true);
    expect(isModifierKey('KeyC')).toBe(false);
  });
});

describe('settings', () => {
  it('starts with F8, F7, F9 and no controller buttons', () => {
    expect(readSettings(undefined)).toEqual(DEFAULT_SETTINGS);
  });

  it('keeps what is valid in a stored file and replaces the rest with defaults', () => {
    const stored = { keys: { add: 'Ctrl+K', undo: 7 }, pad: { add: [5, 4, 5], undo: ['x'] } };
    expect(readSettings(stored)).toEqual({
      keys: { add: 'Ctrl+K', undo: 'F7', newMatch: 'F9', toggleBar: 'Ctrl+Shift+O' },
      pad: { add: [4, 5], undo: [], newMatch: [], toggleBar: [] },
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
    });
    expect(readSettings({ openWithFortnite: false, onlyHuntMatches: false, version: 2 })).toMatchObject({ openWithFortnite: false, onlyHuntMatches: false });
    // settings saved before version 2 had it off by default: it is turned on once
    expect(readSettings({ openWithFortnite: false }).openWithFortnite).toBe(true);
    expect(readSettings({ theme: 'storm' }).theme).toBe('storm');
    expect(readSettings({ theme: 'pink' }).theme).toBe('dark');
    expect(readSettings({ sensitivity: 0.9, showHistory: false })).toMatchObject({ sensitivity: 0.9, showHistory: false });
    expect(readSettings({ sensitivity: 3 }).sensitivity).toBe(0.5);
    expect(readSettings({ fortniteOnly: false })).not.toHaveProperty('fortniteOnly'); // the app never hears the whole PC
    expect(readSettings({ autoCount: false }).autoCount).toBe(false);
    expect(readSettings({ autoCount: 'no' }).autoCount).toBe(true);
  });

  it('keeps the background opacity between 0 (no background) and 1', () => {
    expect(withOpacity(DEFAULT_SETTINGS, 0.8).opacity).toBe(0.8);
    expect(withOpacity(DEFAULT_SETTINGS, -1).opacity).toBe(0);
    expect(withOpacity(DEFAULT_SETTINGS, 7).opacity).toBe(1);
    expect(withOpacity(DEFAULT_SETTINGS, 'dark')).toBe(DEFAULT_SETTINGS);
    expect(readSettings({ opacity: 0.3 }).opacity).toBe(0.3);
  });

  it('changes a key, but not to one another action uses', () => {
    expect((withKey(DEFAULT_SETTINGS, 'add', 'F10') as Settings).keys.add).toBe('F10');
    expect(withKey(DEFAULT_SETTINGS, 'add', 'F8')).toEqual(DEFAULT_SETTINGS);
    expect(withKey(DEFAULT_SETTINGS, 'add', 'F7')).toBe('F7 is already used for another action.');
  });

  it('changes and clears controller buttons, but not to a chord another action uses', () => {
    const one = withPad(DEFAULT_SETTINGS, 'add', [11, 10]) as Settings;
    expect(one.pad.add).toEqual([10, 11]);
    expect(withPad(one, 'undo', [10, 11])).toBe('Those buttons are already used for another action.');
    expect((withPad(one, 'add', []) as Settings).pad.add).toEqual([]);
    expect(typeof withPad(one, 'undo', [])).toBe('object'); // two actions may both be "not set"
  });
});

describe('controller', () => {
  const pad = { add: [10, 11], undo: [4], newMatch: [], toggleBar: [] };

  it('names the buttons of a chord', () => {
    expect(chordLabel([10, 11])).toBe('L3 + R3');
    expect(chordLabel([40])).toBe('Button 40');
    expect(chordLabel([])).toBe('Not set');
  });

  it('fires once when the whole chord is held, and again only after a release', () => {
    const watcher = new ChordWatcher();
    expect(watcher.update(pad, [10])).toEqual([]);
    expect(watcher.update(pad, [10, 11])).toEqual(['add']);
    expect(watcher.update(pad, [10, 11, 0])).toEqual([]);
    expect(watcher.update(pad, [10])).toEqual([]);
    expect(watcher.update(pad, [10, 11])).toEqual(['add']);
  });

  it('never fires an action that has no buttons', () => {
    expect(new ChordWatcher().update(pad, [])).toEqual([]);
    expect(new ChordWatcher().update(pad, [4])).toEqual(['undo']);
  });
});
