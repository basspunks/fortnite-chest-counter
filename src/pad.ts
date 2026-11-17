import { ACTIONS, type Action, type Settings } from './settings';

/** Button names of the standard controller layout (Xbox naming; PlayStation: A = Cross, B = Circle, X = Square, Y = Triangle). */
const BUTTON_NAMES = [
  'A', 'B', 'X', 'Y', 'LB', 'RB', 'LT', 'RT', 'View', 'Menu', 'L3', 'R3', 'D-Up', 'D-Down', 'D-Left', 'D-Right', 'Home',
];

/** "LB + RB", or "Not set" for an empty chord. */
export function chordLabel(buttons: readonly number[]): string {
  return buttons.length === 0 ? 'Not set' : buttons.map((button) => BUTTON_NAMES[button] ?? `Button ${button}`).join(' + ');
}

/**
 * Watches the buttons held on the controller and says which actions just fired.
 * An action fires once when all buttons of its chord are down, and again only after one of them was released.
 */
export class ChordWatcher {
  private readonly down = new Set<Action>();

  update(bindings: Settings['pad'], pressed: readonly number[]): Action[] {
    const fired: Action[] = [];
    for (const action of ACTIONS) {
      const chord = bindings[action];
      const held = chord.length > 0 && chord.every((button) => pressed.includes(button));
      if (held && !this.down.has(action)) {
        fired.push(action);
      }
      if (held) {
        this.down.add(action);
      } else {
        this.down.delete(action);
      }
    }
    return fired;
  }
}
