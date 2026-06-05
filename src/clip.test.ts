import {describe, it, expect} from 'vitest';
import {parseClip} from './index';

describe('parseClip', () => {
  it('parses a valid x,y,width,height region', () => {
    expect(parseClip('0,0,800,600')).toEqual({x: 0, y: 0, width: 800, height: 600});
    expect(parseClip(' 10, 20 , 300, 150 ')).toEqual({x: 10, y: 20, width: 300, height: 150});
  });

  it('rejects the wrong number of parts', () => {
    expect(() => parseClip('0,0,800')).toThrow(/x,y,width,height/);
    expect(() => parseClip('0,0,800,600,1')).toThrow(/x,y,width,height/);
  });

  it('rejects non-numeric values', () => {
    expect(() => parseClip('a,b,c,d')).toThrow();
  });

  it('rejects non-positive width/height and negative offsets', () => {
    expect(() => parseClip('0,0,0,600')).toThrow();
    expect(() => parseClip('0,0,800,0')).toThrow();
    expect(() => parseClip('-1,0,800,600')).toThrow();
  });
});
