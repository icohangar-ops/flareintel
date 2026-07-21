/**
 * FlareIntel — Express API Server
 *
 * REST API for accessing on-chain risk data, subscription management,
 * and CII oracle information. Serves data from smart contracts and
 * the local pipeline cache.
 *
 * Endpoints:
 *   GET  /api/health              — Health check
 *   GET  /api/risk/countries      — List all tracked countries
 *   GET  /api/risk/country/:code  — Get CII score for a country
 *   GET  /api/risk/latest         — Latest scores for all countries
 *   GET  /api/risk/alerts         — Active risk alerts
 *   POST /api/subscription/check  — Check subscription status
 *   GET  /api/subscription/tiers  — Get tier information
 *   GET  /api/token/info          — RDT token info
 */

require("dotenv").config();
const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const morgan = require("morgan");
const path = require("path");
const { ethers } = require("ethers");

// ─── Routes ─────────────────────────────────────────────────────────
const riskRoutes = require("./routes/risk");
const subscriptionRoutes = require("./routes/subscription");

// ─── Configuration ──────────────────────────────────────────────────
const PORT = process.env.PORT || 3001;
const RPC_URL = process.env.RPC_URL || "https://coston2-api.flare.network/ext/C/rpc";

// ─── App ────────────────────────────────────────────────────────────
const app = express();

// Middleware
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({
  origin: process.env.CORS_ORIGIN || "*",
  methods: ["GET", "POST"],
  allowedHeaders: ["Content-Type", "Authorization"],
}));
app.use(morgan("combined"));
app.use(express.json());

// Static files (dashboard)
app.use("/dashboard", express.static(path.join(__dirname, "..", "dashboard")));

// ─── Blockchain Provider ────────────────────────────────────────────
const provider = new ethers.JsonRpcProvider(RPC_URL, { chainId: 114, name: "coston2" });

// Load deployed contract addresses
let contractAddresses = {};
try {
  const deployedPath = path.join(__dirname, "..", "..", "deployed-addresses.json");
  const fs = require("fs");
  contractAddresses = JSON.parse(fs.readFileSync(deployedPath, "utf-8")).contracts || {};
} catch {
  console.warn("[WARN] deployed-addresses.json not found — contract queries will be limited");
}

// Make provider and addresses available to routes
app.locals.provider = provider;
app.locals.contractAddresses = contractAddresses;

// ─── API Routes ─────────────────────────────────────────────────────
app.get("/api/health", (req, res) => {
  res.json({
    status: "ok",
    service: "FlareIntel API",
    version: "0.1.0",
    network: "coston2",
    chainId: 114,
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    contracts: Object.keys(contractAddresses).length > 0
      ? contractAddresses
      : { status: "not deployed yet" },
  });
});

app.use("/api/risk", riskRoutes);
app.use("/api/subscription", subscriptionRoutes);

// ─── Error Handling ─────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({ error: "Not found", path: req.path });
});

app.use((err, req, res, _next) => {
  console.error(`[ERROR] ${err.message}`);
  res.status(500).json({
    error: "Internal server error",
    message: process.env.NODE_ENV === "development" ? err.message : undefined,
  });
});

// ─── Start ──────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log("═══════════════════════════════════════════════");
  console.log("  FlareIntel API Server");
  console.log("═══════════════════════════════════════════════");
  console.log(`  URL:     http://localhost:${PORT}`);
  console.log(`  Network: Flare Coston2 (chainId: 114)`);
  console.log(`  Health:  http://localhost:${PORT}/api/health`);
  console.log(`  Dashboard: http://localhost:${PORT}/dashboard/`);
  console.log("═══════════════════════════════════════════════");
});

module.exports = app;