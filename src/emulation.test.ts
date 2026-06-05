import {describe, it, expect} from 'vitest';
import {parseHeaders, parseBasicAuth} from './index';

describe('parseHeaders', () => {
  it('parses "Name: value" pairs, splitting on the first colon', () => {
    expect(parseHeaders(['X-Test: 1', 'Authorization: Bearer a:b:c'])).toEqual({
      'X-Test': '1',
      Authorization: 'Bearer a:b:c',
    });
  });

  it('trims whitespace around name and value', () => {
    expect(parseHeaders(['  X-A :  hello world  '])).toEqual({'X-A': 'hello world'});
  });

  it('throws on a header without a colon or with an empty name', () => {
    expect(() => parseHeaders(['no-colon'])).toThrow(/Name: value/);
    expect(() => parseHeaders([': value'])).toThrow(/empty/);
  });
});

describe('parseBasicAuth', () => {
  it('splits user:password on the first colon (password may contain colons)', () => {
    expect(parseBasicAuth('user:pa:ss')).toEqual({username: 'user', password: 'pa:ss'});
    expect(parseBasicAuth('alice:secret')).toEqual({username: 'alice', password: 'secret'});
  });

  it('throws when there is no colon', () => {
    expect(() => parseBasicAuth('nopassword')).toThrow(/username:password/);
  });
});
