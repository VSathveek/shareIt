import { describe, expect, it } from 'vitest';
import { isOriginAllowed } from '../src/security/origin';
import { SlidingWindowLimiter } from '../src/security/rate-limiter';

describe('isOriginAllowed', () => {
  it('allows all when the allowlist is empty (dev)', () => {
    expect(isOriginAllowed('https://anything', [])).toBe(true);
    expect(isOriginAllowed(undefined, [])).toBe(true);
  });

  it('enforces the allowlist when set', () => {
    const list = ['https://shareit.app'];
    expect(isOriginAllowed('https://shareit.app', list)).toBe(true);
    expect(isOriginAllowed('https://evil.example', list)).toBe(false);
    expect(isOriginAllowed(undefined, list)).toBe(false);
  });
});

describe('SlidingWindowLimiter', () => {
  it('allows up to the limit, then blocks within the window', () => {
    const t = 0;
    const limiter = new SlidingWindowLimiter(3, 1000, () => t);
    expect(limiter.tryAcquire('ip')).toBe(true);
    expect(limiter.tryAcquire('ip')).toBe(true);
    expect(limiter.tryAcquire('ip')).toBe(true);
    expect(limiter.tryAcquire('ip')).toBe(false);
  });

  it('recovers after the window slides past old hits', () => {
    let t = 0;
    const limiter = new SlidingWindowLimiter(2, 1000, () => t);
    expect(limiter.tryAcquire('ip')).toBe(true);
    expect(limiter.tryAcquire('ip')).toBe(true);
    expect(limiter.tryAcquire('ip')).toBe(false);
    t = 1001;
    expect(limiter.tryAcquire('ip')).toBe(true);
  });

  it('tracks keys independently', () => {
    const limiter = new SlidingWindowLimiter(1, 1000);
    expect(limiter.tryAcquire('a')).toBe(true);
    expect(limiter.tryAcquire('b')).toBe(true);
    expect(limiter.tryAcquire('a')).toBe(false);
  });
});
