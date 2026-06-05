import {describe, it, expect} from 'vitest';
import {parseResolutions, clampNumber} from './utils';

describe('utils', () => {
  it('parseResolutions splits and trims', () => {
    expect(parseResolutions('1920x1080,  390x844,,  360x640')).toEqual([
      '1920x1080',
      '390x844',
      '360x640',
    ]);
  });

  it('parseResolutions handles empty input', () => {
    expect(parseResolutions('')).toEqual([]);
  });

  it('clampNumber respects bounds', () => {
    expect(clampNumber(5, 1, 10)).toBe(5);
    expect(clampNumber(-1, 1, 10)).toBe(1);
    expect(clampNumber(999, 1, 10)).toBe(10);
  });
});
