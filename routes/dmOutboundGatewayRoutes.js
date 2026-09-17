const express = require("express");
const router = express.Router();
const { protect } = require("../middleware/auth");
const {
  dispatchDm,
  getCircuitMetrics,
  resetCircuit,
} = require("../controller/dmOutboundGatewayController");

// Public/Internal metrics
router.get("/circuit-metrics", getCircuitMetrics);

// Protected dispatch & operator endpoints
router.use(protect);
router.post("/dispatch", dispatchDm);
router.post("/circuit-reset", resetCircuit);

module.exports = router;
