import {describe, it, expect, vi, beforeEach, afterEach} from 'vitest';
import {retryWithBackoff} from './index';

describe('retryWithBackoff', () => {
  beforeEach(() => {
    // The helper logs retry progress; keep test output clean.
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('reports attempts=1 when the operation succeeds on the first try', async () => {
    const op = vi.fn(async () => 'ok');
    const {value, attempts} = await retryWithBackoff(op, 2, 0);
    expect(value).toBe('ok');
    expect(attempts).toBe(1);
    expect(op).toHaveBeenCalledTimes(1);
  });

  it('counts the real number of attempts across retries', async () => {
    let calls = 0;
    const op = vi.fn(async () => {
      calls++;
      if (calls < 3) throw new Error('transient');
      return 'recovered';
    });
    // baseDelay 0 so the exponential backoff does not slow the test down.
    const {value, attempts} = await retryWithBackoff(op, 5, 0);
    expect(value).toBe('recovered');
    expect(attempts).toBe(3);
    expect(op).toHaveBeenCalledTimes(3);
  });

  it('throws the last error after exhausting all retries', async () => {
    const op = vi.fn(async () => {
      throw new Error('boom');
    });
    await expect(retryWithBackoff(op, 2, 0)).rejects.toThrow('boom');
    // maxRetries=2 means 1 initial attempt + 2 retries = 3 calls.
    expect(op).toHaveBeenCalledTimes(3);
  });
});
