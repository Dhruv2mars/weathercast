type Bucket = { count: number; resetAt: number };

export class FixedWindowRateLimiter {
  private readonly buckets = new Map<string, Bucket>();

  constructor(private readonly limit: number, private readonly windowMs = 60_000) {}

  take(key: string, now = Date.now()) {
    const current = this.buckets.get(key);
    if (!current || current.resetAt <= now) {
      this.buckets.set(key, { count: 1, resetAt: now + this.windowMs });
      return { allowed: true, remaining: this.limit - 1, resetAt: now + this.windowMs };
    }
    if (current.count >= this.limit) {
      return { allowed: false, remaining: 0, resetAt: current.resetAt };
    }
    current.count += 1;
    return { allowed: true, remaining: this.limit - current.count, resetAt: current.resetAt };
  }
}
