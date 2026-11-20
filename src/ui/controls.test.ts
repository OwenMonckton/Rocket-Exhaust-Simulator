import { describe, expect, it } from 'vitest';
import { formatMixture, roundMixture } from './controls';

describe('the mixture slider', () => {
  const range = { ofMin: 0.02, ofMax: 40 };
  it('rounds a log-scaled ratio to three significant figures, so the fuel-rich end does not snap', () => {
    expect(roundMixture(0.023456, 'ratio', true, range)).toBe(0.0235);
    expect(roundMixture(0.031234, 'ratio', true, range)).toBe(0.0312);
    expect(roundMixture(12.345, 'ratio', true, range)).toBe(12.3);
  });
  it('keeps hundredths on a linear ratio slider', () => {
    expect(roundMixture(2.3456, 'ratio', false, range)).toBe(2.35);
  });
  it('steps a temperature in round numbers suited to its range', () => {
    expect(roundMixture(2364, 'temperature', false, { ofMin: 1500, ofMax: 3200 })).toBe(2360);
  });
  it('shows enough digits for a small ratio', () => {
    expect(formatMixture(2.5, 'ratio', false)).toBe('2.50 : 1');
    expect(formatMixture(0.0235, 'ratio', false)).toBe('0.0235 : 1');
    expect(formatMixture(0.5, 'ratio', false)).toBe('0.500 : 1');
    expect(formatMixture(2360, 'temperature', false)).toBe('2,360 K');
    expect(formatMixture(0, 'none', false)).toBe('fixed in the grain');
  });
  it('says there is nothing to mix with when there is no oxidiser', () => {
    expect(formatMixture(0, 'ratio', true)).toBe('nothing to mix with');
  });
});
