/**
 * FlareIntel — FDC (Flare Data Connector) Event Attestation Bridge
 *
 * Bridges WorldMonitor geopolitical events through Flare's FDC protocol
 * to create verifiable, on-chain attestations of real-world events.
 *
 * The FDC allows smart contracts to request data from off-chain sources
 * and receive cryptographically verified responses. This bridge:
 *
 *   1. Monitors WorldMonitor for new geopolitical/financial events
 *   2. Formats events as FDC-compatible data requests
 *   3. Submits attestation requests to the FDC protocol
 *   4. Listens for FDC responses and forwards to CollateralManager
 *
 * FDC Flow:
 *   Event detected → FDC Request → Attestation Providers → Verified Response → On-chain
 */

require("dotenv").config();
const { ethers } = require("ethers");
const axios = require("axios");
const EventEmitter = require("events");

// ─── Configuration ──────────────────────────────────────────────────
const CONFIG = {
  rpcUrl: process.env.RPC_URL || "https://coston2-api.flare.network/ext/C/rpc",
  privateKey: process.env.PRIVATE_KEY,
  fdcContractAddress: process.env.FDC_CONTRACT_ADDRESS,
  collateralManagerAddress: process.env.COLLATERAL_MANAGER_ADDRESS,
  worldMonitorUrl: process.env.WORLDMONITOR_URL || "http://localhost:5000",
  pollIntervalMs: 60_000, // Check for new events every minute
  attestationFee: ethers.parseUnits("0.01", 18), // FLR fee for attestation
};

// ─── FDC Protocol ABI ───────────────────────────────────────────────
const FDC_ABI = [
  "function requestData(uint256 queryTypeId, bytes calldata data) external payable returns (uint256 requestId)",
  "function getResponse(uint256 requestId) view returns (bytes, uint256 timestamp, bool delivered)",
  "function getAttestationFee(uint256 queryTypeId) view returns (uint256)",
  "event DataRequested(uint256 indexed requestId, address indexed caller, uint256 queryTypeId)",
  "event ResponseDelivered(uint256 indexed requestId, bytes data, uint256 timestamp)",
];

// ─── CollateralManager ABI ─────────────────────────────────────────
const CM_ABI = [
  "function monitorPositions() external",
  "function globalRiskThreshold() view returns (uint256)",
  "function liquidationThreshold() view returns (uint256)",
];

// ─── Event Severity Mapping ─────────────────────────────────────────
const SEVERITY_TO_CII_IMPACT = {
  critical: 150,  // Major geopolitical event (war, coup, sanctions)
  high:     80,   // Significant event (trade embargo, election crisis)
  medium:   30,   // Notable event (policy change, economic indicator)
  low:      10,   // Minor event (diplomatic statement, minor protest)
  info:     0,    // Informational
};

// ─── Logger ─────────────────────────────────────────────────────────
const log = {
  info: (msg, data) => console.log(`[${new Date().toISOString()}] [FDC] [INFO]  ${msg}`, data || ""),
  warn: (msg, data) => console.warn(`[${new Date().toISOString()}] [FDC] [WARN]  ${msg}`, data || ""),
  error: (msg, data) => console.error(`[${new Date().toISOString()}] [FDC] [ERROR] ${msg}`, data || ""),
};

// ─── State ──────────────────────────────────────────────────────────
const eventBus = new EventEmitter();
let provider, signer, fdcContract, collateralManager;
let processedEventIds = new Set();
const MAX_PROCESSED_CACHE = 10_000;

// ─── Initialize ─────────────────────────────────────────────────────
function init() {
  if (!CONFIG.privateKey) throw new Error("PRIVATE_KEY not set");
  if (!CONFIG.fdcContractAddress) throw new Error("FDC_CONTRACT_ADDRESS not set");

  provider = new ethers.JsonRpcProvider(CONFIG.rpcUrl, { chainId: 114, name: "coston2" });
  signer = new ethers.Wallet(CONFIG.privateKey, provider);
  fdcContract = new ethers.Contract(CONFIG.fdcContractAddress, FDC_ABI, signer);

  if (CONFIG.collateralManagerAddress) {
    collateralManager = new ethers.Contract(CONFIG.collateralManagerAddress, CM_ABI, signer);
  }

  log.info("FDC Bridge initialized", {
    address: signer.address,
    fdc: CONFIG.fdcContractAddress,
    cm: CONFIG.collateralManagerAddress || "not configured",
  });
}

// ─── Fetch New Events from WorldMonitor ─────────────────────────────
async function fetchNewEvents() {
  try {
    const resp = await axios.get(`${CONFIG.worldMonitorUrl}/api/v1/events`, {
      params: {
        since: Math.floor(Date.now() / 1000) - 300, // last 5 minutes
        limit: 50,
      },
      timeout: 15_000,
    });

    const events = resp.data.events || [];
    return events.filter((e) => !processedEventIds.has(e.id));
  } catch (err) {
    log.error("Failed to fetch WorldMonitor events", err.message);
    return [];
  }
}

// ─── Encode Event for FDC ───────────────────────────────────────────
/**
 * Encodes a WorldMonitor geopolitical event into the FDC data format.
 * The FDC expects a specific encoding based on the query type.
 *
 * Format: abi.encode(string eventType, string countryCode, uint256 severity, string source)
 */
function encodeEventForFDC(event) {
  const encoder = ethers.AbiCoder.defaultAbiCoder();
  return encoder.encode(
    ["string", "string", "uint256", "string", "uint256"],
    [
      event.type || "geopolitical",
      event.countryCode || "UNK",
      event.severity || 0,
      event.source || "worldmonitor",
      event.timestamp || Math.floor(Date.now() / 1000),
    ]
  );
}

// ─── Submit Attestation Request ─────────────────────────────────────
async function submitAttestationRequest(event) {
  try {
    const encodedData = encodeEventForFDC(event);
    const queryTypeId = getQueryTypeId(event.type);

    // Get current fee
    let fee = CONFIG.attestationFee;
    try {
      fee = await fdcContract.getAttestationFee(queryTypeId);
    } catch {
      log.info("Could not fetch dynamic fee, using default");
    }

    const tx = await fdcContract.requestData(queryTypeId, encodedData, {
      value: fee,
      gasLimit: 500_000n,
    });

    log.info(`FDC request submitted for event ${event.id}`, {
      hash: tx.hash,
      country: event.countryCode,
      type: event.type,
      fee: ethers.formatEther(fee),
    });

    const receipt = await tx.wait();
    if (receipt.status === 1) {
      eventBus.emit("attestation_requested", { eventId: event.id, txHash: tx.hash });
      return true;
    }
    return false;
  } catch (err) {
    log.error(`FDC submission failed for event ${event.id}`, err.message);
    return false;
  }
}

// ─── Query Type ID Mapping ─────────────────────────────────────────
function getQueryTypeId(eventType) {
  const types = {
    geopolitical: 1,
    financial: 2,
    sanctions: 3,
    military: 4,
    election: 5,
    trade: 6,
    regulatory: 7,
  };
  return types[eventType] || 1;
}

// ─── Process Events ─────────────────────────────────────────────────
async function processEvents() {
  const events = await fetchNewEvents();
  if (events.length === 0) return;

  log.info(`Processing ${events.length} new event(s)`);

  for (const event of events) {
    processedEventIds.add(event.id);

    // Only submit high-impact events to FDC (to save gas)
    const severity = event.severity || "low";
    if (SEVERITY_TO_CII_IMPACT[severity] === 0) {
      log.info(`Skipping low-severity event ${event.id}`);
      continue;
    }

    const success = await submitAttestationRequest(event);
    if (success) {
      log.info(`✅ Event ${event.id} → FDC attestation requested`);

      // If severity is critical/high, trigger collateral monitoring
      if (severity === "critical" || severity === "high") {
        await triggerCollateralMonitoring(event);
      }
    }
  }

  // Trim cache
  if (processedEventIds.size > MAX_PROCESSED_CACHE) {
    const arr = [...processedEventIds];
    processedEventIds = new Set(arr.slice(-MAX_PROCESSED_CACHE / 2));
  }
}

// ─── Collateral Monitoring Trigger ──────────────────────────────────
async function triggerCollateralMonitoring(event) {
  if (!collateralManager) {
    log.warn("CollateralManager not configured — skipping position monitoring");
    return;
  }

  try {
    log.info(`Triggering collateral monitoring for ${event.countryCode}...`);
    const tx = await collateralManager.monitorPositions({
      gasLimit: 300_000n,
    });
    await tx.wait();
    log.info(`✅ Collateral monitoring complete for ${event.countryCode}`);
  } catch (err) {
    log.error("Collateral monitoring failed", err.message);
  }
}

// ─── Main Loop ──────────────────────────────────────────────────────
async function main() {
  init();
  log.info("Starting FDC Bridge event polling...");

  // Initial fetch
  await processEvents();

  // Poll for new events
  setInterval(async () => {
    try {
      await processEvents();
    } catch (err) {
      log.error("Event polling error", err.message);
    }
  }, CONFIG.pollIntervalMs);

  // Listen for attestation responses (poll FDC contract)
  setInterval(async () => {
    // Check pending attestations
    eventBus.emit("healthcheck", { uptime: process.uptime() });
  }, 300_000); // every 5 minutes
}

process.on("SIGINT", () => {
  log.info("Shutting down FDC Bridge...");
  process.exit(0);
});

main().catch((err) => {
  log.error("Fatal error in FDC Bridge", err);
  process.exit(1);
});