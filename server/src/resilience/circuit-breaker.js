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
 *   - HALF_OPEN: Probe state after cooldown period. A single request tests if the
 *                upstream service has recovered.
 */

/**
 * @typedef {'CLOSED' | 'OPEN' | 'HALF_OPEN'} CircuitState
 *
 * @typedef {Object} CircuitBreakerOptions
 * @property {number} [failureThreshold=5] Consecutive errors before tripping OPEN
 * @property {number} [resetTimeoutMs=10000] Milliseconds to stay OPEN before HALF_OPEN probe
 * @property {number} [callTimeoutMs=5000] Maximum time allowed per call before timing out
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
    this.callTimeoutMs = options.callTimeoutMs ?? 5000;

    /** @type {CircuitState} */
    this.state = 'CLOSED';
    this.consecutiveFailures = 0;
    this.lastStateChange = Date.now();
  }

  /**
   * Execute an operation protected by the circuit breaker.
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

    try {
      // Execute operation with timeout protection
      const result = await this.withTimeout(fn);
      this.onSuccess();
      return result == null ? fallback : result;
    } catch {
      this.onFailure();
      return fallback;
    }
  }

  /**
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
  }

  getStatus() {
    return {
      name: this.name,
      state: this.state,
      consecutiveFailures: this.consecutiveFailures,
      lastStateChange: this.lastStateChange,
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
