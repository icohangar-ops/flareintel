/**
 * FlareIntel — FTSOv2 CII Score Submitter
 *
 * Periodically fetches CII scores from the WorldMonitor adapter (or local cache),
 * validates them, and submits to the CIIOracleFeed contract on Flare Coston2.
 *
 * Architecture:
 *   WorldMonitor API → worldmonitor-adapter.py → scores.json → this script → CIIOracleFeed contract
 *
 * The submitter reads normalized CII v8 scores and submits them as batched
 * FTSOv2 feed updates. It handles:
 *   - Epoch-aligned submission timing
 *   - Gas estimation and retry logic
 *   - Score validation (0-1000 range, delta thresholds)
 *   - Logging and health checks
 */

require("dotenv").config();
const { ethers } = require("ethers");
const fs = require("fs");
const path = require("path");
const axios = require("axios");

// ─── Configuration ──────────────────────────────────────────────────
const CONFIG = {
  rpcUrl: process.env.RPC_URL || "https://coston2-api.flare.network/ext/C/rpc",
  privateKey: process.env.PRIVATE_KEY,
  ciiOracleAddress: process.env.CII_ORACLE_ADDRESS,
  scoresFile: path.join(__dirname, "..", "..", "data", "scores.json"),
  submissionIntervalMs: 120_000, // 2 min (aligned with FTSO epochs)
  maxDeltaPerEpoch: 100, // max score change per epoch to prevent manipulation
  worldMonitorUrl: process.env.WORLDMONITOR_URL || "http://localhost:5000",
};

// ─── CIIOracleFeed ABI (subset needed for submission) ───────────────
const CII_ORACLE_ABI = [
  "function submitBatchCII(bytes3[] codes, uint256[] scores) external",
  "function submitCII(bytes3 code, uint256 score) external",
  "function getCountryCII(bytes3 code) view returns (uint256 feedId, uint256 ciiScore, uint256 lastUpdate, bool active)",
  "function getAllCountryCodes() view returns (bytes3[])",
  "function authorizedSubmitters(address) view returns (bool)",
  "event CIISubmitted(bytes3 indexed countryCode, uint256 ciiScore, uint256 timestamp)",
];

// ─── Logger ─────────────────────────────────────────────────────────
const log = {
  info: (msg, data) => console.log(`[${new Date().toISOString()}] [INFO]  ${msg}`, data || ""),
  warn: (msg, data) => console.warn(`[${new Date().toISOString()}] [WARN]  ${msg}`, data || ""),
  error: (msg, data) => console.error(`[${new Date().toISOString()}] [ERROR] ${msg}`, data || ""),
};

// ─── Provider & Signer ─────────────────────────────────────────────
const provider = new ethers.JsonRpcProvider(CONFIG.rpcUrl, {
  chainId: 114,
  name: "coston2",
});

let signer;
let ciiOracle;

function init() {
  if (!CONFIG.privateKey) {
    throw new Error("PRIVATE_KEY not set in .env");
  }
  if (!CONFIG.ciiOracleAddress) {
    throw new Error("CII_ORACLE_ADDRESS not set in .env");
  }

  signer = new ethers.Wallet(CONFIG.privateKey, provider);
  ciiOracle = new ethers.Contract(CONFIG.ciiOracleAddress, CII_ORACLE_ABI, signer);

  log.info("FTSO Submitter initialized", {
    address: signer.address,
    oracle: CONFIG.ciiOracleAddress,
    network: "coston2",
  });
}

// ─── Score Validation ───────────────────────────────────────────────
/**
 * Validates a CII score before on-chain submission.
 * Returns true if the score passes all checks.
 */
function validateScore(countryCode, newScore, previousScore) {
  // Range check
  if (newScore < 0 || newScore > 1000) {
    log.warn(`Score out of range for ${countryCode}: ${newScore}`);
    return false;
  }

  // Delta check (prevents sudden manipulation)
  if (previousScore !== undefined) {
    const delta = Math.abs(newScore - previousScore);
    if (delta > CONFIG.maxDeltaPerEpoch) {
      log.warn(`Score delta too large for ${countryCode}: ${previousScore} → ${newScore} (delta: ${delta})`);
      return false;
    }
  }

  return true;
}

// ─── Fetch Scores ───────────────────────────────────────────────────
/**
 * Attempts to load scores from local file, falling back to WorldMonitor API.
 */
async function fetchScores() {
  // Try local file first (written by worldmonitor-adapter.py)
  if (fs.existsSync(CONFIG.scoresFile)) {
    const raw = fs.readFileSync(CONFIG.scoresFile, "utf-8");
    const data = JSON.parse(raw);
    log.info(`Loaded ${data.scores.length} scores from ${CONFIG.scoresFile}`);
    return data.scores;
  }

  // Fallback: fetch from WorldMonitor adapter directly
  log.info("Local scores file not found, fetching from WorldMonitor API...");
  try {
    const resp = await axios.get(`${CONFIG.worldMonitorUrl}/api/v1/cii/scores`, {
      timeout: 30_000,
    });
    log.info(`Fetched ${resp.data.scores.length} scores from WorldMonitor API`);
    return resp.data.scores;
  } catch (err) {
    log.error("Failed to fetch scores from WorldMonitor", err.message);
    return [];
  }
}

// ─── Get Previous Scores from Contract ──────────────────────────────
async function getPreviousScores(countryCodes) {
  const previous = {};
  for (const code of countryCodes) {
    try {
      const bytes3Code = ethers.toBeArray(ethers.id(code)).slice(0, 3);
      const padded = "0x" + Buffer.from(code.padEnd(3, "\0")).toString("hex");
      const [, ciiScore] = await ciiOracle.getCountryCII(padded);
      previous[code] = Number(ciiScore);
    } catch {
      previous[code] = 0; // no previous score
    }
  }
  return previous;
}

// ─── Submit Scores ──────────────────────────────────────────────────
async function submitScores(scores) {
  if (!scores || scores.length === 0) {
    log.warn("No scores to submit");
    return;
  }

  // Filter and validate
  const countryCodes = scores.map((s) => s.countryCode);
  const previous = await getPreviousScores(countryCodes);

  const validEntries = scores.filter((s) => {
    const prev = previous[s.countryCode];
    return validateScore(s.countryCode, s.ciiScore, prev > 0 ? prev : undefined);
  });

  if (validEntries.length === 0) {
    log.warn("All scores failed validation — skipping submission");
    return;
  }

  // Prepare batch submission
  const codes = [];
  const ciiScores = [];

  for (const entry of validEntries) {
    const padded = "0x" + Buffer.from(entry.countryCode.padEnd(3, "\0")).toString("hex");
    codes.push(padded);
    ciiScores.push(BigInt(entry.ciiScore));
  }

  log.info(`Submitting ${codes.length} CII scores to CIIOracleFeed...`);

  try {
    // Estimate gas
    const gasEstimate = await ciiOracle.submitBatchCII.estimateGas(codes, ciiScores);
    const gasLimit = (gasEstimate * 120n) / 100n; // 20% buffer

    // Submit
    const tx = await ciiOracle.submitBatchCII(codes, ciiScores, {
      gasLimit,
      maxFeePerGas: ethers.parseUnits("150", "gwei"),
      maxPriorityFeePerGas: ethers.parseUnits("50", "gwei"),
    });

    log.info(`Transaction submitted: ${tx.hash}`);
    const receipt = await tx.wait();

    if (receipt.status === 1) {
      log.info(`✅ ${codes.length} CII scores submitted successfully (block: ${receipt.blockNumber}, gas: ${receipt.gasUsed})`);
    } else {
      log.error("Transaction reverted on-chain");
    }
  } catch (err) {
    log.error("Submission failed", err.message);
    if (err.message.includes("rate limited") || err.message.includes("nonce")) {
      log.info("Retrying in next epoch...");
    }
  }
}

// ─── Main Loop ──────────────────────────────────────────────────────
async function main() {
  init();
  log.info("Starting FTSOv2 CII submission loop...");

  // Check if submitter is authorized
  const isAuthorized = await ciiOracle.authorizedSubmitters(signer.address);
  if (!isAuthorized) {
    log.error("Submitter address is NOT authorized on CIIOracleFeed. Owner must call authorizeSubmitter().");
    log.error(`Address: ${signer.address}`);
    process.exit(1);
  }

  // Initial submission
  const scores = await fetchScores();
  await submitScores(scores);

  // Schedule periodic submissions
  setInterval(async () => {
    try {
      const freshScores = await fetchScores();
      await submitScores(freshScores);
    } catch (err) {
      log.error("Epoch submission error", err.message);
    }
  }, CONFIG.submissionIntervalMs);
}

// Handle graceful shutdown
process.on("SIGINT", () => {
  log.info("Shutting down FTSO submitter...");
  process.exit(0);
});

process.on("SIGTERM", () => {
  log.info("Shutting down FTSO submitter...");
  process.exit(0);
});

main().catch((err) => {
  log.error("Fatal error in FTSO submitter", err);
  process.exit(1);
});