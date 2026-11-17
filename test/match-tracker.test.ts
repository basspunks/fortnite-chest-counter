import { describe, expect, it } from 'vitest';

import { ChestCounter } from '../src/counter';
import { MatchHistory } from '../src/history';
import { MatchTracker } from '../src/match-tracker';

function setup(): { counter: ChestCounter; history: MatchHistory; tracker: MatchTracker } {
  const counter = new ChestCounter(0);
  const history = new MatchHistory();
  return { counter, history, tracker: new MatchTracker(() => counter, () => history) };
}

describe('MatchTracker', () => {
  it('records a match once when the player goes back to the lobby, and shows 0 there', () => {
    const { counter, history, tracker } = setup();
    tracker.onEvent('start');
    counter.add(26);
    tracker.onEvent('lobby');
    expect(history.toJSON()).toEqual([26]);
    expect(counter.counts().match).toBe(0);
    expect(tracker.phase).toBe('lobby');
  });

  it('does not record the same match again when "New match" is pressed in the lobby (the 26 · 26 bug)', () => {
    const { counter, history, tracker } = setup();
    tracker.onEvent('start');
    counter.add(26);
    tracker.onEvent('lobby');
    tracker.newMatchByHand();
    tracker.onEvent('start');
    counter.add(10);
    tracker.onEvent('lobby');
    expect(history.toJSON()).toEqual([26, 10]);
    expect(counter.counts()).toEqual({ match: 0, session: 36, total: 36 });
  });

  it('records the previous match when a new one starts without passing the lobby', () => {
    const { counter, history, tracker } = setup();
    tracker.onEvent('start');
    counter.add(4);
    expect(tracker.onEvent('start')).toBe(true);
    expect(history.toJSON()).toEqual([4]);
    expect(counter.counts().match).toBe(0);
  });

  it('ignores a second lobby event, and a lobby event before any match', () => {
    const { history, tracker } = setup();
    tracker.onEvent('lobby');
    tracker.onEvent('start');
    tracker.onEvent('lobby');
    tracker.onEvent('lobby');
    expect(history.toJSON()).toEqual([0]); // one match, played with no chests
  });

  it('records a match ended by hand only if it has chests', () => {
    const { counter, history, tracker } = setup();
    tracker.newMatchByHand();
    counter.add(3);
    tracker.newMatchByHand();
    expect(history.toJSON()).toEqual([3]);
  });
});
