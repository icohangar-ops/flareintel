/**
 * FlareIntel — Risk Data Routes
 *
 * Provides REST endpoints for accessing CII risk scores,
 * country data, and risk alerts from on-chain contracts.
 */

const express = require("express");
const { ethers } = require("ethers");
const fs = require("fs");
const path = require("path");
const router = express.Router();

// ─── Contract ABIs (subset) ─────────────────────────────────────────
const CII_ORACLE_ABI = [
  "function getCountryCII(bytes3 code) view returns (uint256 feedId, uint256 ciiScore, uint256 lastUpdate, bool active)",
  "function getAllCountryCodes() view returns (bytes3[])",
  "function getFeedCount() view returns (uint256)",
];

const COLLATERAL_ABI = [
  "function getAlertCount() view returns (uint256)",
  "function getAlert(uint256 id) view returns (bytes3 countryCode, uint256 ciiScore, uint256 threshold, uint256 timestamp, bool resolved)",
  "function globalRiskThreshold() view returns (uint256)",
  "function liquidationThreshold() view returns (uint256)",
  "function getPositionCount() view returns (uint256)",
];

const RDT_ABI = [
  "function totalStaked() view returns (uint256)",
  "function totalSupply() view returns (uint256)",
  "function MAX_SUPPLY() view returns (uint256)",
  "function yieldPool() view returns (uint256)",
];

// ─── Helpers ────────────────────────────────────────────────────────

/** Load cached scores from the pipeline output */
function loadCachedScores() {
  const scoresPath = path.join(__dirname, "..", "..", "..", "data", "scores.json");
  try {
    if (fs.existsSync(scoresPath)) {
      return JSON.parse(fs.readFileSync(scoresPath, "utf-8"));
    }
  } catch {
    // Fall through
  }
  return null;
}

/** Get contract instance from app locals */
function getContract(req, address, abi) {
  const provider = req.app.locals.provider;
  if (!provider || !address) return null;
  return new ethers.Contract(address, abi, provider);
}

/** Risk label mapping */
function riskLabel(cii) {
  if (cii < 200) return "Very Low";
  if (cii < 350) return "Low";
  if (cii < 500) return "Moderate";
  if (cii < 650) return "Elevated";
  if (cii < 800) return "High";
  return "Critical";
}

/** Risk color for frontend */
function riskColor(cii) {
  if (cii < 200) return "#22c55e";
  if (cii < 350) return "#84cc16";
  if (cii < 500) return "#eab308";
  if (cii < 650) return "#f97316";
  if (cii < 800) return "#ef4444";
  return "#dc2626";
}

// ─── Routes ─────────────────────────────────────────────────────────

/**
 * GET /api/risk/countries
 * List all tracked countries with their latest CII scores.
 * Merges on-chain data with cached pipeline data.
 */
router.get("/countries", async (req, res) => {
  try {
    const addresses = req.app.locals.contractAddresses;
    const cached = loadCachedScores();

    // Try to get on-chain data
    let onChainCountries = [];
    const ciiOracle = getContract(req, addresses.CIIOracleFeed, CII_ORACLE_ABI);

    if (ciiOracle) {
      try {
        const codes = await ciiOracle.getAllCountryCodes();
        for (const codeHex of codes) {
          const [, ciiScore, lastUpdate, active] = await ciiOracle.getCountryCII(codeHex);
          if (active && ciiScore > 0) {
            const codeStr = ethers.toUtf8String(codeHex).replace(/\0/g, "");
            onChainCountries.push({
              countryCode: codeStr,
              ciiScore: Number(ciiScore),
              lastUpdate: Number(lastUpdate),
              source: "on-chain",
            });
          }
        }
      } catch (err) {
        console.warn("[WARN] Could not fetch on-chain countries:", err.message);
      }
    }

    // Build country map from cached data
    const countryMap = {};
    if (cached && cached.scores) {
      for (const s of cached.scores) {
        countryMap[s.countryCode] = {
          countryCode: s.countryCode,
          ciiScore: s.ciiScore,
          rawCII: s.rawCII,
          riskLabel: s.riskLabel || riskLabel(s.ciiScore),
          riskColor: riskColor(s.ciiScore),
          subIndices: s.subIndices || {},
          lastUpdate: s.timestamp,
          source: "pipeline",
        };
      }
    }

    // Merge on-chain data (takes precedence)
    for (const oc of onChainCountries) {
      const existing = countryMap[oc.countryCode] || {};
      countryMap[oc.countryCode] = {
        ...existing,
        ...oc,
        riskLabel: riskLabel(oc.ciiScore),
        riskColor: riskColor(oc.ciiScore),
        source: "on-chain",
      };
    }

    const countries = Object.values(countryMap).sort((a, b) => b.ciiScore - a.ciiScore);

    res.json({
      count: countries.length,
      timestamp: new Date().toISOString(),
      countries,
    });
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch countries", message: err.message });
  }
});

/**
 * GET /api/risk/country/:code
 * Get detailed CII info for a specific country.
 */
router.get("/country/:code", async (req, res) => {
  const code = req.params.code.toUpperCase();

  try {
    const addresses = req.app.locals.contractAddresses;
    let onChainData = null;

    const ciiOracle = getContract(req, addresses.CIIOracleFeed, CII_ORACLE_ABI);
    if (ciiOracle) {
      const padded = "0x" + Buffer.from(code.padEnd(3, "\0")).toString("hex");
      try {
        const [feedId, ciiScore, lastUpdate, active] = await ciiOracle.getCountryCII(padded);
        onChainData = {
          feedId: Number(feedId),
          ciiScore: Number(ciiScore),
          lastUpdate: Number(lastUpdate),
          active,
        };
      } catch (err) {
        console.warn(`[WARN] Could not fetch on-chain CII for ${code}:`, err.message);
      }
    }

    // Get cached data
    const cached = loadCachedScores();
    let cachedData = null;
    if (cached && cached.scores) {
      cachedData = cached.scores.find((s) => s.countryCode === code);
    }

    const ciiScore = onChainData?.ciiScore || cachedData?.ciiScore || 0;

    res.json({
      countryCode: code,
      ciiScore,
      riskLabel: riskLabel(ciiScore),
      riskColor: riskColor(ciiScore),
      onChain: onChainData,
      cached: cachedData ? {
        rawCII: cachedData.rawCII,
        subIndices: cachedData.subIndices,
        timestamp: cachedData.timestamp,
      } : null,
    });
  } catch (err) {
    res.status(500).json({ error: `Failed to fetch data for ${code}`, message: err.message });
  }
});

/**
 * GET /api/risk/latest
 * Latest snapshot of all CII scores.
 */
router.get("/latest", (req, res) => {
  const cached = loadCachedScores();
  if (!cached) {
    return res.json({
      message: "No pipeline data available. Run worldmonitor-adapter.py first.",
      scores: [],
      timestamp: null,
    });
  }

  res.json({
    version: cached.version,
    methodology: cached.methodology,
    generatedAt: cached.generatedAt,
    countryCount: cached.countries,
    scores: cached.scores.map((s) => ({
      ...s,
      riskLabel: riskLabel(s.ciiScore),
      riskColor: riskColor(s.ciiScore),
    })),
  });
});

/**
 * GET /api/risk/alerts
 * Fetch active risk alerts from the CollateralManager.
 */
router.get("/alerts", async (req, res) => {
  try {
    const addresses = req.app.locals.contractAddresses;
    const cm = getContract(req, addresses.CollateralManager, COLLATERAL_ABI);

    if (!cm) {
      return res.json({
        message: "CollateralManager not deployed yet",
        alerts: [],
        thresholds: { risk: 700, liquidation: 900 },
      });
    }

    const alertCount = Number(await cm.getAlertCount());
    const alerts = [];
    const limit = Math.min(alertCount, 50);

    for (let i = 0; i < limit; i++) {
      try {
        const [countryCode, ciiScore, threshold, timestamp, resolved] = await cm.getAlert(i);
        alerts.push({
          id: i,
          countryCode: ethers.toUtf8String(countryCode).replace(/\0/g, ""),
          ciiScore: Number(ciiScore),
          threshold: Number(threshold),
          timestamp: Number(timestamp),
          resolved,
        });
      } catch {
        break;
      }
    }

    res.json({
      totalAlerts: alertCount,
      shown: alerts.length,
      thresholds: {
        risk: Number(await cm.globalRiskThreshold()),
        liquidation: Number(await cm.liquidationThreshold()),
      },
      alerts: alerts.filter((a) => !a.resolved),
    });
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch alerts", message: err.message });
  }
});

/**
 * GET /api/risk/token
 * RDT token statistics.
 */
router.get("/token", async (req, res) => {
  try {
    const addresses = req.app.locals.contractAddresses;
    const rdt = getContract(req, addresses.RiskDataToken, RDT_ABI);

    if (!rdt) {
      return res.json({ message: "RiskDataToken not deployed yet" });
    }

    const [totalStaked, totalSupply, maxSupply, yieldPool] = await Promise.all([
      rdt.totalStaked(),
      rdt.totalSupply(),
      rdt.MAX_SUPPLY(),
      rdt.yieldPool(),
    ]);

    res.json({
      name: "Risk Data Token",
      symbol: "RDT",
      address: addresses.RiskDataToken,
      totalSupply: ethers.formatEther(totalSupply),
      maxSupply: ethers.formatEther(maxSupply),
      totalStaked: ethers.formatEther(totalStaked),
      yieldPool: ethers.formatEther(yieldPool),
      stakeRate: totalSupply > 0n
        ? Number((totalStaked * 10000n) / totalSupply) / 100
        : 0,
    });
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch token info", message: err.message });
  }
});

module.exports = router;