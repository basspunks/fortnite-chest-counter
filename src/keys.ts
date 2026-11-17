/** A key press as the window reports it (KeyboardEvent.code and the held modifiers). */
export interface KeyPress {
  readonly code: string;
  readonly ctrl: boolean;
  readonly alt: boolean;
  readonly shift: boolean;
}

/** Keys that are fine as a shortcut on their own. */
const STANDALONE: Readonly<Record<string, string>> = {
  Insert: 'Insert',
  Delete: 'Delete',
  Home: 'Home',
  End: 'End',
  PageUp: 'PageUp',
  PageDown: 'PageDown',
  ArrowUp: 'Up',
  ArrowDown: 'Down',
  ArrowLeft: 'Left',
  ArrowRight: 'Right',
  NumpadAdd: 'numadd',
  NumpadSubtract: 'numsub',
  NumpadMultiply: 'nummult',
  NumpadDivide: 'numdiv',
  NumpadDecimal: 'numdec',
};

/**
 * Keys used for typing. They are allowed alone too, but a shortcut takes its key for the whole PC,
 * so that key then no longer reaches the game or the chat (the settings say so).
 */
const TYPING: Readonly<Record<string, string>> = {
  Space: 'Space',
  Tab: 'Tab',
  Enter: 'Enter',
  Backspace: 'Backspace',
  Backquote: '`',
  Minus: '-',
  Equal: '=',
  BracketLeft: '[',
  BracketRight: ']',
  Semicolon: ';',
  Quote: "'",
  Comma: ',',
  Period: '.',
  Slash: '/',
  Backslash: '\\',
};

export function isModifierKey(code: string): boolean {
  return /^(Control|Alt|Shift|Meta)/.test(code);
}

/**
 * Turns a key press into an Electron accelerator: F8 → "F8", Ctrl + K → "Ctrl+K", K → "K", numpad 1 → "num1".
 * Undefined when the key cannot be a shortcut at all.
 */
export function toAccelerator(press: KeyPress): string | undefined {
  const functionKey = /^F([1-9]|1\d|2[0-4])$/.exec(press.code);
  const numpad = /^Numpad(\d)$/.exec(press.code);
  const typed = /^(?:Key([A-Z])|Digit(\d))$/.exec(press.code);

  const standalone = functionKey?.[0] ?? (numpad ? `num${numpad[1]}` : STANDALONE[press.code]);
  const typing = typed ? (typed[1] ?? typed[2]) : TYPING[press.code];
  const key = standalone ?? typing;
  if (key === undefined) {
    return undefined;
  }
  return [press.ctrl ? 'Ctrl' : '', press.alt ? 'Alt' : '', press.shift ? 'Shift' : '', key].filter(Boolean).join('+');
}
