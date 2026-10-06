import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { SpatialNavigationEngine } from '../src/lib/spatial-nav.js';
import { SlidingWindowRateLimiter } from '../server/src/resilience/rate-limiter.js';
import type { SpatialBox } from '../server/src/domain/ports.js';

describe('Enterprise Media & Resilience Enhancements', () => {
  describe('SpatialNavigationEngine (2D Smart TV Focus)', () => {
    const nav = new SpatialNavigationEngine();

    // 2x2 grid of cards
    // [card-1] [card-2]
    // [card-3] [card-4]
    const cards: SpatialBox[] = [
      { id: 'card-1', left: 0, top: 0, width: 100, height: 150 },
      { id: 'card-2', left: 120, top: 0, width: 100, height: 150 },
      { id: 'card-3', left: 0, top: 170, width: 100, height: 150 },
      { id: 'card-4', left: 120, top: 170, width: 100, height: 150 },
    ];

    it('navigates right from card-1 to card-2', () => {
      const next = nav.findNextFocus('card-1', 'right', cards);
      assert.equal(next, 'card-2');
    });

    it('navigates down from card-1 to card-3', () => {
      const next = nav.findNextFocus('card-1', 'down', cards);
      assert.equal(next, 'card-3');
    });

    it('navigates left from card-2 to card-1', () => {
      const next = nav.findNextFocus('card-2', 'left', cards);
      assert.equal(next, 'card-1');
    });

    it('navigates up from card-4 to card-2', () => {
      const next = nav.findNextFocus('card-4', 'up', cards);
      assert.equal(next, 'card-2');
    });

    it('returns null when no candidate exists in the requested direction', () => {
      const next = nav.findNextFocus('card-1', 'left', cards);
      assert.equal(next, null);
    });
  });

  describe('SlidingWindowRateLimiter (Abuse & DoS Guard)', () => {
    it('allows requests within rate limit quota', () => {
      const limiter = new SlidingWindowRateLimiter();
      const ip = '127.0.0.1';

      const res1 = limiter.checkLimit(ip, 3, 60);
      assert.equal(res1.allowed, true);
      assert.equal(res1.remaining, 2);

      const res2 = limiter.checkLimit(ip, 3, 60);
      assert.equal(res2.allowed, true);
      assert.equal(res2.remaining, 1);

      const res3 = limiter.checkLimit(ip, 3, 60);
      assert.equal(res3.allowed, true);
      assert.equal(res3.remaining, 0);

      // 4th request exceeds quota
      const res4 = limiter.checkLimit(ip, 3, 60);
      assert.equal(res4.allowed, false);
      assert.equal(res4.remaining, 0);
    });

    it('resets quota when explicitly cleared', () => {
      const limiter = new SlidingWindowRateLimiter();
      const ip = '192.168.1.1';

      limiter.checkLimit(ip, 1, 60);
      assert.equal(limiter.checkLimit(ip, 1, 60).allowed, false);

      limiter.reset(ip);
      assert.equal(limiter.checkLimit(ip, 1, 60).allowed, true);
    });
  });
});
