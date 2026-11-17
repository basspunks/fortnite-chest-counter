import { describe, expect, it } from 'vitest';

import { isNewer } from '../src/updater';

describe('isNewer', () => {
  it('compares versions part by part, not as text', () => {
    expect(isNewer('v0.2.0', '0.1.0')).toBe(true);
    expect(isNewer('1.10.0', '1.9.2')).toBe(true);
    expect(isNewer('0.1.0', '0.1.0')).toBe(false);
    expect(isNewer('v0.1', '0.1.0')).toBe(false);
    expect(isNewer('0.0.9', '0.1.0')).toBe(false);
  });
});
