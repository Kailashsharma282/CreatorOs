const { defaultInstagramCircuit } = require("../services/dmCircuitBreakerService");
const { resilientFetch } = require("../utils/httpResilientClient");

/**
 * Dispatch outbound DM through resilient transport
 */
exports.dispatchDm = async (req, res) => {
  try {
    const { recipientId, messageText, simulatedEndpoint } = req.body;

    if (!recipientId || !messageText) {
      return res.status(400).json({ success: false, message: "recipientId and messageText are required" });
    }

    const targetUrl = simulatedEndpoint || "https://graph.instagram.com/v20.0/me/messages";

    // Call through circuit breaker with strict 4s timeout
    let status;
    try {
      const response = await resilientFetch(
        targetUrl,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            recipient: { id: recipientId },
            message: { text: messageText },
          }),
        },
        { timeoutMs: 4000, maxRetries: 1 }
      );
      status = response.status;
    } catch (deliveryError) {
      if (deliveryError.code === "CIRCUIT_BREAKER_OPEN") {
        return res.status(503).json({
          success: false,
          code: "CIRCUIT_BREAKER_OPEN",
          message: "Outbound delivery temporarily throttled. Instagram Graph API circuit breaker is OPEN.",
          metrics: defaultInstagramCircuit.getMetrics(),
        });
      }

      return res.status(502).json({
        success: false,
        message: "Outbound delivery failed after retries",
        error: deliveryError.message,
        metrics: defaultInstagramCircuit.getMetrics(),
      });
    }

    return res.status(200).json({
      success: true,
      message: "DM dispatched successfully",
      statusCode: status,
      metrics: defaultInstagramCircuit.getMetrics(),
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: "Internal gateway error", error: error.message });
  }
};

/**
 * Get current circuit breaker health metrics
 */
exports.getCircuitMetrics = async (req, res) => {
  return res.status(200).json({
    success: true,
    metrics: defaultInstagramCircuit.getMetrics(),
  });
};

/**
 * Reset circuit breaker (admin/operator action)
 */
exports.resetCircuit = async (req, res) => {
  defaultInstagramCircuit.reset();
  return res.status(200).json({
    success: true,
    message: "Circuit breaker manually reset to CLOSED",
    metrics: defaultInstagramCircuit.getMetrics(),
  });
};
