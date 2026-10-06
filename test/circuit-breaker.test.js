import test from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as sleep } from 'node:timers/promises';
import {
  CircuitBreaker,
  getCircuitBreaker,
  resetAllCircuitBreakers,
} from '../server/src/resilience/circuit-breaker.js';

test('Circuit Breaker Resilience Pattern', async (t) => {
  t.beforeEach(() => {
    resetAllCircuitBreakers();
  });

  await t.test('CLOSED state allows successful calls through', async () => {
    const cb = new CircuitBreaker('test-service', { failureThreshold: 3 });
    let executed = false;

    const result = await cb.execute(
      async () => {
        executed = true;
        return { data: 'ok' };
      },
      { fallback: true },
    );

    assert.equal(executed, true);
    assert.deepEqual(result, { data: 'ok' });
    assert.equal(cb.getStatus().state, 'CLOSED');
    assert.equal(cb.getStatus().consecutiveFailures, 0);
  });

  await t.test(
    'Failing calls return fallback and increment failure count',
    async () => {
      const cb = new CircuitBreaker('test-service', { failureThreshold: 3 });

      const result = await cb.execute(async () => {
        throw new Error('network down');
      }, 'fallback-value');

      assert.equal(result, 'fallback-value');
      assert.equal(cb.getStatus().consecutiveFailures, 1);
      assert.equal(cb.getStatus().state, 'CLOSED');
    },
  );

  await t.test(
    'Trips to OPEN state after reaching failure threshold',
    async () => {
      const cb = new CircuitBreaker('test-service', { failureThreshold: 3 });
      await cb.execute(async () => {
        throw new Error('outage');
      }, null);
      await cb.execute(async () => {
        throw new Error('outage');
      }, null);
      await cb.execute(async () => {
        throw new Error('outage');
      }, null);

      assert.equal(cb.getStatus().state, 'OPEN');
      assert.equal(cb.getStatus().consecutiveFailures, 3);

      // Subsequent call should fast-fail without calling the action
      let callAttempted = false;
      const fastFailResult = await cb.execute(async () => {
        callAttempted = true;
        return 'should-not-run';
      }, 'fast-fallback');

      assert.equal(
        callAttempted,
        false,
        'Action was called while circuit was OPEN',
      );
      assert.equal(fastFailResult, 'fast-fallback');
    },
  );

  await t.test(
    'Transitions to HALF_OPEN after cooldown and recovers on success',
    async () => {
      const cb = new CircuitBreaker('test-service', {
        failureThreshold: 2,
        resetTimeoutMs: 50,
      });

      // Trip to OPEN
      await cb.execute(async () => {
        throw new Error('fail');
      }, null);
      // Wait for cooldown
      await sleep(60);

      // Next call should probe and recover to CLOSED
      let probeRan = false;
      const result = await cb.execute(async () => {
        probeRan = true;
        return 'recovered';
      }, 'fallback');

      assert.equal(probeRan, true);
      assert.equal(result, 'recovered');
      assert.equal(cb.getStatus().state, 'CLOSED');
      assert.equal(cb.getStatus().consecutiveFailures, 0);
    },
  );

  await t.test(
    'HALF_OPEN probe failure returns immediately to OPEN',
    async () => {
      const cb = new CircuitBreaker('test-service', {
        failureThreshold: 2,
        resetTimeoutMs: 50,
      });

      await cb.execute(async () => {
        throw new Error('fail');
      }, null);
      await cb.execute(async () => {
        throw new Error('fail');
      }, null);
      await sleep(60);
      // Probe fails
      await cb.execute(async () => {
        throw new Error('still down');
      }, 'fallback');

      assert.equal(cb.getStatus().state, 'OPEN');
    },
  );

  await t.test(
    'Times out slow requests and counts them as failures',
    async () => {
      const cb = new CircuitBreaker('test-service', {
        failureThreshold: 2,
        callTimeoutMs: 30,
      });
      const result = await cb.execute(async () => {
        await sleep(100);
        return 'too-late';
      }, 'timeout-fallback');

      assert.equal(result, 'timeout-fallback');
      assert.equal(cb.getStatus().consecutiveFailures, 1);
    },
  );

  await t.test(
    'Named registry maintains isolated breakers per provider',
    async () => {
      const cinemeta = getCircuitBreaker('cinemeta', { failureThreshold: 2 });
      const kitsu = getCircuitBreaker('kitsu', { failureThreshold: 2 });

      // Trip cinemeta
      await cinemeta.execute(async () => {
        throw new Error('down');
      }, null);
      await cinemeta.execute(async () => {
        throw new Error('down');
      }, null);
      assert.equal(cinemeta.getStatus().state, 'OPEN');

      // Kitsu remains completely healthy in CLOSED state
      assert.equal(kitsu.getStatus().state, 'CLOSED');
      const kitsuResult = await kitsu.execute(
        async () => 'kitsu-ok',
        'fallback',
      );
      assert.equal(kitsuResult, 'kitsu-ok');
    },
  );
});
