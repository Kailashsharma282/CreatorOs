const { CircuitBreaker, CircuitState } = require("../services/dmCircuitBreakerService");
const { calculateBackoffDelay } = require("../utils/httpResilientClient");

describe("DM Resilient Transport & Circuit Breaker Unit Tests", () => {
  describe("CircuitBreaker State Transitions", () => {
    let breaker;

    beforeEach(() => {
      breaker = new CircuitBreaker({
        failureThreshold: 3,
        cooldownPeriodMs: 50, // fast cooldown for tests
        halfOpenSuccessThreshold: 2,
        name: "TestBreaker",
      });
    });

    it("should start in CLOSED state and succeed normally", async () => {
      expect(breaker.getState()).toBe(CircuitState.CLOSED);

      const result = await breaker.execute(async () => "ok");
      expect(result).toBe("ok");
      expect(breaker.getState()).toBe(CircuitState.CLOSED);
    });

    it("should trip to OPEN state after consecutive failures meet threshold", async () => {
      const failingAction = async () => {
        throw new Error("HTTP 500 Network failure");
      };

      // 1st failure
      await expect(breaker.execute(failingAction)).rejects.toThrow();
      expect(breaker.getState()).toBe(CircuitState.CLOSED);

      // 2nd failure
      await expect(breaker.execute(failingAction)).rejects.toThrow();
      expect(breaker.getState()).toBe(CircuitState.CLOSED);

      // 3rd failure (trips breaker)
      await expect(breaker.execute(failingAction)).rejects.toThrow();
      expect(breaker.getState()).toBe(CircuitState.OPEN);

      // Fast-fails on 4th call without executing action
      let executed = false;
      await expect(
        breaker.execute(async () => {
          executed = true;
          return "won't run";
        })
      ).rejects.toThrow(/is OPEN/);
      expect(executed).toBe(false);
    });

    it("should transition to HALF_OPEN after cooldown and recover to CLOSED after consecutive successes", async () => {
      // Force trip
      for (let i = 0; i < 3; i++) {
        breaker.recordFailure(new Error("failure"));
      }
      expect(breaker.state).toBe(CircuitState.OPEN);

      // Wait for cooldown
      await new Promise((resolve) => setTimeout(resolve, 60));
      expect(breaker.getState()).toBe(CircuitState.HALF_OPEN);

      // 1st success in HALF_OPEN
      await breaker.execute(async () => "probe 1");
      expect(breaker.state).toBe(CircuitState.HALF_OPEN);

      // 2nd success in HALF_OPEN -> closes circuit
      await breaker.execute(async () => "probe 2");
      expect(breaker.getState()).toBe(CircuitState.CLOSED);
    });
  });

  describe("calculateBackoffDelay", () => {
    it("should produce increasing delay times with jitter", () => {
      const delay0 = calculateBackoffDelay(0, 100);
      const delay1 = calculateBackoffDelay(1, 100);
      const delay2 = calculateBackoffDelay(2, 100);

      expect(delay0).toBeGreaterThanOrEqual(100);
      expect(delay1).toBeGreaterThanOrEqual(200);
      expect(delay2).toBeGreaterThanOrEqual(400);
    });
  });
});
