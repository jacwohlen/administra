import { describe, it, expect } from 'vitest';
import { createRateLimiter } from './demoRateLimit';

describe('createRateLimiter', () => {
  it('allows `limit` attempts per key and window, then refuses', () => {
    const limiter = createRateLimiter(3, 1000);
    expect([1, 2, 3, 4].map(() => limiter.take('a', 0))).toEqual([true, true, true, false]);
  });

  it('counts each key on its own', () => {
    const limiter = createRateLimiter(1, 1000);
    expect(limiter.take('a', 0)).toBe(true);
    expect(limiter.take('a', 0)).toBe(false);
    expect(limiter.take('b', 0)).toBe(true);
  });

  it('frees attempts once they leave the window', () => {
    const limiter = createRateLimiter(2, 1000);
    expect(limiter.take('a', 0)).toBe(true);
    expect(limiter.take('a', 500)).toBe(true);
    expect(limiter.take('a', 999)).toBe(false);
    expect(limiter.take('a', 1000)).toBe(true);
    expect(limiter.take('a', 1001)).toBe(false);
    expect(limiter.take('a', 1500)).toBe(true);
  });
});
