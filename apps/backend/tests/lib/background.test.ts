import { describe, expect, it } from 'vitest';
import {
  drainBackgroundTasks,
  pendingBackgroundTaskCount,
  runInBackground,
} from '../../src/lib/background';

const delay = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

describe('background task registry', () => {
  it('tracks an in-flight task and drain awaits it to completion', async () => {
    let done = false;
    runInBackground(
      (async () => {
        await delay(30);
        done = true;
      })(),
    );
    expect(pendingBackgroundTaskCount()).toBe(1);
    expect(done).toBe(false); // not awaited yet

    await drainBackgroundTasks();

    expect(done).toBe(true); // drain waited for it
    expect(pendingBackgroundTaskCount()).toBe(0); // self-removed
  });

  it('drains multiple tasks and a rejecting task without throwing', async () => {
    const order: number[] = [];
    runInBackground(delay(20).then(() => void order.push(2)));
    runInBackground(delay(5).then(() => void order.push(1)));
    runInBackground(Promise.reject(new Error('boom')).catch(() => void order.push(0)));
    expect(pendingBackgroundTaskCount()).toBe(3);

    await expect(drainBackgroundTasks()).resolves.toBeUndefined();

    expect(order).toContain(1);
    expect(order).toContain(2);
    expect(pendingBackgroundTaskCount()).toBe(0);
  });

  it('drain of nothing is an immediate no-op', async () => {
    expect(pendingBackgroundTaskCount()).toBe(0);
    await expect(drainBackgroundTasks()).resolves.toBeUndefined();
  });
});
