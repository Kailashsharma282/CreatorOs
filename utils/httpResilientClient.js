/**
 * Resilient HTTP client wrapper
 * Implements hard timeouts (preventing socket hangs) and exponential jittered retries
 */

const { defaultInstagramCircuit } = require("../services/dmCircuitBreakerService");

/**
 * Execute request with timeout guard (using AbortController or Promise.race)
 */
async function sendWithTimeout(url, options = {}, timeoutMs = 5000) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const fetchFn = typeof fetch === "function" ? fetch : require("node-fetch");
    const response = await fetchFn(url, {
      ...options,
      signal: controller.signal,
    });
    return response;
  } catch (error) {
    if (error.name === "AbortError" || error.code === "ABORT_ERR") {
      const timeoutError = new Error(`Request to ${url} timed out after ${timeoutMs}ms.`);
      timeoutError.code = "ETIMEDOUT";
      throw timeoutError;
    }
    throw error;
  } finally {
    clearTimeout(id);
  }
}

/**
 * Calculate jittered exponential backoff delay
 */
function calculateBackoffDelay(attempt, baseDelayMs = 200, maxDelayMs = 3000) {
  const exponential = Math.min(maxDelayMs, baseDelayMs * Math.pow(2, attempt));
  const jitter = Math.random() * 0.3 * exponential; // 0-30% jitter
  return Math.floor(exponential + jitter);
}

/**
 * Execute resilient HTTP call with circuit breaker and retries
 */
async function resilientFetch(
  url,
  options = {},
  {
    maxRetries = 2,
    timeoutMs = 5000,
    circuit = defaultInstagramCircuit,
  } = {}
) {
  return circuit.execute(async () => {
    let lastError = null;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const res = await sendWithTimeout(url, options, timeoutMs);

        // Treat 5xx and 429 as retryable
        if (res.status >= 500 || res.status === 429) {
          throw new Error(`Upstream server returned HTTP ${res.status}`);
        }

        return res;
      } catch (err) {
        lastError = err;
        if (attempt < maxRetries) {
          const delay = calculateBackoffDelay(attempt);
          await new Promise((resolve) => setTimeout(resolve, delay));
        }
      }
    }

    throw lastError;
  });
}

module.exports = {
  sendWithTimeout,
  calculateBackoffDelay,
  resilientFetch,
};
