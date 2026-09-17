/**
 * Circuit Breaker Service for Outbound Third-Party API Calls (e.g. Meta Graph API)
 * Prevents socket hangs and cascading worker pool exhaustion.
 */

const CircuitState = {
  CLOSED: "CLOSED", // Normal operation
  OPEN: "OPEN", // Failing, fast rejection
  HALF_OPEN: "HALF_OPEN", // Testing recovery
};

class CircuitBreaker {
  constructor({
    failureThreshold = 5,
    cooldownPeriodMs = 30000,
    halfOpenSuccessThreshold = 2,
    name = "InstagramGraphApi",
  } = {}) {
    this.name = name;
    this.failureThreshold = failureThreshold;
    this.cooldownPeriodMs = cooldownPeriodMs;
    this.halfOpenSuccessThreshold = halfOpenSuccessThreshold;

    this.state = CircuitState.CLOSED;
    this.consecutiveFailures = 0;
    this.consecutiveSuccesses = 0;
    this.lastFailureTime = null;
    this.lastStateChange = Date.now();
    this.totalTrips = 0;
  }

  getState() {
    // If OPEN and cooldown has elapsed, transition to HALF_OPEN
    if (this.state === CircuitState.OPEN) {
      const timeSinceFailure = Date.now() - (this.lastFailureTime || 0);
      if (timeSinceFailure >= this.cooldownPeriodMs) {
        this.transitionTo(CircuitState.HALF_OPEN);
      }
    }
    return this.state;
  }

  transitionTo(newState) {
    this.state = newState;
    this.lastStateChange = Date.now();
    if (newState === CircuitState.OPEN) {
      this.totalTrips += 1;
      this.lastFailureTime = Date.now();
      this.consecutiveSuccesses = 0;
    } else if (newState === CircuitState.HALF_OPEN) {
      this.consecutiveSuccesses = 0;
    } else if (newState === CircuitState.CLOSED) {
      this.consecutiveFailures = 0;
      this.consecutiveSuccesses = 0;
    }
  }

  recordSuccess() {
    const currentState = this.getState();
    if (currentState === CircuitState.HALF_OPEN) {
      this.consecutiveSuccesses += 1;
      if (this.consecutiveSuccesses >= this.halfOpenSuccessThreshold) {
        this.transitionTo(CircuitState.CLOSED);
      }
    } else if (currentState === CircuitState.CLOSED) {
      this.consecutiveFailures = 0;
    }
  }

  recordFailure(error) {
    this.lastFailureTime = Date.now();
    const currentState = this.getState();

    if (currentState === CircuitState.HALF_OPEN) {
      // In half-open, any failure immediately trips back to OPEN
      this.transitionTo(CircuitState.OPEN);
    } else if (currentState === CircuitState.CLOSED) {
      this.consecutiveFailures += 1;
      if (this.consecutiveFailures >= this.failureThreshold) {
        this.transitionTo(CircuitState.OPEN);
      }
    }
  }

  async execute(actionFn) {
    const currentState = this.getState();

    if (currentState === CircuitState.OPEN) {
      const err = new Error(
        `CircuitBreaker [${this.name}] is OPEN. Fast-failing outbound request to prevent system hangs.`
      );
      err.code = "CIRCUIT_BREAKER_OPEN";
      throw err;
    }

    try {
      const result = await actionFn();
      this.recordSuccess();
      return result;
    } catch (err) {
      this.recordFailure(err);
      throw err;
    }
  }

  reset() {
    this.transitionTo(CircuitState.CLOSED);
  }

  getMetrics() {
    return {
      name: this.name,
      state: this.getState(),
      consecutiveFailures: this.consecutiveFailures,
      consecutiveSuccesses: this.consecutiveSuccesses,
      totalTrips: this.totalTrips,
      lastFailureTime: this.lastFailureTime,
      lastStateChange: this.lastStateChange,
    };
  }
}

// Global default instance for Instagram DM transport
const defaultInstagramCircuit = new CircuitBreaker({
  name: "InstagramOutboundDM",
  failureThreshold: 4,
  cooldownPeriodMs: 15000,
  halfOpenSuccessThreshold: 2,
});

module.exports = {
  CircuitState,
  CircuitBreaker,
  defaultInstagramCircuit,
};
