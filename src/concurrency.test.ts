import {describe, it, expect} from 'vitest';
import {limitConcurrency} from './index';

// A controllable deferred promise so tests can decide exactly when a task settles.
function defer<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return {promise, resolve, reject};
}

describe('limitConcurrency', () => {
  it('never runs more than `limit` tasks at once', async () => {
    const limit = 3;
    const total = 12;
    let inFlight = 0;
    let peak = 0;

    const tasks = Array.from({length: total}, (_, i) => async () => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      // Yield a few microtasks so overlapping tasks actually coexist.
      await new Promise((r) => setTimeout(r, 1));
      inFlight--;
      return i;
    });

    const results = await limitConcurrency(tasks, limit);

    expect(peak).toBeLessThanOrEqual(limit);
    expect(results).toHaveLength(total);
  });

  it('returns every result in input order regardless of completion order', async () => {
    const deferreds = Array.from({length: 4}, () => defer<number>());
    const tasks = deferreds.map((d) => () => d.promise);

    const resultsPromise = limitConcurrency(tasks, 4);

    // Resolve out of order: last task first, first task last.
    deferreds[3].resolve(30);
    deferreds[1].resolve(10);
    deferreds[2].resolve(20);
    deferreds[0].resolve(0);

    const results = await resultsPromise;
    expect(results).toEqual([0, 10, 20, 30]);
  });

  it('returns all results when there are more tasks than the limit', async () => {
    const tasks = Array.from({length: 25}, (_, i) => async () => i * 2);
    const results = await limitConcurrency(tasks, 4);
    expect(results).toHaveLength(25);
    expect(results).toEqual(Array.from({length: 25}, (_, i) => i * 2));
  });

  it('handles an empty task list', async () => {
    const results = await limitConcurrency<number>([], 3);
    expect(results).toEqual([]);
  });

  it('treats a non-positive limit as a single worker', async () => {
    let inFlight = 0;
    let peak = 0;
    const tasks = Array.from({length: 5}, (_, i) => async () => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 1));
      inFlight--;
      return i;
    });
    const results = await limitConcurrency(tasks, 0);
    expect(peak).toBe(1);
    expect(results).toHaveLength(5);
  });
});
