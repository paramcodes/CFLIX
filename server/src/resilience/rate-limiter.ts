import type { RateLimiterPort, RateLimitResult } from '../domain/ports.js';

interface RateLimitRecord {
  timestamps: number[];
}

/**
 * In-Memory Sliding-Window Rate Limiter.
 * Protects authentication endpoints and search against abuse and brute-force flooding.
 */
export class SlidingWindowRateLimiter implements RateLimiterPort {
  private records = new Map<string, RateLimitRecord>();

  checkLimit(
    key: string,
    limit: number,
    windowSeconds: number,
  ): RateLimitResult {
    const now = Date.now();
    const windowMs = windowSeconds * 1000;
    const windowStart = now - windowMs;

    let record = this.records.get(key);
    if (!record) {
      record = { timestamps: [] };
      this.records.set(key, record);
    }

    // Evict timestamps outside sliding window
    record.timestamps = record.timestamps.filter((t) => t > windowStart);

    if (record.timestamps.length >= limit) {
      const oldest = record.timestamps[0] || now;
      const resetAt = oldest + windowMs;
      return {
        allowed: false,
        remaining: 0,
        resetAt,
      };
    }

    record.timestamps.push(now);
    return {
      allowed: true,
      remaining: limit - record.timestamps.length,
      resetAt: now + windowMs,
    };
  }

  reset(key?: string): void {
    if (key) {
      this.records.delete(key);
    } else {
      this.records.clear();
    }
  }
}

export const globalRateLimiter = new SlidingWindowRateLimiter();
