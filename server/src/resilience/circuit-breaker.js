/**
 * Circuit Breaker Resilience Pattern for CFLIX.
 *
 * Protects the application core from cascading failures when external third-party
 * providers (Cinemeta, TVMaze, Kitsu) experience outages, latency spikes, or errors.
 *
 * State Machine:
 *   - CLOSED: Normal operation. Requests flow to the provider.
 *   - OPEN: Tripped after N consecutive failures. Calls return fallback immediately
 *           without initiating network requests, protecting Node connection pools.
 *   - HALF_OPEN: Probe state after cooldown period. Exactly one request is admitted, as the
 *                probe; every other caller fast-fails to the fallback until that probe
 *                settles. A recovering upstream is on its way back from a herd of requests
 *                it just refused, so admitting all of them would repeat the outage.
 *
 * A rejection is the only failure signal. Callers whose upstream resolves `null` on failure
 * have to reject deliberately, or every outage reads as a success and the circuit cannot open.
 */

/**
 * @typedef {'CLOSED' | 'OPEN' | 'HALF_OPEN'} CircuitState
 *
 * @typedef {Object} CircuitBreakerOptions
 * @property {number} [failureThreshold=5] Consecutive errors before tripping OPEN
 * @property {number} [resetTimeoutMs=10000] Milliseconds to stay OPEN before HALF_OPEN probe
 * @property {number} [callTimeoutMs=20000] Maximum time allowed per call before timing out.
 *   Must exceed the upstream adapter's own timeout: every adapter caps one request at 8000ms
 *   and `cinemeta.get` asks twice, so 16s is the ceiling the adapters themselves put on a
 *   legitimate read. A budget below that does not cap anything — it cannot abort the fetch —
 *   so it only records successful reads as failures.
 */

export class CircuitBreaker {
  /**
   * @param {string} name
   * @param {CircuitBreakerOptions} [options]
   */
  constructor(name, options = {}) {
    this.name = name;
    this.failureThreshold = options.failureThreshold ?? 5;
    this.resetTimeoutMs = options.resetTimeoutMs ?? 10000;
    this.callTimeoutMs = options.callTimeoutMs ?? 20000;

    /** @type {CircuitState} */
    this.state = 'CLOSED';
    this.consecutiveFailures = 0;
    this.lastStateChange = Date.now();
    /** The single HALF_OPEN probe. Set on admission, cleared when it settles. */
    this.probeInFlight = false;
  }

  /**
   * Execute an operation protected by the circuit breaker.
   *
   * A rejection — from `fn` itself or from `withTimeout` — is the failure signal, and it is the
   * only one. `fn` has to reject when its upstream failed; a `fn` that resolves `null` on
   * failure records a success and the circuit stays closed forever.
   *
   * @template T
   * @param {() => Promise<T>} fn The async operation to protect
   * @param {T} fallback Fallback value returned if the call fails or circuit is OPEN
   * @returns {Promise<T>}
   */
  async execute(fn, fallback) {
    const now = Date.now();

    // Check if OPEN cooldown has elapsed -> transition to HALF_OPEN probe
    if (this.state === 'OPEN') {
      if (now - this.lastStateChange >= this.resetTimeoutMs) {
        this.state = 'HALF_OPEN';
        this.lastStateChange = now;
      } else {
        // Fast fail: circuit is OPEN, return fallback instantly
        return fallback;
      }
    }

    // The state is HALF_OPEN for every caller arriving after the one that opened the probe, so
    // gating on the state alone lets the whole herd through and recovery becomes a second
    // outage. Only the first gets the slot.
    const probe = this.state === 'HALF_OPEN';
    if (probe) {
      if (this.probeInFlight) return fallback;
      this.probeInFlight = true;
    }

    try {
      // Execute operation with timeout protection
      const result = await this.withTimeout(fn);
      this.onSuccess();
      return result == null ? fallback : result;
    } catch {
      this.onFailure();
      return fallback;
    } finally {
      if (probe) this.probeInFlight = false;
    }
  }

  /**
   * Racing a rejection against `fn`. It settles the caller, it does not cancel `fn`: the
   * adapters own their own `AbortController` and take no external signal, so an abandoned call
   * holds its socket until the adapter's own timeout releases it. That is why `callTimeoutMs`
   * sits above the adapters' timeout rather than below it.
   *
   * @template T
   * @param {() => Promise<T>} fn
   * @returns {Promise<T>}
   */
  withTimeout(fn) {
    return new Promise((resolve, reject) => {
      let settled = false;
      const timer = setTimeout(() => {
        if (!settled) {
          settled = true;
          reject(
            new Error(`Operation timed out after ${this.callTimeoutMs}ms`),
          );
        }
      }, this.callTimeoutMs);

      Promise.resolve()
        .then(fn)
        .then(
          (value) => {
            if (!settled) {
              settled = true;
              clearTimeout(timer);
              resolve(value);
            }
          },
          (err) => {
            if (!settled) {
              settled = true;
              clearTimeout(timer);
              reject(err);
            }
          },
        );
    });
  }

  onSuccess() {
    this.consecutiveFailures = 0;
    if (this.state === 'HALF_OPEN') {
      this.state = 'CLOSED';
      this.lastStateChange = Date.now();
    }
  }

  onFailure() {
    this.consecutiveFailures += 1;
    if (
      this.state === 'HALF_OPEN' ||
      this.consecutiveFailures >= this.failureThreshold
    ) {
      this.state = 'OPEN';
      this.lastStateChange = Date.now();
    }
  }

  reset() {
    this.state = 'CLOSED';
    this.consecutiveFailures = 0;
    this.lastStateChange = Date.now();
    this.probeInFlight = false;
  }

  getStatus() {
    return {
      name: this.name,
      state: this.state,
      consecutiveFailures: this.consecutiveFailures,
      lastStateChange: this.lastStateChange,
      probeInFlight: this.probeInFlight,
    };
  }
}

/** @type {Map<string, CircuitBreaker>} */
const registry = new Map();

/**
 * Get or create a named CircuitBreaker instance.
 *
 * @param {string} name
 * @param {CircuitBreakerOptions} [options]
 * @returns {CircuitBreaker}
 */
export function getCircuitBreaker(name, options = {}) {
  const key = String(name || 'default');
  let breaker = registry.get(key);
  if (!breaker) {
    breaker = new CircuitBreaker(key, options);
    registry.set(key, breaker);
  }
  return breaker;
}

/**
 * Reset all registered circuit breakers (useful for tests).
 */
export function resetAllCircuitBreakers() {
  for (const breaker of registry.values()) {
    breaker.reset();
  }
}
