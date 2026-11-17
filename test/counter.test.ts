import { describe, expect, it } from 'vitest';

import { ChestCounter } from '../src/counter';

describe('ChestCounter', () => {
  it('adds a chest to the match, the session and the total', () => {
    const counter = new ChestCounter(100);
    counter.add(1);
    counter.add(1);
    expect(counter.counts()).toEqual({ match: 2, session: 2, total: 102 });
  });

  it('starts a new match at 0 and keeps the session and the total', () => {
    const counter = new ChestCounter(100);
    counter.add(3);
    counter.newMatch();
    counter.add(1);
    expect(counter.counts()).toEqual({ match: 1, session: 4, total: 104 });
  });

  it('takes back a chest counted by mistake', () => {
    const counter = new ChestCounter(100);
    counter.add(2);
    counter.add(-1);
    expect(counter.counts()).toEqual({ match: 1, session: 1, total: 101 });
  });

  it('takes back from the session when the match is already at 0', () => {
    const counter = new ChestCounter(100);
    counter.add(2);
    counter.newMatch();
    counter.add(-1);
    expect(counter.counts()).toEqual({ match: 0, session: 1, total: 101 });
  });

  it('never takes back chests from before this session', () => {
    const counter = new ChestCounter(100);
    counter.add(-1);
    expect(counter.counts()).toEqual({ match: 0, session: 0, total: 100 });
  });
});
