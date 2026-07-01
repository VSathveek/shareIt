export interface RateLimiter {
  tryAcquire(key: string): boolean;
}

/**
 * Sliding-window rate limiter. Bounds `create`/`join` attempts per client key (IP), which caps
 * pairing-code brute force and session-creation abuse (Phase 10 threat model). In-memory and
 * self-pruning; a Redis-backed limiter can replace it at multi-instance scale.
 */
export class SlidingWindowLimiter implements RateLimiter {
  private readonly hits = new Map<string, number[]>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
    private readonly now: () => number = () => Date.now(),
  ) {}

  tryAcquire(key: string): boolean {
    const t = this.now();
    const recent = (this.hits.get(key) ?? []).filter((ts) => t - ts < this.windowMs);
    if (recent.length >= this.limit) {
      this.hits.set(key, recent);
      return false;
    }
    recent.push(t);
    this.hits.set(key, recent);
    return true;
  }

  /** Drops keys with no activity in the window; call periodically to bound memory. */
  prune(): void {
    const t = this.now();
    for (const [key, timestamps] of this.hits) {
      if (timestamps.every((ts) => t - ts >= this.windowMs)) this.hits.delete(key);
    }
  }
}
